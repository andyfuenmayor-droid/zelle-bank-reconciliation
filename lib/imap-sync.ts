import { ImapFlow, SearchObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ensureDefaultAdminBusinessUser } from '@/lib/business-scope';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import { buildDedupKey, parseBankAlertEmail, sanitizeEmailContent } from '@/lib/email-parser';
import { fetchAllBinanceTransactions } from '@/lib/binance-client';
import { decryptAtRest } from '@/lib/security';
import {
  AutoReconciliationResult,
  FinancialTransactionRecord,
  NormalizedFinancialTx,
} from '@/types/reconciliation';

const DEFAULT_MONITORING_START_ISO = '2026-10-19T00:00:00.000Z';

export function getMonitoringStartDate(): Date {
  const raw = process.env.IMAP_SYNC_SINCE?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(DEFAULT_MONITORING_START_ISO);
}

export const ALLOWED_BANK_DOMAINS: ReadonlyArray<string> = [
  'citibank.com',
  'alerts.citibank.com',
  'citi.com',
  'tdbank.com',
  'td.com',
  'binance.com',
  'directmail.binance.com',
  'post.binance.com',
];

export interface SyncProcessedItem {
  channelSource: 'IMAP_EMAIL' | 'BINANCE_API';
  mailboxEmail: string;
  messageId: string;
  dedupKey: string;
  banco: string;
  moneda: string;
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
  binanceApiConfigured: boolean;
  binanceFetchedCount: number;
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
  negocio_id: string | null;
  alias: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_password: string;
  mailbox_folder: string;
}

function isOfficialAllowedSender(fromAddress: string): boolean {
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
 * Sincroniza un buzón IMAP individual (Citibank, TD Bank y Binance) desde `monitoringStartDate` contra PostgreSQL.
 */
async function syncSingleMailbox(
  mailbox: MonitoredMailboxRow,
  _zelleDefaultFee: number,
  _binanceDefaultFee: number,
  monitoringStartDate: Date
): Promise<{
  scanned: number;
  inserted: number;
  reconciled: number;
  duplicates: number;
  skipped: number;
  items: SyncProcessedItem[];
}> {
  const decryptedPass = decryptAtRest(mailbox.imap_password) ?? mailbox.imap_password;
  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: Number.isFinite(mailbox.imap_port) ? mailbox.imap_port : 993,
    secure: Boolean(mailbox.imap_secure),
    auth: {
      user: mailbox.email_address,
      pass: decryptedPass,
    },
    disableAutoIdle: true,
    connectionTimeout: 12_000,
    greetingTimeout: 8_000,
    socketTimeout: 45_000,
    logger: false,
  });

  const items: SyncProcessedItem[] = [];
  let scanned = 0;
  let inserted = 0;
  let reconciled = 0;
  let duplicates = 0;
  let skipped = 0;

  // Cargar los IDs ya guardados desde la fecha de corte para evitar descargar correos repetidos
  const existingIds = new Set<string>();
  try {
    const existingRes = await dbQuery<{ external_unique_id: string }>(
      `
      SELECT external_unique_id
      FROM financial_transactions_reconciliation
      WHERE fecha_transaccion >= $1::timestamptz;
      `,
      [monitoringStartDate.toISOString()]
    );
    for (const row of existingRes.rows) {
      if (row.external_unique_id) {
        existingIds.add(row.external_unique_id);
      }
    }
  } catch {
    // Continuar usando la restricción UNIQUE en PostgreSQL
  }

  await client.connect();
  const folderName = mailbox.mailbox_folder || 'INBOX';
  const lock = await client.getMailboxLock(folderName);

  try {
    const searchCriteria: SearchObject = {
      since: monitoringStartDate,
      or: ALLOWED_BANK_DOMAINS.map((domain) => ({ from: `@${domain}` })),
    };

    const matchingUids = await client.search(searchCriteria, { uid: true });
    if (!matchingUids || matchingUids.length === 0) {
      return {
        scanned: 0,
        inserted: 0,
        reconciled: 0,
        duplicates: 0,
        skipped: 0,
        items: [],
      };
    }

    // Prefetch rápido de sobres/fechas sin descargar cuerpos completos
    const envelopes = await client.fetchAll(
      matchingUids,
      {
        uid: true,
        envelope: true,
        internalDate: true,
      },
      { uid: true }
    );

    const uidsToDownload: number[] = [];
    for (const meta of envelopes) {
      const rawInternalDate = meta.internalDate ? new Date(meta.internalDate) : null;
      const rawEnvDate = meta.envelope?.date ? new Date(meta.envelope.date) : null;
      const msgDate =
        rawInternalDate && !Number.isNaN(rawInternalDate.getTime())
          ? rawInternalDate
          : rawEnvDate && !Number.isNaN(rawEnvDate.getTime())
            ? rawEnvDate
            : null;

      if (msgDate && msgDate < monitoringStartDate) {
        continue;
      }

      const envFrom = meta.envelope?.from?.[0]?.address ?? '';
      if (envFrom && !isOfficialAllowedSender(envFrom)) {
        continue;
      }

      const candidateMsgId = meta.envelope?.messageId?.trim().slice(0, 180);
      if (candidateMsgId && existingIds.has(candidateMsgId)) {
        duplicates += 1;
        continue;
      }

      uidsToDownload.push(meta.uid);
    }

    if (uidsToDownload.length === 0) {
      return {
        scanned: envelopes.length,
        inserted: 0,
        reconciled: 0,
        duplicates,
        skipped: 0,
        items: [],
      };
    }

    // Descargar en lotes de 30 mensajes (más recientes primero) para evitar centenares de round-trips IMAP
    uidsToDownload.sort((a, b) => b - a);
    const uidsToMarkSeen: number[] = [];
    const batchSize = 30;

    for (let offset = 0; offset < uidsToDownload.length; offset += batchSize) {
      const batchUids = uidsToDownload.slice(offset, offset + batchSize);
      const batchMessages = await client.fetchAll(
        batchUids,
        {
          uid: true,
          envelope: true,
          source: true,
          internalDate: true,
        },
        { uid: true }
      );

      for (const message of batchMessages) {
        if (!message || !message.source) {
          continue;
        }

        const uid = message.uid;
        scanned += 1;

      const parsedMail = await simpleParser(message.source);
      const fromEntry = parsedMail.from?.value?.[0]?.address ?? '';

      if (!isOfficialAllowedSender(fromEntry)) {
        continue;
      }

      const rawMessageId =
        parsedMail.messageId?.trim() ||
        message.envelope?.messageId?.trim() ||
        `imap-${mailbox.email_address}-uid-${uid}-${
          parsedMail.date ? parsedMail.date.getTime() : Date.now()
        }`;

      const externalUniqueId = rawMessageId.slice(0, 180);
      if (existingIds.has(externalUniqueId)) {
        duplicates += 1;
        continue;
      }

      const subject = parsedMail.subject ?? message.envelope?.subject ?? '';
      const textBody = parsedMail.text ?? '';
      const htmlBody = typeof parsedMail.html === 'string' ? parsedMail.html : '';
      const receivedDate = parsedMail.date ?? message.internalDate ?? new Date();
      const receivedDateObj =
        receivedDate instanceof Date ? receivedDate : new Date(receivedDate);

      if (
        !Number.isNaN(receivedDateObj.getTime()) &&
        receivedDateObj < monitoringStartDate
      ) {
        continue;
      }

      const extracted = await parseBankAlertEmail({
        fromAddress: fromEntry,
        subject,
        textBody,
        htmlBody,
        receivedDate: receivedDateObj,
      });

      if (!extracted) {
        skipped += 1;
        continue;
      }

      const extractedDateObj = new Date(extracted.fecha_transaccion);
      if (
        !Number.isNaN(extractedDateObj.getTime()) &&
        extractedDateObj < monitoringStartDate
      ) {
        continue;
      }

      // En detección inicial, la comisión es 0.00% porque el correo aún no pertenece
      // a ningún cliente ni se le ha acordado un porcentaje de comisión.
      // La comisión real se calcula y asigna al conciliar (automática o manualmente).
      const feePercentage = 0.0;

      const rawBodySnapshot = sanitizeEmailContent(htmlBody || textBody).slice(0, 12000);
      const referenciaFinal = extracted.referencia ?? 'SIN-REF';
      const dedupKey = extracted.referencia
        ? extracted.dedup_key
        : buildDedupKey(extracted.plataforma, externalUniqueId, extracted.monto_bruto);

      const initialStatus =
        extracted.origen_deteccion === 'EMAIL_AI' ||
        !extracted.remitente_o_destinatario
          ? 'REVISION_MANUAL'
          : 'DETECTADO';

      const rawPayloadJson = JSON.stringify({
        from: fromEntry,
        subject,
        raw_body: rawBodySnapshot,
        mailbox: mailbox.email_address,
        confianza: extracted.confianza,
      });

      const insertSql = `
        INSERT INTO financial_transactions_reconciliation (
          negocio_id,
          external_unique_id,
          dedup_key,
          plataforma,
          moneda,
          tipo_movimiento,
          monto_bruto,
          porcentaje_comision,
          remitente_o_contraparte,
          referencia,
          fecha_transaccion,
          origen_deteccion,
          raw_payload,
          estado
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
        ON CONFLICT DO NOTHING
        RETURNING *;
      `;

      const insertResult = await dbQuery<FinancialTransactionRecord>(insertSql, [
        mailbox.negocio_id ?? null,
        externalUniqueId,
        dedupKey,
        extracted.plataforma,
        extracted.moneda,
        extracted.tipo_movimiento,
        extracted.monto_bruto,
        feePercentage,
        extracted.remitente_o_contraparte,
        referenciaFinal.slice(0, 120),
        extracted.fecha_transaccion,
        extracted.origen_deteccion,
        rawPayloadJson,
        initialStatus,
      ]);

      const insertedTx = insertResult.rows[0];

      if (!insertedTx) {
        duplicates += 1;
        uidsToMarkSeen.push(uid);

        items.push({
          channelSource: 'IMAP_EMAIL',
          mailboxEmail: mailbox.email_address,
          messageId: externalUniqueId,
          dedupKey,
          banco: extracted.plataforma,
          moneda: extracted.moneda,
          tipoMovimiento: extracted.tipo_movimiento,
          montoBruto: extracted.monto_bruto,
          remitenteODestinatario: extracted.remitente_o_contraparte,
          referencia: referenciaFinal,
          metodoExtraccion: extracted.origen_deteccion,
          estadoFinal: 'DUPLICADO_OMITIDO',
          conciliadoAutomaticamente: false,
          duplicadoIgnorado: true,
        });
        continue;
      }

      inserted += 1;

      let finalStatus = insertedTx.estado;
      let autoReconciled = false;

      if (insertedTx.tipo_movimiento === 'RECIBIDO') {
        const reconcileResult = await dbQuery<AutoReconciliationResult>(
          'SELECT * FROM fn_auto_conciliar_transaccion($1::uuid);',
          [insertedTx.id]
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

      uidsToMarkSeen.push(uid);

      items.push({
        channelSource: 'IMAP_EMAIL',
        mailboxEmail: mailbox.email_address,
        messageId: insertedTx.external_unique_id,
        dedupKey: insertedTx.dedup_key,
        banco: insertedTx.plataforma,
        moneda: insertedTx.moneda,
        tipoMovimiento: insertedTx.tipo_movimiento,
        montoBruto: insertedTx.monto_bruto,
        remitenteODestinatario: insertedTx.remitente_o_contraparte,
        referencia: insertedTx.referencia,
        metodoExtraccion: insertedTx.origen_deteccion,
        estadoFinal: finalStatus,
        conciliadoAutomaticamente: autoReconciled,
        duplicadoIgnorado: false,
      });
      }
    }

    if (uidsToMarkSeen.length > 0) {
      await client
        .messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], { uid: true })
        .catch(() => undefined);
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }

  return { scanned, inserted, reconciled, duplicates, skipped, items };
}

async function persistBinanceTransactions(
  transactions: ReadonlyArray<NormalizedFinancialTx>,
  monitoringStartDate: Date,
  negocioId: string | null
): Promise<{
  inserted: number;
  reconciled: number;
  duplicates: number;
  items: SyncProcessedItem[];
}> {
  let inserted = 0;
  let reconciled = 0;
  let duplicates = 0;
  const items: SyncProcessedItem[] = [];

  for (const tx of transactions) {
    const txDate = new Date(tx.fecha_transaccion);
    if (!Number.isNaN(txDate.getTime()) && txDate < monitoringStartDate) {
      continue;
    }
    const insertSql = `
      INSERT INTO financial_transactions_reconciliation (
        negocio_id,
        external_unique_id,
        dedup_key,
        plataforma,
        moneda,
        tipo_movimiento,
        monto_bruto,
        porcentaje_comision,
        remitente_o_contraparte,
        referencia,
        fecha_transaccion,
        origen_deteccion,
        raw_payload,
        estado
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, 'DETECTADO')
      ON CONFLICT DO NOTHING
      RETURNING *;
    `;

    const res = await dbQuery<FinancialTransactionRecord>(insertSql, [
      negocioId,
      tx.external_unique_id.slice(0, 180),
      tx.dedup_key.slice(0, 180),
      tx.plataforma,
      tx.moneda,
      tx.tipo_movimiento,
      tx.monto_bruto,
      tx.porcentaje_comision,
      tx.remitente_o_contraparte,
      tx.referencia.slice(0, 120),
      tx.fecha_transaccion,
      tx.origen_deteccion,
      JSON.stringify(tx.raw_payload),
    ]);

    const insertedRow = res.rows[0];
    if (!insertedRow) {
      duplicates += 1;
      items.push({
        channelSource: 'BINANCE_API',
        mailboxEmail: 'Binance API Oficial',
        messageId: tx.external_unique_id,
        dedupKey: tx.dedup_key,
        banco: tx.plataforma,
        moneda: tx.moneda,
        tipoMovimiento: tx.tipo_movimiento,
        montoBruto: tx.monto_bruto,
        remitenteODestinatario: tx.remitente_o_contraparte,
        referencia: tx.referencia,
        metodoExtraccion: 'BINANCE_API',
        estadoFinal: 'DUPLICADO_OMITIDO',
        conciliadoAutomaticamente: false,
        duplicadoIgnorado: true,
      });
      continue;
    }

    inserted += 1;
    let finalStatus = insertedRow.estado;
    let autoReconciled = false;

    if (insertedRow.tipo_movimiento === 'RECIBIDO') {
      const recRes = await dbQuery<AutoReconciliationResult>(
        'SELECT * FROM fn_auto_conciliar_transaccion($1::uuid);',
        [insertedRow.id]
      );
      const match = recRes.rows[0];
      if (match) {
        finalStatus = match.nuevo_estado;
        autoReconciled = Boolean(match.conciliado);
        if (autoReconciled) {
          reconciled += 1;
        }
      }
    }

    items.push({
      channelSource: 'BINANCE_API',
      mailboxEmail: 'Binance API Oficial',
      messageId: insertedRow.external_unique_id,
      dedupKey: insertedRow.dedup_key,
      banco: insertedRow.plataforma,
      moneda: insertedRow.moneda,
      tipoMovimiento: insertedRow.tipo_movimiento,
      montoBruto: insertedRow.monto_bruto,
      remitenteODestinatario: insertedRow.remitente_o_contraparte,
      referencia: insertedRow.referencia,
      metodoExtraccion: 'BINANCE_API',
      estadoFinal: finalStatus,
      conciliadoAutomaticamente: autoReconciled,
      duplicadoIgnorado: false,
    });
  }

  return { inserted, reconciled, duplicates, items };
}

/**
 * Ejecuta en paralelo (`Promise.allSettled`) la sincronización IMAP de todos los buzones activos
 * y la consulta a los 3 canales de Binance API (`Pay`, `P2P`, `On-Chain`).
 */
export async function executeUnifiedMultiChannelSync(
  onlyNegocioId?: string | null
): Promise<ImapSyncSummary> {
  const zelleDefaultFee = Number.parseFloat(
    process.env.ZELLE_DEFAULT_FEE_PERCENT ??
      process.env.DEFAULT_FEE_PERCENTAGE ??
      '4.00'
  );
  const binanceDefaultFee = Number.parseFloat(
    process.env.BINANCE_DEFAULT_FEE_PERCENT ?? '1.50'
  );

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return {
      mailboxesProcessed: 0,
      binanceApiConfigured: Boolean(
        process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET
      ),
      binanceFetchedCount: 0,
      scannedCount: 0,
      insertedCount: 0,
      reconciledCount: 0,
      duplicateCount: 0,
      skippedUnparseableCount: 0,
      items: [],
      errors: [
        'Base de datos PostgreSQL no disponible en entorno local (operando en modo DEMO_FALLBACK).',
      ],
    };
  }

  const primaryAdmin = await ensureDefaultAdminBusinessUser();
  const targetNegocioId = onlyNegocioId?.trim() || primaryAdmin?.id || null;
  const monitoringStartDate = getMonitoringStartDate();

  // NOTA DE INTEGRIDAD FINANCIERA: Jamás eliminar registros históricos de financial_transactions_reconciliation
  // durante el sync; `monitoringStartDate` solo filtra el rango de lectura IMAP/Binance.

  const mailboxes: MonitoredMailboxRow[] = [];

  try {
    const dbMailboxes = onlyNegocioId
      ? await dbQuery<MonitoredMailboxRow>(
          `
          SELECT id, negocio_id, alias, email_address, imap_host, imap_port, imap_secure, imap_password, mailbox_folder
          FROM imap_monitored_accounts
          WHERE activo = TRUE
            AND negocio_id = $1::uuid
          ORDER BY created_at ASC;
          `,
          [onlyNegocioId]
        )
      : await dbQuery<MonitoredMailboxRow>(
          `
          SELECT id, negocio_id, alias, email_address, imap_host, imap_port, imap_secure, imap_password, mailbox_folder
          FROM imap_monitored_accounts
          WHERE activo = TRUE
          ORDER BY created_at ASC;
          `
        );
    mailboxes.push(...dbMailboxes.rows);
  } catch {
    // Continuar con .env o Binance API
  }

  if (
    mailboxes.length === 0 &&
    !onlyNegocioId &&
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASS
  ) {
    mailboxes.push({
      id: 'env-default',
      negocio_id: targetNegocioId,
      alias: 'Buzón Principal (.env)',
      email_address: process.env.IMAP_USER,
      imap_host: process.env.IMAP_HOST,
      imap_port: Number.parseInt(process.env.IMAP_PORT ?? '993', 10),
      imap_secure: (process.env.IMAP_SECURE ?? 'true') !== 'false',
      imap_password: process.env.IMAP_PASS,
      mailbox_folder: process.env.IMAP_MAILBOX ?? 'INBOX',
    });
  }

  const binancePromise = fetchAllBinanceTransactions();
  const mailboxPromises = mailboxes.map((mb) =>
    syncSingleMailbox(
      mb,
      Number.isFinite(zelleDefaultFee) ? zelleDefaultFee : 4.0,
      Number.isFinite(binanceDefaultFee) ? binanceDefaultFee : 1.5,
      monitoringStartDate
    )
  );

  const [binanceSettled, ...mailboxSettled] = await Promise.allSettled([
    binancePromise,
    ...mailboxPromises,
  ]);

  let scannedCount = 0;
  let insertedCount = 0;
  let reconciledCount = 0;
  let duplicateCount = 0;
  let skippedUnparseableCount = 0;
  let binanceApiConfigured = false;
  let binanceFetchedCount = 0;
  const allItems: SyncProcessedItem[] = [];
  const errors: string[] = [];

  // Procesar resultados de Binance API
  if (binanceSettled.status === 'fulfilled') {
    binanceApiConfigured = binanceSettled.value.configured;
    binanceFetchedCount = binanceSettled.value.transactions.length;
    errors.push(...binanceSettled.value.errors);

    if (binanceSettled.value.transactions.length > 0) {
      try {
        const persisted = await persistBinanceTransactions(
          binanceSettled.value.transactions,
          monitoringStartDate,
          targetNegocioId
        );
        scannedCount += binanceSettled.value.transactions.length;
        insertedCount += persisted.inserted;
        reconciledCount += persisted.reconciled;
        duplicateCount += persisted.duplicates;
        allItems.push(...persisted.items);
      } catch (err: unknown) {
        errors.push(
          `Binance Persistencia SQL: ${
            err instanceof Error ? err.message : 'Error guardando transacciones Binance'
          }`
        );
      }
    }
  } else {
    errors.push(
      `Binance API: ${
        binanceSettled.reason instanceof Error
          ? binanceSettled.reason.message
          : 'Error inesperado'
      }`
    );
  }

  // Procesar resultados de cada buzón IMAP
  for (let i = 0; i < mailboxes.length; i++) {
    const mb = mailboxes[i];
    const outcome = mailboxSettled[i];
    if (!mb || !outcome) {
      continue;
    }

    if (outcome.status === 'fulfilled') {
      const res = outcome.value;
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
        ).catch(() => undefined);
      }
    } else {
      const msg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : 'Error de conexión IMAP';
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

  // Sincronización Retroactiva Inteligente (acotada al negocio si aplica):
  // Re-evaluar las órdenes de pago pendientes del portal contra la base de correos bancarios acumulada
  try {
    const pendingOrders = onlyNegocioId
      ? await dbQuery<{ id: string }>(
          `
          SELECT id
          FROM ordenes_pago_pendientes
          WHERE estado = 'PENDIENTE'
            AND negocio_id = $1::uuid
          ORDER BY created_at ASC;
          `,
          [onlyNegocioId]
        )
      : await dbQuery<{ id: string }>(
          `
          SELECT id
          FROM ordenes_pago_pendientes
          WHERE estado = 'PENDIENTE'
          ORDER BY created_at ASC;
          `
        );
    for (const order of pendingOrders.rows) {
      const rec = await dbQuery<{ conciliado: boolean }>(
        'SELECT * FROM fn_conciliar_orden_cliente($1::uuid);',
        [order.id]
      );
      if (rec.rows[0]?.conciliado) {
        reconciledCount += 1;
      }
    }

    const unmatchedRows = onlyNegocioId
      ? await dbQuery<{ id: string }>(
          `
          SELECT id
          FROM financial_transactions_reconciliation
          WHERE estado IN ('DETECTADO', 'REVISION_MANUAL')
            AND negocio_id = $1::uuid
            AND cliente_id IS NULL
            AND orden_conciliada_id IS NULL
            AND tipo_movimiento = 'RECIBIDO'
          ORDER BY fecha_transaccion DESC;
          `,
          [onlyNegocioId]
        )
      : await dbQuery<{ id: string }>(
          `
          SELECT id
          FROM financial_transactions_reconciliation
          WHERE estado IN ('DETECTADO', 'REVISION_MANUAL')
            AND cliente_id IS NULL
            AND orden_conciliada_id IS NULL
            AND tipo_movimiento = 'RECIBIDO'
          ORDER BY fecha_transaccion DESC;
          `
        );
    for (const row of unmatchedRows.rows) {
      const rec = await dbQuery<AutoReconciliationResult>(
        'SELECT * FROM fn_auto_conciliar_transaccion($1::uuid);',
        [row.id]
      );
      if (rec.rows[0]?.conciliado) {
        reconciledCount += 1;
      }
    }
  } catch (recheckErr) {
    console.error('[IMAP Sync] Error en sincronización retroactiva:', recheckErr);
  }

  if (mailboxes.length === 0 && !binanceApiConfigured) {
    errors.push(
      'Aún no hay buzones IMAP ni credenciales de Binance API configuradas. Agrega un buzón en la pestaña "Correos IMAP" o configura BINANCE_API_KEY / BINANCE_API_SECRET.'
    );
  }

  return {
    mailboxesProcessed: mailboxes.length,
    binanceApiConfigured,
    binanceFetchedCount,
    scannedCount,
    insertedCount,
    reconciledCount,
    duplicateCount,
    skippedUnparseableCount,
    items: allItems,
    errors,
  };
}

/**
 * Alias retrocompatible mantenido para rutas previas.
 */
export async function executeAllMailboxesSync(): Promise<ImapSyncSummary> {
  return executeUnifiedMultiChannelSync();
}
