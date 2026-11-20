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
        t.raw_payload,
        t.estado,
        t.cliente_id,
        t.cliente_asignado_nombre,
        t.orden_conciliada_id,
        t.nota_auditoria,
        t.conciliado_at,
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
        COALESCE(t.raw_payload->>'raw_body', t.raw_payload::text) AS raw_body,
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
      ${whereClause}
      ORDER BY t.fecha_transaccion DESC, t.created_at DESC
      LIMIT 250;
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
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_neto,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado <> 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_por_conciliar,
        COALESCE(SUM(monto_bruto) FILTER (WHERE tipo_movimiento = 'ENVIADO' AND NOT (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS zelle_enviado,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_bruto,
        COALESCE(SUM(monto_comision) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_comision,
        COALESCE(SUM(monto_neto) FILTER (WHERE estado = 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_neto,
        COALESCE(SUM(monto_bruto) FILTER (WHERE estado <> 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_por_conciliar,
        COALESCE(SUM(monto_bruto) FILTER (WHERE tipo_movimiento = 'ENVIADO' AND (plataforma LIKE 'BINANCE%' OR moneda = 'USDT')), 0)::numeric(14,2) AS binance_enviado,
        COUNT(*) FILTER (WHERE estado = 'CONCILIADO')::int AS conciliados_count,
        COUNT(*) FILTER (WHERE estado = 'REVISION_MANUAL')::int AS revision_count,
        COUNT(*) FILTER (WHERE estado = 'DETECTADO')::int AS detectados_count
      FROM financial_transactions_reconciliation
      WHERE negocio_id = $1::uuid;
    `;

    const [alertsRes, ordersRes, summaryRes] = await Promise.all([
      dbQuery<FinancialTransactionRecord>(alertsSql, params),
      dbQuery<PendingPaymentOrder>(
        pendingOrdersSql,
        scope.negocioId ? [scope.negocioId] : []
      ),
      dbQuery<{
        zelle_bruto: number;
        zelle_comision: number;
        zelle_neto: number;
        zelle_por_conciliar: number;
        zelle_enviado: number;
        binance_bruto: number;
        binance_comision: number;
        binance_neto: number;
        binance_por_conciliar: number;
        binance_enviado: number;
        conciliados_count: number;
        revision_count: number;
        detectados_count: number;
      }>(summarySql, [scope.negocioId]),
    ]);

    const s = summaryRes.rows[0];
    const summaryMetrics: FinancialSummaryMetrics | null = s
      ? {
          zelleBrutoRecibidoUsd: Number(s.zelle_bruto ?? 0),
          zelleComisionRetenidaUsd: Number(s.zelle_comision ?? 0),
          zelleNetoLiquidableUsd: Number(s.zelle_neto ?? 0),
          zellePorConciliarUsd: Number(s.zelle_por_conciliar ?? 0),
          zelleBrutoEnviadoUsd: Number(s.zelle_enviado ?? 0),
          binanceRecibidoUsdt: Number(s.binance_bruto ?? 0),
          binanceComisionRetenidaUsdt: Number(s.binance_comision ?? 0),
          binanceNetoDisponibleUsdt: Number(s.binance_neto ?? 0),
          binancePorConciliarUsdt: Number(s.binance_por_conciliar ?? 0),
          binanceEnviadoUsdt: Number(s.binance_enviado ?? 0),
          totalBrutoRecibido:
            Math.round((Number(s.zelle_bruto ?? 0) + Number(s.binance_bruto ?? 0)) * 100) / 100,
          totalComisionDescontada:
            Math.round((Number(s.zelle_comision ?? 0) + Number(s.binance_comision ?? 0)) * 100) / 100,
          totalNetoDisponible:
            Math.round((Number(s.zelle_neto ?? 0) + Number(s.binance_neto ?? 0)) * 100) / 100,
          totalBrutoEnviado:
            Math.round((Number(s.zelle_enviado ?? 0) + Number(s.binance_enviado ?? 0)) * 100) / 100,
          pagosConciliadosCount: Number(s.conciliados_count ?? 0),
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
        COALESCE(t.raw_payload->>'raw_body', t.raw_payload::text) AS raw_body,
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
