import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { BankEmailAlertRecord, PendingPaymentOrder } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ManualMatchPayload {
  alertId?: string;
  ordenPagoId?: string | null;
  clienteNombreManual?: string;
  notasConciliacion?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as ManualMatchPayload;
    const alertId = body.alertId?.trim() ?? '';
    const ordenPagoId = body.ordenPagoId?.trim() || null;
    const clienteNombreManual = body.clienteNombreManual?.trim() ?? '';
    const notasConciliacion = body.notasConciliacion?.trim() ?? '';

    if (!alertId) {
      return NextResponse.json(
        { ok: false, error: 'El identificador de la alerta (alertId) es requerido.' },
        { status: 400 }
      );
    }

    if (!ordenPagoId && clienteNombreManual.length < 3) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Debe seleccionar una orden de pago pendiente o especificar el nombre del cliente titular.',
        },
        { status: 400 }
      );
    }

    const dbConnected = await isDatabaseAvailable();

    // Si PostgreSQL aún no está conectado localmente, confirmar para actualización optimista en el panel
    if (!dbConnected) {
      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        reconciledAt: new Date().toISOString(),
      });
    }

    const updatedAlert = await withTransaction<BankEmailAlertRecord>(async (client) => {
      let resolvedClientName = clienteNombreManual;
      let resolvedOrderCode = '';

      if (ordenPagoId) {
        const orderRes = await client.query<PendingPaymentOrder>(
          `
          UPDATE ordenes_pago_pendientes
          SET estado = 'CONCILIADO',
              alerta_conciliada_id = $1::uuid,
              conciliado_por = 'MANUAL_ADMIN',
              score_similitud = 1.0000,
              conciliado_at = NOW(),
              updated_at = NOW()
          WHERE id = $2::uuid
          RETURNING *;
          `,
          [alertId, ordenPagoId]
        );

        const matchedOrder = orderRes.rows[0];
        if (!matchedOrder) {
          throw new Error('La orden de pago seleccionada no existe.');
        }

        resolvedClientName = matchedOrder.cliente_nombre;
        resolvedOrderCode = matchedOrder.codigo_orden;
      }

      const auditNote =
        notasConciliacion.length > 0
          ? notasConciliacion
          : resolvedOrderCode
            ? `Conciliación manual autorizada con orden ${resolvedOrderCode} (Titular: ${resolvedClientName}).`
            : `Conciliación manual directa asignada al cliente: ${resolvedClientName}.`;

      const alertRes = await client.query<BankEmailAlertRecord>(
        `
        UPDATE bank_email_alerts
        SET estado = 'CONCILIADO',
            orden_pago_id = $2::uuid,
            cliente_asignado_nombre = $3,
            notas_conciliacion = $4,
            conciliado_at = NOW()
        WHERE id = $1::uuid
        RETURNING *;
        `,
        [alertId, ordenPagoId, resolvedClientName, auditNote]
      );

      const alertRow = alertRes.rows[0];
      if (!alertRow) {
        throw new Error('La alerta bancaria especificada no fue encontrada.');
      }

      return alertRow;
    });

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      alert: updatedAlert,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Error interno durante la conciliación manual.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
