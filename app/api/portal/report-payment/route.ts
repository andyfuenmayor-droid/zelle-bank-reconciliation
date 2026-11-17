import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { verifyReceiptWithVisionOcr } from '@/lib/email-parser';
import {
  buildDemoOcrFallback,
  computeClientWalletSummary,
  getDemoStore,
  runDemoAutoReconcileForOrder,
} from '@/lib/mock-seed-data';
import {
  AutoReconciliationResult,
  ClientPortalWalletSummary,
  CurrencyType,
  ExpectedPlatformType,
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_PLATFORMS: ReadonlyArray<ExpectedPlatformType> = [
  'CITIBANK',
  'TD_BANK',
  'BINANCE_PAY',
  'BINANCE_P2P',
  'BINANCE_ONCHAIN',
];

const VALID_CURRENCIES: ReadonlyArray<CurrencyType> = ['USD', 'USDT', 'VES'];

interface ReportPaymentBody {
  clienteId?: string;
  plataforma_esperada?: string;
  moneda?: string;
  monto_esperado?: number;
  remitente_reportado?: string;
  referencia_reportada?: string;
  comprobante_base64?: string;
  comprobante_mime?: string;
  notas_cliente?: string;
}

function extractMimeFromDataUrl(dataUrl: string, explicitMime?: string): string {
  if (explicitMime && explicitMime.trim().length > 0) {
    return explicitMime.trim();
  }
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  return match?.[1] ?? 'image/jpeg';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ReportPaymentBody;
    const clienteId = (body.clienteId ?? '').trim();
    const rawPlatform = (body.plataforma_esperada ?? '').trim().toUpperCase();
    const rawCurrency = (body.moneda ?? '').trim().toUpperCase();
    const montoEsperado = Number(body.monto_esperado ?? 0);
    const remitenteReportado = (body.remitente_reportado ?? '').trim();
    const referenciaReportada = (body.referencia_reportada ?? '').trim();
    const comprobanteBase64 = (body.comprobante_base64 ?? '').trim();
    const notasCliente = (body.notas_cliente ?? '').trim() || null;

    if (!clienteId) {
      return NextResponse.json(
        { ok: false, error: 'Debes iniciar sesión en el portal para reportar un pago.' },
        { status: 401 }
      );
    }

    if (
      !VALID_PLATFORMS.includes(rawPlatform as ExpectedPlatformType)
    ) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona una plataforma de pago válida.' },
        { status: 400 }
      );
    }
    const plataforma = rawPlatform as ExpectedPlatformType;

    const defaultCurrency: CurrencyType = plataforma.startsWith('BINANCE')
      ? 'USDT'
      : 'USD';
    const moneda: CurrencyType = VALID_CURRENCIES.includes(
      rawCurrency as CurrencyType
    )
      ? (rawCurrency as CurrencyType)
      : defaultCurrency;

    if (!Number.isFinite(montoEsperado) || montoEsperado <= 0) {
      return NextResponse.json(
        { ok: false, error: 'El monto del pago debe ser mayor a 0.' },
        { status: 400 }
      );
    }

    if (remitenteReportado.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Indica el nombre del titular Zelle o tu nickname/ID en Binance.',
        },
        { status: 400 }
      );
    }

    // En Binance el TxID u Order ID es obligatorio para validar depósitos en blockchain.
    // Para Zelle / transferencias bancarias, muchas entidades (Chase, Capital One, Zelle app)
    // no muestran código en la pantalla inicial de confirmación, por lo que es opcional.
    if (plataforma.startsWith('BINANCE') && referenciaReportada.length < 3) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Para depósitos en Binance, el número de confirmación, Order ID o TxID es obligatorio.',
        },
        { status: 400 }
      );
    }

    const sanitizedReferencia =
      referenciaReportada.length >= 3 ? referenciaReportada : null;

    if (!comprobanteBase64 || comprobanteBase64.length < 30) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'La captura de pantalla del comprobante es obligatoria.',
        },
        { status: 400 }
      );
    }

    const comprobanteMime = extractMimeFromDataUrl(
      comprobanteBase64,
      body.comprobante_mime
    );
    const normalizedAmount = Math.round(montoEsperado * 100) / 100;
    const codigoOrden = `ORD-${new Date().getFullYear()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const client = store.clients.find((c) => c.id === clienteId);
      if (!client) {
        return NextResponse.json(
          { ok: false, error: 'Cuenta de cliente no encontrada.' },
          { status: 404 }
        );
      }

      const ocrData = process.env.OPENAI_API_KEY
        ? await verifyReceiptWithVisionOcr({
            comprobanteBase64,
            plataformaEsperada: plataforma,
            moneda,
            montoEsperado: normalizedAmount,
            remitenteReportado,
            referenciaReportada,
          })
        : buildDemoOcrFallback({
            plataforma,
            moneda,
            monto: normalizedAmount,
            referencia: referenciaReportada,
            remitente: remitenteReportado,
          });

      const newOrder: PendingPaymentOrder = {
        id: crypto.randomUUID(),
        negocio_id: client.negocio_id ?? null,
        codigo_orden: codigoOrden,
        cliente_id: client.id,
        cliente_nombre: client.nombre_titular,
        cliente_email: client.email ?? client.email_contacto ?? 'cliente@conciliarcuenta.com',
        plataforma_esperada: plataforma,
        banco_destino: plataforma,
        moneda,
        monto_esperado: normalizedAmount,
        remitente_reportado: remitenteReportado,
        nombre_remitente_reportado: remitenteReportado,
        referencia_reportada: sanitizedReferencia,
        comprobante_base64: comprobanteBase64,
        comprobante_mime: comprobanteMime,
        datos_ocr_extraidos: ocrData,
        estado: 'PENDIENTE',
        transaccion_conciliada_id: null,
        notas_cliente: notasCliente,
        created_at: new Date().toISOString(),
      };

      store.orders.unshift(newOrder);
      const matchResult = runDemoAutoReconcileForOrder(newOrder.id);
      const wallet = computeClientWalletSummary(
        client.id,
        store.transactions,
        store.orders
      );

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        instantReconciled: matchResult.reconciled,
        order: newOrder,
        reconciledTransaction: matchResult.transaction,
        wallet,
      });
    }

    // Validación opcional con OpenAI Vision antes de abrir la transacción SQL
    const ocrResult = await verifyReceiptWithVisionOcr({
      comprobanteBase64,
      plataformaEsperada: plataforma,
      moneda,
      montoEsperado: normalizedAmount,
      remitenteReportado,
      referenciaReportada,
    });

    const txOutcome = await withTransaction<{
      order: PendingPaymentOrder;
      instantReconciled: boolean;
      reconciledTransaction: FinancialTransactionRecord | null;
      wallet: ClientPortalWalletSummary;
    }>(async (client) => {
      const clientRes = await client.query<{
        id: string;
        negocio_id: string | null;
        nombre_titular: string;
        email: string | null;
        email_contacto: string | null;
      }>(
        `
        SELECT id, negocio_id, nombre_titular, email, email_contacto
        FROM clientes_titulares
        WHERE id = $1::uuid
        LIMIT 1;
        `,
        [clienteId]
      );

      const clientRow = clientRes.rows[0];
      if (!clientRow) {
        throw new Error('La cuenta de cliente especificada no existe.');
      }

      const clientEmail =
        clientRow.email ??
        clientRow.email_contacto ??
        'cliente@conciliarcuenta.com';

      const insertOrderRes = await client.query<PendingPaymentOrder>(
        `
        INSERT INTO ordenes_pago_pendientes (
          negocio_id,
          codigo_orden,
          cliente_id,
          cliente_nombre,
          cliente_email,
          plataforma_esperada,
          banco_destino,
          moneda,
          monto_esperado,
          remitente_reportado,
          nombre_remitente_reportado,
          referencia_reportada,
          comprobante_base64,
          comprobante_mime,
          datos_ocr_extraidos,
          estado,
          notas_cliente
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, 'PENDIENTE', $16)
        RETURNING *;
        `,
        [
          clientRow.negocio_id,
          codigoOrden,
          clientRow.id,
          clientRow.nombre_titular,
          clientEmail,
          plataforma,
          plataforma,
          moneda,
          normalizedAmount,
          remitenteReportado,
          remitenteReportado,
          sanitizedReferencia,
          comprobanteBase64,
          comprobanteMime,
          JSON.stringify(ocrResult),
          notasCliente,
        ]
      );

      let orderRow = insertOrderRes.rows[0];
      if (!orderRow) {
        throw new Error('No se pudo crear la orden de pago.');
      }

      // Buscar inmediatamente si este pago ya había entrado por IMAP o Binance API
      const candidateTxs = await client.query<{ id: string }>(
        clientRow.negocio_id
          ? `
            SELECT id
            FROM financial_transactions_reconciliation
            WHERE estado <> 'CONCILIADO'
              AND tipo_movimiento = 'RECIBIDO'
              AND moneda = $1
              AND monto_bruto = $2
              AND (negocio_id = $3::uuid OR negocio_id IS NULL)
            ORDER BY fecha_transaccion DESC
            LIMIT 15;
            `
          : `
            SELECT id
            FROM financial_transactions_reconciliation
            WHERE estado <> 'CONCILIADO'
              AND tipo_movimiento = 'RECIBIDO'
              AND moneda = $1
              AND monto_bruto = $2
            ORDER BY fecha_transaccion DESC
            LIMIT 15;
            `,
        clientRow.negocio_id
          ? [moneda, normalizedAmount, clientRow.negocio_id]
          : [moneda, normalizedAmount]
      );

      let reconciledTransaction: FinancialTransactionRecord | null = null;
      let instantReconciled = false;

      for (const candidate of candidateTxs.rows) {
        const recRes = await client.query<AutoReconciliationResult>(
          'SELECT * FROM fn_auto_conciliar_transaccion($1::uuid);',
          [candidate.id]
        );
        const match = recRes.rows[0];
        if (match?.conciliado && match.orden_pago_id === orderRow.id) {
          instantReconciled = true;
          const txFetch = await client.query<FinancialTransactionRecord>(
            `
            SELECT
              *,
              external_unique_id AS message_id,
              plataforma AS banco,
              remitente_o_contraparte AS remitente_o_destinatario,
              COALESCE(raw_payload->>'raw_body', raw_payload::text) AS raw_body,
              origen_deteccion AS metodo_extraccion,
              orden_conciliada_id AS orden_pago_id,
              nota_auditoria AS notas_conciliacion
            FROM financial_transactions_reconciliation
            WHERE id = $1::uuid;
            `,
            [candidate.id]
          );
          reconciledTransaction = txFetch.rows[0] ?? null;

          const refreshedOrder = await client.query<PendingPaymentOrder>(
            'SELECT * FROM ordenes_pago_pendientes WHERE id = $1::uuid;',
            [orderRow.id]
          );
          if (refreshedOrder.rows[0]) {
            orderRow = refreshedOrder.rows[0];
          }
          break;
        }
      }

      const [aggRes, pendingRes] = await Promise.all([
        client.query<{
          moneda: string;
          total_bruto: number;
          total_comision: number;
          total_neto: number;
          tx_count: number;
        }>(
          `
          SELECT
            moneda,
            COALESCE(SUM(monto_bruto), 0)::numeric(12,2) AS total_bruto,
            COALESCE(SUM(monto_comision), 0)::numeric(12,2) AS total_comision,
            COALESCE(SUM(monto_neto), 0)::numeric(12,2) AS total_neto,
            COUNT(*)::int AS tx_count
          FROM financial_transactions_reconciliation
          WHERE estado = 'CONCILIADO'
            AND tipo_movimiento = 'RECIBIDO'
            AND (
              cliente_id = $1::uuid
              OR UPPER(TRIM(COALESCE(cliente_asignado_nombre, ''))) = UPPER(TRIM($2))
            )
          GROUP BY moneda;
          `,
          [clientRow.id, clientRow.nombre_titular]
        ),
        client.query<{ pending_count: number }>(
          `
          SELECT COUNT(*)::int AS pending_count
          FROM ordenes_pago_pendientes
          WHERE cliente_id = $1::uuid AND estado = 'PENDIENTE';
          `,
          [clientRow.id]
        ),
      ]);

      let totalBrutoUsd = 0;
      let totalComisionUsd = 0;
      let saldoNetoUsd = 0;
      let totalBrutoUsdt = 0;
      let totalComisionUsdt = 0;
      let saldoNetoUsdt = 0;
      let pagosConciliadosCount = 0;

      for (const row of aggRes.rows) {
        pagosConciliadosCount += row.tx_count;
        if (row.moneda === 'USDT') {
          totalBrutoUsdt += row.total_bruto;
          totalComisionUsdt += row.total_comision;
          saldoNetoUsdt += row.total_neto;
        } else {
          totalBrutoUsd += row.total_bruto;
          totalComisionUsd += row.total_comision;
          saldoNetoUsd += row.total_neto;
        }
      }

      const wallet: ClientPortalWalletSummary = {
        saldoNetoUsd: Math.round(saldoNetoUsd * 100) / 100,
        totalBrutoUsd: Math.round(totalBrutoUsd * 100) / 100,
        totalComisionUsd: Math.round(totalComisionUsd * 100) / 100,
        saldoNetoUsdt: Math.round(saldoNetoUsdt * 100) / 100,
        totalBrutoUsdt: Math.round(totalBrutoUsdt * 100) / 100,
        totalComisionUsdt: Math.round(totalComisionUsdt * 100) / 100,
        pagosConciliadosCount,
        pagosPendientesCount: pendingRes.rows[0]?.pending_count ?? 0,
      };

      return {
        order: orderRow,
        instantReconciled,
        reconciledTransaction,
        wallet,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      ...txOutcome,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error
        ? error.message
        : 'Error interno procesando el reporte de pago.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
