import { ImapFlow, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { dbQuery } from '@/lib/db';
import { parseBankAlertEmail, sanitizeEmailContent } from '@/lib/bank-parser';
import {
  AutoReconciliationResult,
  BankEmailAlertRecord,
} from '@/types/reconciliation';

const ALLOWED_BANK_DOMAINS: ReadonlyArray<string> = [
  'citibank.com',
  'alerts.citibank.com',
  'citi.com',
  'tdbank.com',
  'td.com',
];

export interface SyncProcessedItem {
  mailboxEmail: string;
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

export interface ImapSyncSummary {
  mailboxesProcessed: number;
  scannedCount: number;
  insertedCount: number;
  reconciledCount: number;
  duplicateCount: number;
  skippedUnparseableCount: number;
  items: SyncProcessedItem[];
  errors: string[];
}

interface MonitoredMailboxRow {
  id: string;
  alias: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_password: string;
  mailbox_folder: string;
}

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
 * Sincroniza un buzón IMAP individual contra PostgreSQL.
 */
async function syncSingleMailbox(
  mailbox: MonitoredMailboxRow,
  defaultFeePercentage: number
): Promise<{
  scanned: number;
  inserted: number;
  reconciled: number;
  duplicates: number;
  skipped: number;
  items: SyncProcessedItem[];
}> {
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: Number.isFinite(mailbox.imap_port) ? mailbox.imap_port : 993,
    secure: Boolean(mailbox.imap_secure),
    auth: {
      user: mailbox.email_address,
      pass: mailbox.imap_password,
    },
    logger: false,
  });

  const items: SyncProcessedItem[] = [];
  let scanned = 0;
  let inserted = 0;
  let reconciled = 0;
  let duplicates = 0;
  let skipped = 0;

  await client.connect();
  const folderName = mailbox.mailbox_folder || 'INBOX';
  const lock = await client.getMailboxLock(folderName);

  try {
    const searchCriteria: SearchObject = {
      seen: false,
      or: ALLOWED_BANK_DOMAINS.map((domain) => ({ from: `@${domain}` })),
    };

    const matchingUids = await client.search(searchCriteria, { uid: true });
    if (!matchingUids || matchingUids.length === 0) {
      return { scanned: 0, inserted: 0, reconciled: 0, duplicates: 0, skipped: 0, items: [] };
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

      scanned += 1;

      const parsedMail = await simpleParser(message.source);
      const fromEntry = parsedMail.from?.value?.[0]?.address ?? '';

      if (!isOfficialBankSender(fromEntry)) {
        continue;
      }

      const messageId =
        parsedMail.messageId?.trim() ||
        message.envelope?.messageId?.trim() ||
        `imap-${mailbox.email_address}-uid-${uid}-${
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
        skipped += 1;
        continue;
      }

      const feePercentage =
        extracted.tipo_movimiento === 'RECIBIDO' && Number.isFinite(defaultFeePercentage)
          ? defaultFeePercentage
          : 0.0;

      const rawBodySnapshot = sanitizeEmailContent(htmlBody || textBody).slice(0, 12000);

      const initialStatus =
        extracted.metodo_extraccion === 'AI_FALLBACK' ||
        !extracted.remitente_o_destinatario
          ? 'REVISION_MANUAL'
          : 'DETECTADO';

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
        duplicates += 1;
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

        items.push({
          mailboxEmail: mailbox.email_address,
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

      inserted += 1;

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
            reconciled += 1;
          }
        }
      }

      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

      items.push({
        mailboxEmail: mailbox.email_address,
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

  return { scanned, inserted, reconciled, duplicates, skipped, items };
}

/**
 * Ejecuta la sincronización sobre todos los buzones IMAP registrados en `imap_monitored_accounts`
 * (y/o el buzón configurado por variables de entorno).
 */
export async function executeAllMailboxesSync(): Promise<ImapSyncSummary> {
  const defaultFeePercentage = Number.parseFloat(
    process.env.DEFAULT_FEE_PERCENTAGE ?? '4.00'
  );

  const mailboxes: MonitoredMailboxRow[] = [];

  try {
    const dbMailboxes = await dbQuery<MonitoredMailboxRow>(
      `
      SELECT id, alias, email_address, imap_host, imap_port, imap_secure, imap_password, mailbox_folder
      FROM imap_monitored_accounts
      WHERE activo = TRUE
      ORDER BY created_at ASC;
      `
    );
    mailboxes.push(...dbMailboxes.rows);
  } catch {
    // Si la tabla aún no existe, continuar con variables de entorno
  }

  // Si no hay buzones en BD pero existen variables de entorno IMAP_HOST/IMAP_USER/IMAP_PASS
  if (
    mailboxes.length === 0 &&
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASS
  ) {
    mailboxes.push({
      id: 'env-default',
      alias: 'Buzón Principal (.env)',
      email_address: process.env.IMAP_USER,
      imap_host: process.env.IMAP_HOST,
      imap_port: Number.parseInt(process.env.IMAP_PORT ?? '993', 10),
      imap_secure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
      imap_password: process.env.IMAP_PASS,
      mailbox_folder: process.env.IMAP_MAILBOX ?? 'INBOX',
    });
  }

  if (mailboxes.length === 0) {
    return {
      mailboxesProcessed: 0,
      scannedCount: 0,
      insertedCount: 0,
      reconciledCount: 0,
      duplicateCount: 0,
      skippedUnparseableCount: 0,
      items: [],
      errors: [
        'Aún no has agregado un correo IMAP para monitorear. Haz clic en la pestaña "Correos IMAP (Citibank / TD Bank)" para conectar el correo donde recibes las alertas de Zelle.',
      ],
    };
  }

  let scannedCount = 0;
  let insertedCount = 0;
  let reconciledCount = 0;
  let duplicateCount = 0;
  let skippedUnparseableCount = 0;
  const allItems: SyncProcessedItem[] = [];
  const errors: string[] = [];

  for (const mb of mailboxes) {
    try {
      const res = await syncSingleMailbox(mb, defaultFeePercentage);
      scannedCount += res.scanned;
      insertedCount += res.inserted;
      reconciledCount += res.reconciled;
      duplicateCount += res.duplicates;
      skippedUnparseableCount += res.skipped;
      allItems.push(...res.items);

      if (mb.id !== 'env-default') {
        await dbQuery(
          `
          UPDATE imap_monitored_accounts
          SET last_sync_at = NOW(),
              last_sync_status = $2
          WHERE id = $1::uuid;
          `,
          [
            mb.id,
            `OK (${res.inserted} nuevos, ${res.reconciled} conciliados)`,
          ]
        );
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Error de conexión IMAP';
      errors.push(`${mb.email_address}: ${msg}`);

      if (mb.id !== 'env-default') {
        await dbQuery(
          `
          UPDATE imap_monitored_accounts
          SET last_sync_at = NOW(),
              last_sync_status = $2
          WHERE id = $1::uuid;
          `,
          [mb.id, `ERROR: ${msg.slice(0, 180)}`]
        ).catch(() => undefined);
      }
    }
  }

  return {
    mailboxesProcessed: mailboxes.length,
    scannedCount,
    insertedCount,
    reconciledCount,
    duplicateCount,
    skippedUnparseableCount,
    items: allItems,
    errors,
  };
}
