import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  AutoReconciliationResult,
  BankName,
  ClientAccountRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      clients: [],
      pendingOrders: [],
    });
  }

  try {
    const clientsSql = `
      SELECT
        c.id,
        c.nombre_titular,
        c.email_contacto,
        c.telefono,
        c.remitentes_zelle_habituales,
        c.porcentaje_comision,
        c.activo,
        c.created_at,
        COALESCE(SUM(a.monto_bruto) FILTER (WHERE a.estado = 'CONCILIADO' AND a.tipo_movimiento = 'RECIBIDO'), 0)::numeric(12,2) AS total_bruto_conciliado,
        COALESCE(SUM(a.monto_comision) FILTER (WHERE a.estado = 'CONCILIADO' AND a.tipo_movimiento = 'RECIBIDO'), 0)::numeric(12,2) AS total_comision_retenida,
        COALESCE(SUM(a.monto_neto) FILTER (WHERE a.estado = 'CONCILIADO' AND a.tipo_movimiento = 'RECIBIDO'), 0)::numeric(12,2) AS total_neto_disponible,
        COUNT(a.id) FILTER (WHERE a.estado = 'CONCILIADO' AND a.tipo_movimiento = 'RECIBIDO')::int AS pagos_conciliados_count
      FROM clientes_titulares c
      LEFT JOIN bank_email_alerts a
        ON UPPER(TRIM(COALESCE(a.cliente_asignado_nombre, ''))) = UPPER(TRIM(c.nombre_titular))
      GROUP BY c.id
      ORDER BY c.created_at DESC;
    `;

    const ordersSql = `
      SELECT
        id,
        codigo_orden,
        cliente_id,
        cliente_nombre,
        cliente_email,
        nombre_remitente_reportado,
        banco_destino,
        monto_esperado,
        referencia_reportada,
        estado,
        created_at
      FROM ordenes_pago_pendientes
      WHERE estado = 'PENDIENTE'
      ORDER BY created_at DESC;
    `;

    const [clientsRes, ordersRes] = await Promise.all([
      dbQuery<ClientAccountRecord>(clientsSql),
      dbQuery<PendingPaymentOrder>(ordersSql),
    ]);

    return NextResponse.json({
      ok: true,
      clients: clientsRes.rows,
      pendingOrders: ordersRes.rows,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error consultando clientes.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface ClientOrOrderPostBody {
  action?: 'CREATE_CLIENT' | 'CREATE_ORDER';
  // Campos para CREATE_CLIENT
  nombreTitular?: string;
  emailContacto?: string;
  telefono?: string;
  remitentesZelleHabituales?: string;
  porcentajeComision?: number;
  // Campos para CREATE_ORDER
  clienteId?: string;
  clienteNombre?: string;
  clienteEmail?: string;
  nombreRemitenteReportado?: string;
  bancoDestino?: BankName;
  montoEsperado?: number;
  referenciaReportada?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ClientOrOrderPostBody;
    const action = body.action ?? 'CREATE_CLIENT';

    if (action === 'CREATE_CLIENT') {
      const nombreTitular = (body.nombreTitular ?? '').trim();
      const emailContacto = (body.emailContacto ?? '').trim() || null;
      const telefono = (body.telefono ?? '').trim() || null;
      const remitentesZelleHabituales =
        (body.remitentesZelleHabituales ?? '').trim() || null;
      const porcentajeComision =
        typeof body.porcentajeComision === 'number' &&
        Number.isFinite(body.porcentajeComision)
          ? body.porcentajeComision
          : 4.0;

      if (nombreTitular.length < 2) {
        return NextResponse.json(
          { ok: false, error: 'El nombre del cliente titular es obligatorio.' },
          { status: 400 }
        );
      }

      const insertRes = await dbQuery<ClientAccountRecord>(
        `
        INSERT INTO clientes_titulares (
          nombre_titular,
          email_contacto,
          telefono,
          remitentes_zelle_habituales,
          porcentaje_comision
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          nombre_titular,
          email_contacto,
          telefono,
          remitentes_zelle_habituales,
          porcentaje_comision,
          activo,
          created_at,
          0::numeric(12,2) AS total_bruto_conciliado,
          0::numeric(12,2) AS total_comision_retenida,
          0::numeric(12,2) AS total_neto_disponible,
          0::int AS pagos_conciliados_count;
        `,
        [
          nombreTitular,
          emailContacto,
          telefono,
          remitentesZelleHabituales,
          porcentajeComision,
        ]
      );

      // Intentar conciliar automáticamente alertas pendientes que coincidan con este nuevo cliente
      const pendingAlerts = await dbQuery<{ id: string }>(
        `SELECT id FROM bank_email_alerts WHERE estado <> 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO';`
      );

      let autoReconciledCount = 0;
      for (const row of pendingAlerts.rows) {
        const rec = await dbQuery<AutoReconciliationResult>(
          'SELECT * FROM fn_conciliar_pago_zelle($1::uuid);',
          [row.id]
        );
        if (rec.rows[0]?.conciliado) {
          autoReconciledCount += 1;
        }
      }

      return NextResponse.json({
        ok: true,
        client: insertRes.rows[0],
        autoReconciledCount,
      });
    }

    if (action === 'CREATE_ORDER') {
      const clienteNombre = (body.clienteNombre ?? '').trim();
      const clienteEmail = (body.clienteEmail ?? 'cliente@conciliarcuenta.com').trim();
      const nombreRemitenteReportado = (
        body.nombreRemitenteReportado || clienteNombre
      ).trim();
      const bancoDestino: BankName = body.bancoDestino ?? 'CITIBANK';
      const montoEsperado = Number(body.montoEsperado ?? 0);
      const referenciaReportada =
        (body.referenciaReportada ?? '').trim() || null;
      const clienteId = body.clienteId?.trim() || crypto.randomUUID();

      if (!clienteNombre || !Number.isFinite(montoEsperado) || montoEsperado <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error: 'El nombre del cliente y un monto esperado mayor a 0 son obligatorios.',
          },
          { status: 400 }
        );
      }

      const codigoOrden = `ORD-${new Date().getFullYear()}-${Math.floor(
        1000 + Math.random() * 9000
      )}`;

      const orderRes = await dbQuery<PendingPaymentOrder>(
        `
        INSERT INTO ordenes_pago_pendientes (
          codigo_orden,
          cliente_id,
          cliente_nombre,
          cliente_email,
          nombre_remitente_reportado,
          banco_destino,
          monto_esperado,
          referencia_reportada,
          estado
        )
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, 'PENDIENTE')
        RETURNING *;
        `,
        [
          codigoOrden,
          clienteId,
          clienteNombre,
          clienteEmail,
          nombreRemitenteReportado,
          bancoDestino,
          montoEsperado,
          referenciaReportada,
        ]
      );

      // Intentar conciliar con alertas ya detectadas en la tabla
      const pendingAlerts = await dbQuery<{ id: string }>(
        `SELECT id FROM bank_email_alerts WHERE estado <> 'CONCILIADO' AND tipo_movimiento = 'RECIBIDO' AND monto_bruto = $1;`,
        [montoEsperado]
      );

      let autoReconciledCount = 0;
      for (const row of pendingAlerts.rows) {
        const rec = await dbQuery<AutoReconciliationResult>(
          'SELECT * FROM fn_conciliar_pago_zelle($1::uuid);',
          [row.id]
        );
        if (rec.rows[0]?.conciliado) {
          autoReconciledCount += 1;
        }
      }

      return NextResponse.json({
        ok: true,
        order: orderRes.rows[0],
        autoReconciledCount,
      });
    }

    return NextResponse.json(
      { ok: false, error: 'Acción no reconocida.' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error guardando registro.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
