import { NextRequest, NextResponse } from 'next/server';
import { ImapFlow, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { dbQuery } from '@/lib/db';
import { parseBankAlertEmail, sanitizeEmailContent } from '@/lib/bank-parser';
import {
  AutoReconciliationResult,
  BankEmailAlertRecord,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_BANK_DOMAINS: ReadonlyArray<string> = [
  'citibank.com',
  'alerts.citibank.com',
  'citi.com',
  'tdbank.com',
  'td.com',
];

interface SyncProcessedItem {
  messageId: string;
  banco: string;
  tipoMovimiento: string;
  montoBruto: number;
  remitenteODestinatario: string | null;
  referencia: string | null;
  metodoExtraccion: string;
  estadoFinal: string;
  conciliadoAutomaticamente: boolean;
  duplicadoIgnorado: boolean;
}

/**
 * Verifica que el remitente pertenezca estrictamente a uno de los dominios oficiales permitidos.
 */
function isOfficialBankSender(fromAddress: string): boolean {
  const normalized = fromAddress.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex === -1) {
    return false;
  }

  const domain = normalized.slice(atIndex + 1).replace(/[^a-z0-9.-]/g, '');

  return ALLOWED_BANK_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`)
  );
}

/**
 * Valida el token Bearer de autorización del Cron Worker.
 */
function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) {
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

async function runImapBankSync(): Promise<{
  scannedCount: number;
  insertedCount: number;
  reconciledCount: number;
  duplicateCount: number;
  skippedUnparseableCount: number;
  items: SyncProcessedItem[];
}> {
  const imapHost = process.env.IMAP_HOST;
  const imapPort = Number.parseInt(process.env.IMAP_PORT ?? '993', 10);
  const imapSecure = (process.env.IMAP_SECURE ?? 'true') !== 'false';
  const imapUser = process.env.IMAP_USER;
  const imapPass = process.env.IMAP_PASS;
  const mailboxName = process.env.IMAP_MAILBOX ?? 'INBOX';

  if (!imapHost || !imapUser || !imapPass) {
    throw new Error(
      'Faltan credenciales IMAP requeridas (IMAP_HOST, IMAP_USER, IMAP_PASS).'
    );
  }

  const defaultFeePercentage = Number.parseFloat(
    process.env.DEFAULT_FEE_PERCENTAGE ?? '4.00'
  );

  const client = new ImapFlow({
    host: imapHost,
    port: Number.isFinite(imapPort) ? imapPort : 993,
    secure: imapSecure,
    auth: {
      user: imapUser,
      pass: imapPass,
    },
    logger: false,
  });

  const items: SyncProcessedItem[] = [];
  let scannedCount = 0;
  let insertedCount = 0;
  let reconciledCount = 0;
  let duplicateCount = 0;
  let skippedUnparseableCount = 0;

  await client.connect();
  const lock = await client.getMailboxLock(mailboxName);

  try {
    // Buscar correos NO leídos provenientes de los dominios oficiales de Citibank y TD Bank
    const searchCriteria: SearchObject = {
      seen: false,
      or: ALLOWED_BANK_DOMAINS.map((domain) => ({ from: `@${domain}` })),
    };

    const matchingUids = await client.search(searchCriteria, { uid: true });
    if (!matchingUids || matchingUids.length === 0) {
      return {
        scannedCount: 0,
        insertedCount: 0,
        reconciledCount: 0,
        duplicateCount: 0,
        skippedUnparseableCount: 0,
        items: [],
      };
    }

    for (const uid of matchingUids) {
      const message = await client.fetchOne(
        String(uid),
        {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        },
        { uid: true }
      );

      if (!message || !message.source) {
        continue;
      }

      scannedCount += 1;

      const parsedMail = await simpleParser(message.source);
      const fromEntry = parsedMail.from?.value?.[0]?.address ?? '';

      // Verificación defensiva de dominio oficial
      if (!isOfficialBankSender(fromEntry)) {
        continue;
      }

      const messageId =
        parsedMail.messageId?.trim() ||
        message.envelope?.messageId?.trim() ||
        `imap-uid-${mailboxName}-${uid}-${
          parsedMail.date ? parsedMail.date.getTime() : Date.now()
        }`;

      const subject = parsedMail.subject ?? message.envelope?.subject ?? '';
      const textBody = parsedMail.text ?? '';
      const htmlBody = typeof parsedMail.html === 'string' ? parsedMail.html : '';
      const receivedDate = parsedMail.date ?? message.internalDate ?? new Date();

      const extracted = await parseBankAlertEmail({
        fromAddress: fromEntry,
        subject,
        textBody,
        htmlBody,
        receivedDate,
      });

      if (!extracted) {
        skippedUnparseableCount += 1;
        continue;
      }

      // Comisión de manejo de cuenta: 4% por defecto en ingresos (RECIBIDO), 0% en egresos (ENVIADO)
      const feePercentage =
        extracted.tipo_movimiento === 'RECIBIDO' && Number.isFinite(defaultFeePercentage)
          ? defaultFeePercentage
          : 0.0;

      const rawBodySnapshot = sanitizeEmailContent(htmlBody || textBody).slice(0, 12000);

      // Estado inicial: si faltan datos críticos o se usó AI_FALLBACK, nace en REVISION_MANUAL
      const initialStatus =
        extracted.metodo_extraccion === 'AI_FALLBACK' ||
        !extracted.remitente_o_destinatario
          ? 'REVISION_MANUAL'
          : 'DETECTADO';

      // Inserción idempotente parametrizada en PostgreSQL
      const insertSql = `
        INSERT INTO bank_email_alerts (
          message_id,
          banco,
          tipo_movimiento,
          monto_bruto,
          porcentaje_comision,
          remitente_o_destinatario,
          referencia,
          fecha_transaccion,
          raw_body,
          metodo_extraccion,
          estado
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING *;
      `;

      const insertResult = await dbQuery<BankEmailAlertRecord>(insertSql, [
        messageId,
        extracted.banco,
        extracted.tipo_movimiento,
        extracted.monto_bruto,
        feePercentage,
        extracted.remitente_o_destinatario,
        extracted.referencia,
        extracted.fecha_transaccion,
        rawBodySnapshot,
        extracted.metodo_extraccion,
        initialStatus,
      ]);

      const insertedAlert = insertResult.rows[0];

      if (!insertedAlert) {
        // El message_id ya existía en PostgreSQL (Idempotencia garantizada)
        duplicateCount += 1;
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

        items.push({
          messageId,
          banco: extracted.banco,
          tipoMovimiento: extracted.tipo_movimiento,
          montoBruto: extracted.monto_bruto,
          remitenteODestinatario: extracted.remitente_o_destinatario,
          referencia: extracted.referencia,
          metodoExtraccion: extracted.metodo_extraccion,
          estadoFinal: 'DUPLICADO_OMITIDO',
          conciliadoAutomaticamente: false,
          duplicadoIgnorado: true,
        });
        continue;
      }

      insertedCount += 1;

      // Ejecutar función PL/pgSQL de conciliación automática tras insertar
      let finalStatus = insertedAlert.estado;
      let autoReconciled = false;

      if (insertedAlert.tipo_movimiento === 'RECIBIDO') {
        const reconcileResult = await dbQuery<AutoReconciliationResult>(
          'SELECT * FROM fn_conciliar_pago_zelle($1::uuid);',
          [insertedAlert.id]
        );

        const matchRow = reconcileResult.rows[0];
        if (matchRow) {
          finalStatus = matchRow.nuevo_estado;
          autoReconciled = Boolean(matchRow.conciliado);
          if (autoReconciled) {
            reconciledCount += 1;
          }
        }
      }

      // Marcar correo como leído (\Seen) en el servidor IMAP sólo después de persistir y conciliar
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

      items.push({
        messageId: insertedAlert.message_id,
        banco: insertedAlert.banco,
        tipoMovimiento: insertedAlert.tipo_movimiento,
        montoBruto: insertedAlert.monto_bruto,
        remitenteODestinatario: insertedAlert.remitente_o_destinatario,
        referencia: insertedAlert.referencia,
        metodoExtraccion: insertedAlert.metodo_extraccion,
        estadoFinal: finalStatus,
        conciliadoAutomaticamente: autoReconciled,
        duplicadoIgnorado: false,
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }

  return {
    scannedCount,
    insertedCount,
    reconciledCount,
    duplicateCount,
    skippedUnparseableCount,
    items,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'No autorizado. Header Authorization: Bearer <CRON_SECRET> inválido o ausente.',
      },
      { status: 401 }
    );
  }

  try {
    const summary = await runImapBankSync();
    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      ...summary,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error interno durante sincronización IMAP.';
    console.error('[Cron Sync Bank Alerts Error]:', message);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return GET(request);
}
