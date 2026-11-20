import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { getDemoStore } from '@/lib/mock-seed-data';
import {
  requireAdminSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';
import { FinancialTransactionRecord } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RevertReconciliationPayload {
  alertId?: string;
  motivo?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  try {
    const body = (await request.json()) as RevertReconciliationPayload;
    const alertId = body.alertId?.trim() ?? '';
    const motivo = body.motivo?.trim() || 'Reversión manual por el administrador';

    if (!alertId) {
      return NextResponse.json(
        { ok: false, error: 'El parámetro alertId es requerido.' },
        { status: 400 }
      );
    }

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const tx = store.transactions.find((t) => t.id === alertId);
      if (!tx) {
        return NextResponse.json(
          { ok: false, error: 'Transacción no encontrada en modo Demo.' },
          { status: 404 }
        );
      }

      if (tx.orden_conciliada_id) {
        const order = store.orders.find((o) => o.id === tx.orden_conciliada_id);
        if (order) {
          order.estado = 'PENDIENTE';
          order.transaccion_conciliada_id = null;
        }
      }

      tx.estado = 'REVISION_MANUAL';
      tx.cliente_id = null;
      tx.cliente_asignado_nombre = null;
      tx.orden_conciliada_id = null;
      tx.conciliado_at = null;
      tx.nota_auditoria = `Conciliación revertida manualmente: ${motivo}`;

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        alert: tx,
      });
    }

      const result = await withTransaction<FinancialTransactionRecord | null>(
      async (client) => {
        const txRes = await client.query<{
          id: string;
          external_unique_id: string;
          plataforma: string;
          monto_bruto: number;
          estado: string;
          cliente_id: string | null;
          cliente_asignado_nombre: string | null;
          orden_conciliada_id: string | null;
          remitente_o_contraparte: string;
          nota_auditoria: string | null;
          liquidado_at: string | null;
        }>(
          `
          SELECT
            id,
            external_unique_id,
            plataforma,
            monto_bruto,
            estado,
            cliente_id,
            cliente_asignado_nombre,
            orden_conciliada_id,
            remitente_o_contraparte,
            nota_auditoria,
            liquidado_at
          FROM financial_transactions_reconciliation
          WHERE id = $1::uuid
            AND (negocio_id = $2::uuid OR negocio_id IS NULL)
          FOR UPDATE;
          `,
          [alertId, authorizedNegocioId]
        );

        const currentTx = txRes.rows[0];
        if (!currentTx) {
          throw new Error('La transacción bancaria especificada no fue encontrada.');
        }

        if (currentTx.estado !== 'CONCILIADO') {
          throw new Error(
            `Solo se pueden revertir transacciones en estado CONCILIADO (estado actual: ${currentTx.estado}).`
          );
        }

        if (currentTx.liquidado_at) {
          throw new Error(
            'No se puede deshacer esta conciliación porque el pago ya fue liquidado y archivado.'
          );
        }

        const prevClientName = currentTx.cliente_asignado_nombre || 'Desconocido';
        const prevClientId = currentTx.cliente_id;
        const linkedOrderId = currentTx.orden_conciliada_id;
        const sender = currentTx.remitente_o_contraparte?.trim() ?? '';

        // 1. Revertir la orden de pago vinculada (si existe)
        if (linkedOrderId) {
          await client.query(
            `
            UPDATE ordenes_pago_pendientes
            SET estado = 'PENDIENTE',
                transaccion_conciliada_id = NULL,
                alerta_conciliada_id = NULL,
                conciliado_at = NULL,
                conciliado_por = NULL,
                updated_at = NOW()
            WHERE id = $1::uuid;
            `,
            [linkedOrderId]
          );
        }

        // 2. Si el remitente fue aprendido en clientes_titulares, retirarlo para evitar re-conciliación automática
        if (prevClientId && sender.length >= 3) {
          await client.query(
            `
            UPDATE clientes_titulares
            SET remitentes_autorizados = ARRAY_REMOVE(
              COALESCE(remitentes_autorizados, ARRAY[]::text[]),
              $1
            )
            WHERE id = $2::uuid;
            `,
            [sender, prevClientId]
          ).catch((e) => console.error('[Revert] Error eliminando remitente aprendido:', e));
        }

        // 3. Si fue una transacción creada manualmente sin correo bancario (MANUAL-ORD-...), eliminarla para que la orden vuelva limpia a PENDIENTE
        if ((currentTx.external_unique_id || '').startsWith('MANUAL-ORD-')) {
          await client.query(
            `
            DELETE FROM financial_transactions_reconciliation
            WHERE id = $1::uuid;
            `,
            [alertId]
          );
          return null;
        }

        // 4. Al revertir un correo bancario real, la comisión vuelve a 0.00% porque la transacción vuelve a estar sin cliente asignado
        const defaultFee = 0.0;
        const auditLog = `Conciliación revertida por el administrador el ${new Date().toISOString().slice(0, 16)}. Motivo: ${motivo}. (Anteriormente asignado por error a: ${prevClientName}).`;

        // 5. Actualizar la transacción bancaria a REVISION_MANUAL y desvincular
        const updatedTxRes = await client.query<FinancialTransactionRecord>(
          `
          UPDATE financial_transactions_reconciliation
          SET estado = 'REVISION_MANUAL',
              cliente_id = NULL,
              cliente_asignado_nombre = NULL,
              orden_conciliada_id = NULL,
              conciliado_at = NULL,
              porcentaje_comision = $2,
              nota_auditoria = $3
          WHERE id = $1::uuid
          RETURNING
            *,
            external_unique_id AS message_id,
            plataforma AS banco,
            remitente_o_contraparte AS remitente_o_destinatario,
            COALESCE(raw_payload->>'raw_body', raw_payload::text) AS raw_body,
            CASE
              WHEN origen_deteccion = 'EMAIL_AI' THEN 'AI_FALLBACK'
              WHEN origen_deteccion = 'BINANCE_API' THEN 'BINANCE_API'
              ELSE 'REGEX'
            END AS metodo_extraccion,
            orden_conciliada_id AS orden_pago_id,
            nota_auditoria AS notas_conciliacion;
          `,
          [alertId, defaultFee, auditLog]
        );

        return updatedTxRes.rows[0];
      }
    );

    return NextResponse.json({
      ok: true,
      alert: result,
      message: 'Conciliación revertida exitosamente. El saldo del cliente ha sido actualizado.',
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error inesperado al revertir conciliación.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
