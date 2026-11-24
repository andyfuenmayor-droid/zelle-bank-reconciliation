import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable, SqlPrimitive } from '@/lib/db';
import {
  buildDedupKey,
  parseBankAlertEmail,
  sanitizeEmailContent,
} from '@/lib/email-parser';
import {
  getDemoStore,
  runDemoAutoReconcileForOrder,
} from '@/lib/mock-seed-data';
import {
  requireAdminSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';
import {
  AutoReconciliationResult,
  FinancialSummaryMetrics,
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  const { searchParams } = new URL(request.url);
  const plataforma =
    searchParams.get('plataforma') ?? searchParams.get('banco');
  const tipoMovimiento = searchParams.get('tipo_movimiento');
  const estado = searchParams.get('estado');
  const moneda = searchParams.get('moneda');
  const search = searchParams.get('search')?.trim() ?? '';
  const includeLiquidated = searchParams.get('includeLiquidated') === '1';
  const includeDiscarded = searchParams.get('includeDiscarded') === '1';
  const rawLiquidacionId = searchParams.get('liquidacionId')?.trim() ?? '';
  const liquidacionId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      rawLiquidacionId
    )
      ? rawLiquidacionId
      : null;

  const dbConnected = await isDatabaseAvailable();

  if (!dbConnected) {
    const store = getDemoStore();
    const demoNegocioId = authorizedNegocioId || store.businessUsers[0]?.id || '';
    const pendingOrders = store.orders.filter(
      (o) =>
        o.estado === 'PENDIENTE' &&
        (!demoNegocioId ||
          (o.negocio_id ?? store.businessUsers[0]?.id) === demoNegocioId)
    );

    const filtered = store.transactions.filter((item) => {
      if (
        demoNegocioId &&
        (item.negocio_id ?? store.businessUsers[0]?.id) !== demoNegocioId
      ) {
        return false;
      }
      if (!includeDiscarded && estado !== 'DESCARTADO' && item.estado === 'DESCARTADO') {
        return false;
      }
      if (plataforma && plataforma !== 'TODOS' && item.plataforma !== plataforma) {
        return false;
      }
      if (
        tipoMovimiento &&
        tipoMovimiento !== 'TODOS' &&
        item.tipo_movimiento !== tipoMovimiento
      ) {
        return false;
      }
      if (estado && estado !== 'TODOS' && item.estado !== estado) {
        return false;
      }
      if (moneda && moneda !== 'TODOS' && item.moneda !== moneda) {
        return false;
      }
      if (search.length > 0) {
        const q = search.toLowerCase();
        return (
          item.remitente_o_contraparte.toLowerCase().includes(q) ||
          item.referencia.toLowerCase().includes(q) ||
          (item.cliente_asignado_nombre ?? '').toLowerCase().includes(q) ||
          item.dedup_key.toLowerCase().includes(q)
        );
      }
      return true;
    });

    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      alerts: filtered,
      pendingOrders,
    });
  }

  try {
    const scope = { negocioId: authorizedNegocioId };
    const conditions: string[] = [];
    const params: SqlPrimitive[] = [];

    if (scope.negocioId) {
      params.push(scope.negocioId);
      conditions.push(`t.negocio_id = $${params.length}::uuid`);
    }

    if (liquidacionId) {
      params.push(liquidacionId);
      conditions.push(`t.liquidacion_id = $${params.length}::uuid`);
    } else if (!includeLiquidated) {
      conditions.push(`t.liquidado_at IS NULL`);
    }

    if (!includeDiscarded && estado !== 'DESCARTADO') {
      conditions.push(`t.estado <> 'DESCARTADO'`);
    }

    if (plataforma && plataforma !== 'TODOS') {
      params.push(plataforma);
      conditions.push(`t.plataforma = $${params.length}`);
    }

    if (tipoMovimiento && tipoMovimiento !== 'TODOS') {
      params.push(tipoMovimiento);
      conditions.push(`t.tipo_movimiento = $${params.length}`);
    }

    if (estado && estado !== 'TODOS') {
      params.push(estado);
      conditions.push(`t.estado = $${params.length}`);
    }

    if (moneda && moneda !== 'TODOS') {
      params.push(moneda);
      conditions.push(`t.moneda = $${params.length}`);
    }

    if (search.length > 0) {
      params.push(`%${search}%`);
      conditions.push(
        `(COALESCE(t.remitente_o_contraparte, '') ILIKE $${params.length} OR COALESCE(t.referencia, '') ILIKE $${params.length} OR COALESCE(t.cliente_asignado_nombre, '') ILIKE $${params.length} OR COALESCE(t.dedup_key, '') ILIKE $${params.length})`
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const alertsSql = `
      SELECT
        t.id,
        t.negocio_id,
        t.external_unique_id,
        t.dedup_key,
        t.plataforma,
        t.moneda,
        t.tipo_movimiento,
        t.monto_bruto,
        t.porcentaje_comision,
        t.monto_comision,
        t.monto_neto,
        t.remitente_o_contraparte,
        t.referencia,
        t.fecha_transaccion,
        t.origen_deteccion,
        (COALESCE(t.raw_payload, '{}'::jsonb) - 'raw_body' - 'raw_html') AS raw_payload,
        t.estado,
        t.cliente_id,
        t.cliente_asignado_nombre,
        t.orden_conciliada_id,
        t.nota_auditoria,
        t.conciliado_at,
        t.liquidacion_id,
        t.liquidado_at,
        l.codigo_liquidacion,
        l.numero_ciclo,
        t.created_at,
        (CASE WHEN o.comprobante_base64 IS NOT NULL AND LENGTH(o.comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
        o.id AS capture_order_id,
        NULL::text AS comprobante_base64,
        o.comprobante_mime,
        o.datos_ocr_extraidos,
        o.codigo_orden,
        COALESCE(o.remitente_reportado, o.nombre_remitente_reportado) AS remitente_reportado,
        o.referencia_reportada,
        o.monto_esperado AS monto_reportado,
        o.created_at AS fecha_reportada,
        t.external_unique_id AS message_id,
        t.plataforma AS banco,
        t.remitente_o_contraparte AS remitente_o_destinatario,
        LEFT(COALESCE(t.raw_payload->>'raw_body', (COALESCE(t.raw_payload, '{}'::jsonb) - 'raw_html')::text), 1800) AS raw_body,
        CASE
          WHEN t.origen_deteccion = 'EMAIL_AI' THEN 'AI_FALLBACK'
          WHEN t.origen_deteccion = 'BINANCE_API' THEN 'BINANCE_API'
          ELSE 'REGEX'
        END AS metodo_extraccion,
        t.orden_conciliada_id AS orden_pago_id,
        t.nota_auditoria AS notas_conciliacion
      FROM financial_transactions_reconciliation t
      LEFT JOIN ordenes_pago_pendientes o
        ON o.id = t.orden_conciliada_id
      LEFT JOIN (
        SELECT
          id,
          codigo_liquidacion,
          ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY created_at ASC, id ASC)::int AS numero_ciclo
        FROM liquidaciones_clientes
      ) l
        ON l.id = t.liquidacion_id
      ${whereClause}
      ORDER BY t.fecha_transaccion DESC, t.created_at DESC
      LIMIT ${liquidacionId ? 1000 : includeLiquidated ? 500 : 250};
    `;

    const pendingOrdersSql = scope.negocioId
      ? `
        SELECT
          id,
          negocio_id,
          codigo_orden,
          cliente_id,
          cliente_nombre,
          cliente_email,
          COALESCE(plataforma_esperada, banco_destino, 'CITIBANK') AS plataforma_esperada,
          COALESCE(banco_destino, plataforma_esperada, 'CITIBANK') AS banco_destino,
          COALESCE(moneda, 'USD') AS moneda,
          monto_esperado,
          fecha_transferencia,
          COALESCE(remitente_reportado, nombre_remitente_reportado, cliente_nombre) AS remitente_reportado,
          COALESCE(nombre_remitente_reportado, remitente_reportado, cliente_nombre) AS nombre_remitente_reportado,
          referencia_reportada,
          (CASE WHEN comprobante_base64 IS NOT NULL AND LENGTH(comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
          NULL::text AS comprobante_base64,
          comprobante_mime,
          datos_ocr_extraidos,
          estado,
          COALESCE(transaccion_conciliada_id, alerta_conciliada_id) AS transaccion_conciliada_id,
          notas_cliente,
          created_at,
          updated_at
        FROM ordenes_pago_pendientes
        WHERE estado = 'PENDIENTE'
          AND negocio_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 100;
      `
      : `
        SELECT
          id,
          negocio_id,
          codigo_orden,
          cliente_id,
          cliente_nombre,
          cliente_email,
          COALESCE(plataforma_esperada, banco_destino, 'CITIBANK') AS plataforma_esperada,
          COALESCE(banco_destino, plataforma_esperada, 'CITIBANK') AS banco_destino,
          COALESCE(moneda, 'USD') AS moneda,
          monto_esperado,
          fecha_transferencia,
          COALESCE(remitente_reportado, nombre_remitente_reportado, cliente_nombre) AS remitente_reportado,
          COALESCE(nombre_remitente_reportado, remitente_reportado, cliente_nombre) AS nombre_remitente_reportado,
          referencia_reportada,
          (CASE WHEN comprobante_base64 IS NOT NULL AND LENGTH(comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
          NULL::text AS comprobante_base64,
          comprobante_mime,
          datos_ocr_extraidos,
          estado,
          COALESCE(transaccion_conciliada_id, alerta_conciliada_id) AS transaccion_conciliada_id,
          notas_cliente,
          created_at,
          updated_at
        FROM ordenes_pago_pendientes
        WHERE estado = 'PENDIENTE'
        ORDER BY created_at DESC
        LIMIT 100;
      `;

    const summarySql = `
      SELECT
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_bruto,
        COALESCE(SUM(monto_comision) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_comision,
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_neto_acumulado,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_ciclo_bruto,
        COALESCE(SUM(monto_comision) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_ciclo_comision,
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_ciclo_neto,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado IN ('DETECTADO', 'REVISION_MANUAL') AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_por_conciliar,
        COALESCE(SUM(monto_bruto) FILTER (WHERE tipo_movimiento = 'ENVIADO' AND estado <> 'DESCARTADO' AND liquidado_at IS NULL AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_enviado,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_bruto,
        COALESCE(SUM(monto_comision) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_comision,
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_neto_acumulado,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_ciclo_bruto,
        COALESCE(SUM(monto_comision) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_ciclo_comision,
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_ciclo_neto,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado IN ('DETECTADO', 'REVISION_MANUAL') AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_por_conciliar,
        COALESCE(SUM(monto_bruto) FILTER (WHERE tipo_movimiento = 'ENVIADO' AND estado <> 'DESCARTADO' AND liquidado_at IS NULL AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_enviado,
        COUNT(*) FILTER (WHERE estado = 'CONCILIADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO')::int AS conciliados_count,
        COUNT(*) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO')::int AS conciliados_historico_count,
        COUNT(*) FILTER (WHERE estado = 'REVISION_MANUAL' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO')::int AS revision_count,
        COUNT(*) FILTER (WHERE estado = 'DETECTADO' AND liquidado_at IS NULL AND tipo_movimiento = 'RECIBIDO')::int AS detectados_count
      FROM financial_transactions_reconciliation
      WHERE negocio_id = $1::uuid;
    `;

    const liqSummarySql = `
      SELECT
        COALESCE(SUM(monto_liquidado) FILTER (WHERE moneda <> 'USDT'), 0)::numeric(14,2) AS zelle_liquidado,
        COALESCE(SUM(monto_liquidado) FILTER (WHERE moneda = 'USDT'), 0)::numeric(14,2) AS binance_liquidado
      FROM liquidaciones_clientes
      WHERE negocio_id = $1::uuid;
    `;

    const [alertsRes, ordersRes, summaryRes, liqSummaryRes] = await Promise.all([
      dbQuery<FinancialTransactionRecord>(alertsSql, params),
      dbQuery<PendingPaymentOrder>(
        pendingOrdersSql,
        scope.negocioId ? [scope.negocioId] : []
      ),
      dbQuery<{
        zelle_bruto: number;
        zelle_comision: number;
        zelle_neto_acumulado: number;
        zelle_ciclo_bruto: number;
        zelle_ciclo_comision: number;
        zelle_ciclo_neto: number;
        zelle_por_conciliar: number;
        zelle_enviado: number;
        binance_bruto: number;
        binance_comision: number;
        binance_neto_acumulado: number;
        binance_ciclo_bruto: number;
        binance_ciclo_comision: number;
        binance_ciclo_neto: number;
        binance_por_conciliar: number;
        binance_enviado: number;
        conciliados_count: number;
        conciliados_historico_count: number;
        revision_count: number;
        detectados_count: number;
      }>(summarySql, [scope.negocioId]),
      dbQuery<{
        zelle_liquidado: number;
        binance_liquidado: number;
      }>(liqSummarySql, [scope.negocioId]),
    ]);

    const s = summaryRes.rows[0];
    const lq = liqSummaryRes.rows[0];
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    const zelleNetoAcum = Number(s?.zelle_neto_acumulado ?? 0);
    const zelleLiq = Number(lq?.zelle_liquidado ?? 0);
    const zelleSaldoPendiente = round2(zelleNetoAcum - zelleLiq);
    const binanceNetoAcum = Number(s?.binance_neto_acumulado ?? 0);
    const binanceLiq = Number(lq?.binance_liquidado ?? 0);
    const binanceSaldoPendiente = round2(binanceNetoAcum - binanceLiq);

    const summaryMetrics: FinancialSummaryMetrics | null = s
      ? {
          zelleBrutoRecibidoUsd: Number(s.zelle_bruto ?? 0),
          zelleComisionRetenidaUsd: Number(s.zelle_comision ?? 0),
          zelleNetoAcumuladoUsd: zelleNetoAcum,
          zelleLiquidadoUsd: zelleLiq,
          zelleNetoLiquidableUsd: zelleSaldoPendiente,
          zelleCicloBrutoUsd: Number(s.zelle_ciclo_bruto ?? 0),
          zelleCicloComisionUsd: Number(s.zelle_ciclo_comision ?? 0),
          zelleCicloNetoUsd: Number(s.zelle_ciclo_neto ?? 0),
          zellePorConciliarUsd: Number(s.zelle_por_conciliar ?? 0),
          zelleBrutoEnviadoUsd: Number(s.zelle_enviado ?? 0),
          binanceRecibidoUsdt: Number(s.binance_bruto ?? 0),
          binanceComisionRetenidaUsdt: Number(s.binance_comision ?? 0),
          binanceNetoAcumuladoUsdt: binanceNetoAcum,
          binanceLiquidadoUsdt: binanceLiq,
          binanceNetoDisponibleUsdt: binanceSaldoPendiente,
          binanceCicloBrutoUsdt: Number(s.binance_ciclo_bruto ?? 0),
          binanceCicloComisionUsdt: Number(s.binance_ciclo_comision ?? 0),
          binanceCicloNetoUsdt: Number(s.binance_ciclo_neto ?? 0),
          binancePorConciliarUsdt: Number(s.binance_por_conciliar ?? 0),
          binanceEnviadoUsdt: Number(s.binance_enviado ?? 0),
          totalBrutoRecibido: round2(
            Number(s.zelle_bruto ?? 0) + Number(s.binance_bruto ?? 0)
          ),
          totalComisionDescontada: round2(
            Number(s.zelle_comision ?? 0) + Number(s.binance_comision ?? 0)
          ),
          totalNetoDisponible: round2(
            zelleSaldoPendiente + binanceSaldoPendiente
          ),
          totalBrutoEnviado: round2(
            Number(s.zelle_enviado ?? 0) + Number(s.binance_enviado ?? 0)
          ),
          pagosConciliadosCount: Number(s.conciliados_count ?? 0),
          pagosConciliadosHistoricoCount: Number(
            s.conciliados_historico_count ?? 0
          ),
          pagosRevisionManualCount: Number(s.revision_count ?? 0),
          pagosDetectadosCount: Number(s.detectados_count ?? 0),
        }
      : null;

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      alerts: alertsRes.rows,
      pendingOrders: ordersRes.rows,
      summaryMetrics,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error consultando PostgreSQL.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

interface SimulateEmailRequestBody {
  negocioId?: string;
  fromAddress?: string;
  subject?: string;
  rawEmailBody?: string;
  messageId?: string;
}

/**
 * Permite probar en vivo el motor híbrido multi-canal (`parseBankAlertEmail`)
 * con correos de Citibank, TD Bank o Binance (Pay / P2P / On-Chain).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const body = (await request.json()) as SimulateEmailRequestBody;
    const authorizedNegocioId = resolveAuthorizedNegocioId(
      auth.session,
      request,
      body.negocioId
    );
    const fromAddress = (body.fromAddress ?? 'alerts@citibank.com').trim();
    const subject = (body.subject ?? 'Citibank Zelle Payment Alert').trim();
    const rawEmailBody = (body.rawEmailBody ?? '').trim();

    if (!rawEmailBody) {
      return NextResponse.json(
        { ok: false, error: 'El cuerpo del correo (rawEmailBody) es obligatorio.' },
        { status: 400 }
      );
    }

    const parsed = await parseBankAlertEmail({
      fromAddress,
      subject,
      textBody: rawEmailBody,
      htmlBody: rawEmailBody,
      receivedDate: new Date(),
    });

    if (!parsed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No fue posible extraer un monto válido del correo con Regex ni AI Fallback.',
        },
        { status: 422 }
      );
    }

    const isBinance = parsed.plataforma.startsWith('BINANCE');
    // En detección inicial sin cliente asignado la comisión es 0.00% hasta conciliar
    const feePercentage = 0.0;
    const feeAmount = 0.0;
    const netAmount = parsed.monto_bruto;

    const domainHint = isBinance
      ? 'directmail.binance.com'
      : parsed.plataforma === 'TD_BANK'
        ? 'tdbank.com'
        : 'alerts.citibank.com';

    const externalUniqueId = (
      body.messageId?.trim() ||
      `<sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${domainHint}>`
    ).slice(0, 180);

    const referenciaFinal = parsed.referencia ?? 'SIN-REF';
    const dedupKey = parsed.referencia
      ? parsed.dedup_key
      : buildDedupKey(parsed.plataforma, externalUniqueId, parsed.monto_bruto);

    const cleanSnapshot = sanitizeEmailContent(rawEmailBody);
    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const demoNegocioId =
        body.negocioId?.trim() ||
        request.headers.get('x-negocio-id')?.trim() ||
        store.businessUsers[0]?.id ||
        null;
      const duplicate = store.transactions.find(
        (t) => t.dedup_key === dedupKey || t.external_unique_id === externalUniqueId
      );

      if (duplicate) {
        return NextResponse.json(
          {
            ok: false,
            error: `Transacción omitida por idempotencia cruzada (dedup_key: ${dedupKey}).`,
          },
          { status: 409 }
        );
      }

      const simulatedRecord: FinancialTransactionRecord = {
        id: crypto.randomUUID(),
        negocio_id: demoNegocioId,
        external_unique_id: externalUniqueId,
        dedup_key: dedupKey,
        plataforma: parsed.plataforma,
        moneda: parsed.moneda,
        tipo_movimiento: parsed.tipo_movimiento,
        monto_bruto: parsed.monto_bruto,
        porcentaje_comision: feePercentage,
        monto_comision: feeAmount,
        monto_neto: netAmount,
        remitente_o_contraparte: parsed.remitente_o_contraparte,
        referencia: referenciaFinal,
        fecha_transaccion: parsed.fecha_transaccion,
        origen_deteccion: parsed.origen_deteccion,
        raw_payload: {
          from: fromAddress,
          subject,
          raw_body: cleanSnapshot,
        },
        estado:
          parsed.origen_deteccion === 'EMAIL_AI' || !parsed.remitente_o_destinatario
            ? 'REVISION_MANUAL'
            : 'DETECTADO',
        cliente_id: null,
        cliente_asignado_nombre: null,
        orden_conciliada_id: null,
        nota_auditoria: `Extraído vía ${parsed.origen_deteccion} (confianza ${Math.round(parsed.confianza * 100)}%).`,
        conciliado_at: null,
        created_at: new Date().toISOString(),
        message_id: externalUniqueId,
        banco: parsed.plataforma,
        remitente_o_destinatario: parsed.remitente_o_destinatario,
        raw_body: cleanSnapshot,
        metodo_extraccion: parsed.metodo_extraccion,
        orden_pago_id: null,
        notas_conciliacion: `Extraído vía ${parsed.origen_deteccion} (confianza ${Math.round(parsed.confianza * 100)}%).`,
      };

      store.transactions.unshift(simulatedRecord);

      // Intentar conciliar contra alguna orden pendiente en DEMO
      if (simulatedRecord.tipo_movimiento === 'RECIBIDO') {
        for (const pendingOrder of store.orders) {
          if (pendingOrder.estado === 'PENDIENTE') {
            const matched = runDemoAutoReconcileForOrder(pendingOrder.id);
            if (matched.reconciled && matched.transaction?.id === simulatedRecord.id) {
              break;
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        alert: simulatedRecord,
      });
    }

    const scope = { negocioId: authorizedNegocioId };
    const initialStatus =
      parsed.origen_deteccion === 'EMAIL_AI' || !parsed.remitente_o_destinatario
        ? 'REVISION_MANUAL'
        : 'DETECTADO';

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

    const insertRes = await dbQuery<FinancialTransactionRecord>(insertSql, [
      scope.negocioId,
      externalUniqueId,
      dedupKey,
      parsed.plataforma,
      parsed.moneda,
      parsed.tipo_movimiento,
      parsed.monto_bruto,
      feePercentage,
      parsed.remitente_o_contraparte,
      referenciaFinal.slice(0, 120),
      parsed.fecha_transaccion,
      parsed.origen_deteccion,
      JSON.stringify({
        from: fromAddress,
        subject,
        raw_body: cleanSnapshot,
      }),
      initialStatus,
    ]);

    const inserted = insertRes.rows[0];
    if (!inserted) {
      return NextResponse.json(
        {
          ok: false,
          error: `Transacción duplicada omitida por idempotencia cruzada (dedup_key: ${dedupKey}).`,
        },
        { status: 409 }
      );
    }

    if (inserted.tipo_movimiento === 'RECIBIDO') {
      await dbQuery<AutoReconciliationResult>(
        'SELECT * FROM fn_auto_conciliar_transaccion($1::uuid);',
        [inserted.id]
      );
    }

    const refreshed = await dbQuery<FinancialTransactionRecord>(
      `
      SELECT
        t.*,
        o.comprobante_base64,
        o.comprobante_mime,
        o.datos_ocr_extraidos,
        o.codigo_orden,
        t.external_unique_id AS message_id,
        t.plataforma AS banco,
        t.remitente_o_contraparte AS remitente_o_destinatario,
        LEFT(COALESCE(t.raw_payload->>'raw_body', (COALESCE(t.raw_payload, '{}'::jsonb) - 'raw_html')::text), 1800) AS raw_body,
        CASE
          WHEN t.origen_deteccion = 'EMAIL_AI' THEN 'AI_FALLBACK'
          WHEN t.origen_deteccion = 'BINANCE_API' THEN 'BINANCE_API'
          ELSE 'REGEX'
        END AS metodo_extraccion,
        t.orden_conciliada_id AS orden_pago_id,
        t.nota_auditoria AS notas_conciliacion
      FROM financial_transactions_reconciliation t
      LEFT JOIN ordenes_pago_pendientes o
        ON o.id = t.orden_conciliada_id
      WHERE t.id = $1::uuid;
      `,
      [inserted.id]
    );

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      alert: refreshed.rows[0] ?? inserted,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error al procesar correo bancario.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

let discardConstraintEnsured = false;

async function ensureDiscardSchemaReady(): Promise<void> {
  if (discardConstraintEnsured) {
    return;
  }
  await dbQuery(
    'ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS descartado_at TIMESTAMPTZ;'
  );
  await dbQuery(`
    DO $$
    BEGIN
      ALTER TABLE financial_transactions_reconciliation DROP CONSTRAINT IF EXISTS financial_transactions_reconciliation_estado_check;
      ALTER TABLE financial_transactions_reconciliation ADD CONSTRAINT financial_transactions_reconciliation_estado_check
        CHECK (estado IN ('DETECTADO', 'CONCILIADO', 'REVISION_MANUAL', 'DESCARTADO'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);
  discardConstraintEnsured = true;
}

interface DiscardAlertsBody {
  alertId?: string;
  alertIds?: string[];
  reason?: string;
}

/**
 * Marca uno o varios correos bancarios no conciliados como `DESCARTADO`
 * (correos propios o ajenos a la conciliación).
 * Conserva el `external_unique_id` / `dedup_key` en BD para evitar que el
 * sincronizador IMAP vuelva a descargarlos en el futuro.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  try {
    const body = (await request.json()) as DiscardAlertsBody;
    const rawIds = [
      ...(body.alertId ? [body.alertId] : []),
      ...(Array.isArray(body.alertIds) ? body.alertIds : []),
    ]
      .map((id) => String(id).trim())
      .filter((id) => id.length > 0);

    const uniqueIds = Array.from(new Set(rawIds));
    if (uniqueIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Debes indicar al menos un correo para eliminar.' },
        { status: 400 }
      );
    }

    const reason = (
      body.reason?.trim() || 'Correo propio o ajeno a la conciliación (eliminado por administrador)'
    ).slice(0, 300);

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const nowIso = new Date().toISOString();
      const discardedIds: string[] = [];

      for (const tx of store.transactions) {
        if (
          uniqueIds.includes(tx.id) &&
          tx.estado !== 'CONCILIADO' &&
          !tx.liquidado_at &&
          !tx.orden_conciliada_id
        ) {
          tx.estado = 'DESCARTADO';
          tx.descartado_at = nowIso;
          tx.nota_auditoria = `Descartado: ${reason}`;
          tx.notas_conciliacion = `Descartado: ${reason}`;
          discardedIds.push(tx.id);
        }
      }

      if (discardedIds.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Ninguno de los correos seleccionados puede eliminarse (ya están conciliados o liquidados).',
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        discardedCount: discardedIds.length,
        discardedIds,
        skippedCount: uniqueIds.length - discardedIds.length,
      });
    }

    await ensureDiscardSchemaReady();

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validUuids = uniqueIds.filter((id) => uuidRegex.test(id));
    if (validUuids.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Identificadores de correo inválidos.' },
        { status: 400 }
      );
    }

    const auditLine = `[DESCARTADO ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC] ${reason}`;

    const updateRes = await dbQuery<{ id: string }>(
      `
      UPDATE financial_transactions_reconciliation
      SET estado = 'DESCARTADO',
          descartado_at = NOW(),
          nota_auditoria = CASE
            WHEN nota_auditoria IS NULL OR TRIM(nota_auditoria) = '' THEN $3
            ELSE nota_auditoria || chr(10) || $3
          END
      WHERE id = ANY($1::uuid[])
        AND ($2::uuid IS NULL OR negocio_id = $2::uuid OR negocio_id IS NULL)
        AND estado IN ('DETECTADO', 'REVISION_MANUAL')
        AND liquidado_at IS NULL
        AND orden_conciliada_id IS NULL
      RETURNING id;
      `,
      [validUuids, authorizedNegocioId || null, auditLine]
    );

    const discardedIds = updateRes.rows.map((r) => r.id);
    if (discardedIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No se pudo eliminar ningún correo. Solo se pueden eliminar correos que no estén conciliados ni liquidados.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      discardedCount: discardedIds.length,
      discardedIds,
      skippedCount: validUuids.length - discardedIds.length,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error al eliminar correos seleccionados.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface RestoreAlertBody {
  action?: 'RESTORE';
  alertId?: string;
}

/**
 * Restaura un correo previamente descartado devolviéndolo al estado `DETECTADO`.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  try {
    const body = (await request.json()) as RestoreAlertBody;
    const alertId = body.alertId?.trim() ?? '';
    if (!alertId) {
      return NextResponse.json(
        { ok: false, error: 'El identificador del correo (alertId) es requerido.' },
        { status: 400 }
      );
    }

    const dbConnected = await isDatabaseAvailable();
    if (!dbConnected) {
      const store = getDemoStore();
      const tx = store.transactions.find(
        (t) => t.id === alertId && t.estado === 'DESCARTADO'
      );
      if (!tx) {
        return NextResponse.json(
          { ok: false, error: 'Correo descartado no encontrado.' },
          { status: 404 }
        );
      }
      tx.estado = 'DETECTADO';
      tx.descartado_at = null;
      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        restoredId: tx.id,
      });
    }

    await ensureDiscardSchemaReady();

    const restoreRes = await dbQuery<{ id: string }>(
      `
      UPDATE financial_transactions_reconciliation
      SET estado = 'DETECTADO',
          descartado_at = NULL,
          nota_auditoria = CASE
            WHEN nota_auditoria IS NULL OR TRIM(nota_auditoria) = '' THEN 'Restaurado a DETECTADO por administrador'
            ELSE nota_auditoria || chr(10) || '[RESTAURADO] Devuelto a DETECTADO por administrador'
          END
      WHERE id = $1::uuid
        AND ($2::uuid IS NULL OR negocio_id = $2::uuid OR negocio_id IS NULL)
        AND estado = 'DESCARTADO'
      RETURNING id;
      `,
      [alertId, authorizedNegocioId || null]
    );

    if (!restoreRes.rows[0]) {
      return NextResponse.json(
        { ok: false, error: 'El correo no existe o no se encuentra en estado DESCARTADO.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      restoredId: restoreRes.rows[0].id,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al restaurar correo.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
