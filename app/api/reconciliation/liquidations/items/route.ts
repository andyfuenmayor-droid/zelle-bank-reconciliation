import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  getAdminSession,
  getClientSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';
import {
  ClientLiquidationRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminSession = getAdminSession(request);
  const clientSession = getClientSession(request);

  if (!adminSession && !clientSession) {
    return NextResponse.json(
      { ok: false, error: 'Debes iniciar sesión para consultar ciclos liquidados.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const liquidacionId = (searchParams.get('liquidacionId') ?? '').trim();

  if (!liquidacionId || !UUID_REGEX.test(liquidacionId)) {
    return NextResponse.json(
      { ok: false, error: 'Parámetro liquidacionId inválido.' },
      { status: 400 }
    );
  }

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      liquidacion: null,
      items: [],
      summary: {
        totalCount: 0,
        portalCount: 0,
        directCount: 0,
        totalBruto: 0,
        totalComision: 0,
        totalNeto: 0,
      },
    });
  }

  try {
    const authorizedNegocioId = adminSession
      ? resolveAuthorizedNegocioId(adminSession, request)
      : null;

    const liqRes = adminSession
      ? await dbQuery<ClientLiquidationRecord>(
          `
          SELECT *
          FROM (
            SELECT
              id,
              codigo_liquidacion,
              ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY created_at ASC, id ASC)::int AS numero_ciclo,
              negocio_id,
              cliente_id,
              cliente_nombre,
              monto_liquidado,
              moneda,
              destinatario_beneficiario,
              motivo_concepto,
              metodo_pago_salida,
              referencia_salida,
              saldo_anterior,
              saldo_restante,
              liquidado_por,
              notas_operador,
              created_at
            FROM liquidaciones_clientes
          ) ranked_liq
          WHERE id = $1::uuid
            AND ($2::uuid IS NULL OR negocio_id = $2::uuid OR negocio_id IS NULL)
          LIMIT 1;
          `,
          [liquidacionId, authorizedNegocioId]
        )
      : await dbQuery<ClientLiquidationRecord>(
          `
          SELECT *
          FROM (
            SELECT
              id,
              codigo_liquidacion,
              ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY created_at ASC, id ASC)::int AS numero_ciclo,
              negocio_id,
              cliente_id,
              cliente_nombre,
              monto_liquidado,
              moneda,
              destinatario_beneficiario,
              motivo_concepto,
              metodo_pago_salida,
              referencia_salida,
              saldo_anterior,
              saldo_restante,
              liquidado_por,
              notas_operador,
              created_at
            FROM liquidaciones_clientes
            WHERE cliente_id = $2::uuid
          ) ranked_liq
          WHERE id = $1::uuid
          LIMIT 1;
          `,
          [liquidacionId, clientSession!.clienteId]
        );

    const liquidacion = liqRes.rows[0];
    if (!liquidacion) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Liquidación no encontrada o sin permisos para consultarla.',
        },
        { status: 404 }
      );
    }

    const itemsRes = await dbQuery<PendingPaymentOrder>(
      `
      SELECT *
      FROM (
        SELECT
          o.id,
          o.codigo_orden::text AS codigo_orden,
          o.cliente_id,
          o.cliente_nombre::text AS cliente_nombre,
          o.cliente_email::text AS cliente_email,
          COALESCE(o.plataforma_esperada, o.banco_destino, 'CITIBANK')::text AS plataforma_esperada,
          COALESCE(o.banco_destino, o.plataforma_esperada, 'CITIBANK')::text AS banco_destino,
          COALESCE(o.moneda, 'USD')::text AS moneda,
          o.monto_esperado::numeric(12,2) AS monto_esperado,
          o.fecha_transferencia::text AS fecha_transferencia,
          COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, o.cliente_nombre)::text AS remitente_reportado,
          COALESCE(o.nombre_remitente_reportado, o.remitente_reportado, o.cliente_nombre)::text AS nombre_remitente_reportado,
          o.referencia_reportada::text AS referencia_reportada,
          (CASE WHEN o.comprobante_base64 IS NOT NULL AND LENGTH(o.comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
          NULL::text AS comprobante_base64,
          o.comprobante_mime::text AS comprobante_mime,
          o.datos_ocr_extraidos,
          o.estado::text AS estado,
          COALESCE(o.transaccion_conciliada_id, o.alerta_conciliada_id) AS transaccion_conciliada_id,
          o.liquidacion_id,
          o.liquidado_at,
          o.notas_cliente::text AS notas_cliente,
          'PORTAL_CLIENTE'::text AS origen_registro,
          o.created_at,
          o.updated_at,
          t.fecha_transaccion AS tx_fecha_correo,
          t.remitente_o_contraparte::text AS tx_remitente_correo,
          t.referencia::text AS tx_referencia_correo,
          t.monto_bruto::numeric(12,2) AS tx_monto_bruto,
          t.porcentaje_comision::numeric(5,2) AS tx_porcentaje_comision,
          t.monto_comision::numeric(12,2) AS tx_monto_comision,
          t.monto_neto::numeric(12,2) AS tx_monto_neto
        FROM ordenes_pago_pendientes o
        LEFT JOIN financial_transactions_reconciliation t
          ON t.id = COALESCE(o.transaccion_conciliada_id, o.alerta_conciliada_id)
        WHERE (o.liquidacion_id = $1::uuid OR t.liquidacion_id = $1::uuid)
          AND o.cliente_id = $2::uuid

        UNION ALL

        SELECT
          t.id,
          ('DIR-' || UPPER(SUBSTRING(REPLACE(t.id::text, '-', ''), 1, 8)))::text AS codigo_orden,
          COALESCE(t.cliente_id, $2::uuid) AS cliente_id,
          COALESCE(t.cliente_asignado_nombre, $3)::text AS cliente_nombre,
          ''::text AS cliente_email,
          COALESCE(t.plataforma, 'CITIBANK')::text AS plataforma_esperada,
          COALESCE(t.plataforma, 'CITIBANK')::text AS banco_destino,
          COALESCE(t.moneda, 'USD')::text AS moneda,
          t.monto_bruto::numeric(12,2) AS monto_esperado,
          NULL::text AS fecha_transferencia,
          COALESCE(t.remitente_o_contraparte, t.cliente_asignado_nombre, $3)::text AS remitente_reportado,
          COALESCE(t.remitente_o_contraparte, t.cliente_asignado_nombre, $3)::text AS nombre_remitente_reportado,
          t.referencia::text AS referencia_reportada,
          false AS has_capture,
          NULL::text AS comprobante_base64,
          NULL::text AS comprobante_mime,
          '{}'::jsonb AS datos_ocr_extraidos,
          'LIQUIDADO'::text AS estado,
          t.id AS transaccion_conciliada_id,
          t.liquidacion_id,
          t.liquidado_at,
          t.nota_auditoria::text AS notas_cliente,
          'ADMIN_DIRECTA'::text AS origen_registro,
          COALESCE(t.conciliado_at, t.created_at) AS created_at,
          COALESCE(t.conciliado_at, t.created_at) AS updated_at,
          t.fecha_transaccion AS tx_fecha_correo,
          t.remitente_o_contraparte::text AS tx_remitente_correo,
          t.referencia::text AS tx_referencia_correo,
          t.monto_bruto::numeric(12,2) AS tx_monto_bruto,
          t.porcentaje_comision::numeric(5,2) AS tx_porcentaje_comision,
          t.monto_comision::numeric(12,2) AS tx_monto_comision,
          t.monto_neto::numeric(12,2) AS tx_monto_neto
        FROM financial_transactions_reconciliation t
        WHERE t.liquidacion_id = $1::uuid
          AND t.estado = 'CONCILIADO'
          AND t.tipo_movimiento = 'RECIBIDO'
          AND NOT EXISTS (
            SELECT 1
            FROM ordenes_pago_pendientes o2
            WHERE o2.id = t.orden_conciliada_id
               OR o2.transaccion_conciliada_id = t.id
               OR o2.alerta_conciliada_id = t.id
          )
      ) archived_cycle
      ORDER BY COALESCE(tx_fecha_correo, created_at) DESC, created_at DESC
      LIMIT 1500;
      `,
      [liquidacion.id, liquidacion.cliente_id, liquidacion.cliente_nombre]
    );

    const items = itemsRes.rows;
    let totalBruto = 0;
    let totalComision = 0;
    let totalNeto = 0;
    let portalCount = 0;
    let directCount = 0;

    for (const item of items) {
      if (item.origen_registro === 'ADMIN_DIRECTA') {
        directCount += 1;
      } else {
        portalCount += 1;
      }
      totalBruto += Number(item.tx_monto_bruto ?? item.monto_esperado ?? 0);
      totalComision += Number(item.tx_monto_comision ?? 0);
      totalNeto += Number(item.tx_monto_neto ?? 0);
    }

    const round2 = (v: number): number => Math.round(v * 100) / 100;

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      liquidacion,
      items,
      summary: {
        totalCount: items.length,
        portalCount,
        directCount,
        totalBruto: round2(totalBruto),
        totalComision: round2(totalComision),
        totalNeto: round2(totalNeto),
      },
    });
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Error consultando el detalle de pagos de la liquidación.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
