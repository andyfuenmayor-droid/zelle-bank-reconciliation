import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { getDemoStore } from '@/lib/mock-seed-data';
import {
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

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
        { ok: false, error: 'El identificador de la transacción (alertId) es requerido.' },
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

    if (!dbConnected) {
      const store = getDemoStore();
      const tx = store.transactions.find((t) => t.id === alertId);
      if (!tx) {
        return NextResponse.json(
          { ok: false, error: 'Transacción no encontrada en modo Demo.' },
          { status: 404 }
        );
      }

      let resolvedClientId: string | null = null;
      let resolvedClientName = clienteNombreManual;
      let resolvedOrderCode = '';

      if (ordenPagoId) {
        const order = store.orders.find((o) => o.id === ordenPagoId);
        if (!order) {
          return NextResponse.json(
            { ok: false, error: 'La orden seleccionada no existe.' },
            { status: 404 }
          );
        }
        order.estado = 'CONCILIADO';
        order.transaccion_conciliada_id = tx.id;
        order.updated_at = new Date().toISOString();

        resolvedClientId = order.cliente_id;
        resolvedClientName = order.cliente_nombre;
        resolvedOrderCode = order.codigo_orden;

        tx.comprobante_base64 = order.comprobante_base64;
        tx.comprobante_mime = order.comprobante_mime;
        tx.datos_ocr_extraidos = order.datos_ocr_extraidos;
        tx.codigo_orden = order.codigo_orden;
      } else {
        const clientMatch = store.clients.find(
          (c) =>
            c.nombre_titular.toLowerCase() === clienteNombreManual.toLowerCase()
        );
        if (clientMatch) {
          resolvedClientId = clientMatch.id;
          resolvedClientName = clientMatch.nombre_titular;
        }
      }

      const clientRecord = store.clients.find(
        (c) =>
          (resolvedClientId && c.id === resolvedClientId) ||
          c.nombre_titular.toLowerCase() === resolvedClientName.toLowerCase()
      );

      if (clientRecord) {
        resolvedClientId = clientRecord.id;
        const feePct = tx.plataforma.startsWith('BINANCE')
          ? clientRecord.porcentaje_comision_binance
          : clientRecord.porcentaje_comision_zelle;
        tx.porcentaje_comision = feePct;
        tx.monto_comision =
          Math.round(tx.monto_bruto * (feePct / 100) * 100) / 100;
        tx.monto_neto =
          Math.round((tx.monto_bruto - tx.monto_comision) * 100) / 100;
      }

      const nowIso = new Date().toISOString();
      const auditNote =
        notasConciliacion.length > 0
          ? notasConciliacion
          : resolvedOrderCode
            ? `Conciliación manual autorizada con orden ${resolvedOrderCode} (Titular: ${resolvedClientName}).`
            : `Conciliación manual directa asignada al cliente: ${resolvedClientName}.`;

      tx.estado = 'CONCILIADO';
      tx.orden_conciliada_id = ordenPagoId;
      tx.orden_pago_id = ordenPagoId;
      tx.cliente_id = resolvedClientId;
      tx.cliente_asignado_nombre = resolvedClientName;
      tx.nota_auditoria = auditNote;
      tx.notas_conciliacion = auditNote;
      tx.conciliado_at = nowIso;

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        reconciledAt: nowIso,
        alert: tx,
      });
    }

    const updatedAlert = await withTransaction<FinancialTransactionRecord>(
      async (client) => {
        const currentTxRes = await client.query<{
          id: string;
          plataforma: string;
          porcentaje_comision: number;
          remitente_o_contraparte: string;
        }>(
          `
          SELECT id, plataforma, porcentaje_comision, remitente_o_contraparte
          FROM financial_transactions_reconciliation
          WHERE id = $1::uuid
          FOR UPDATE;
          `,
          [alertId]
        );

        const currentTx = currentTxRes.rows[0];
        if (!currentTx) {
          throw new Error('La transacción financiera especificada no fue encontrada.');
        }

        let resolvedClientId: string | null = null;
        let resolvedClientName = clienteNombreManual;
        let resolvedOrderCode = '';

        if (ordenPagoId) {
          const orderRes = await client.query<PendingPaymentOrder>(
            `
            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = $1::uuid,
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

          resolvedClientId = matchedOrder.cliente_id;
          resolvedClientName = matchedOrder.cliente_nombre;
          resolvedOrderCode = matchedOrder.codigo_orden;
        } else {
          const clientLookup = await client.query<{
            id: string;
            nombre_titular: string;
          }>(
            `
            SELECT id, nombre_titular
            FROM clientes_titulares
            WHERE UPPER(TRIM(nombre_titular)) = UPPER(TRIM($1))
            LIMIT 1;
            `,
            [clienteNombreManual]
          );
          if (clientLookup.rows[0]) {
            resolvedClientId = clientLookup.rows[0].id;
            resolvedClientName = clientLookup.rows[0].nombre_titular;
          }
        }

        let effectiveFee = currentTx.porcentaje_comision;
        if (resolvedClientId) {
          const feeLookup = await client.query<{
            porcentaje_comision_zelle: number;
            porcentaje_comision_binance: number;
          }>(
            `
            SELECT porcentaje_comision_zelle, porcentaje_comision_binance
            FROM clientes_titulares
            WHERE id = $1::uuid
            LIMIT 1;
            `,
            [resolvedClientId]
          );
          const feeRow = feeLookup.rows[0];
          if (feeRow) {
            effectiveFee = currentTx.plataforma.startsWith('BINANCE')
              ? feeRow.porcentaje_comision_binance
              : feeRow.porcentaje_comision_zelle;
          }
        }

        const auditNote =
          notasConciliacion.length > 0
            ? notasConciliacion
            : resolvedOrderCode
              ? `Conciliación manual autorizada con orden ${resolvedOrderCode} (Titular: ${resolvedClientName}).`
              : `Conciliación manual directa asignada al cliente: ${resolvedClientName}.`;

        const txRes = await client.query<FinancialTransactionRecord>(
          `
          UPDATE financial_transactions_reconciliation
          SET estado = 'CONCILIADO',
              porcentaje_comision = $2,
              orden_conciliada_id = $3::uuid,
              cliente_id = $4::uuid,
              cliente_asignado_nombre = $5,
              nota_auditoria = $6,
              conciliado_at = NOW()
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
          [
            alertId,
            effectiveFee,
            ordenPagoId,
            resolvedClientId,
            resolvedClientName,
            auditNote,
          ]
        );

        // Auto-aprendizaje: si la contraparte bancaria es un nombre válido, añadirlo a los remitentes autorizados del cliente
        if (
          resolvedClientId &&
          currentTx.remitente_o_contraparte &&
          currentTx.remitente_o_contraparte.trim().length >= 3 &&
          !/^(?:desconocido|unknown|sin remitente|compra tarjeta|tarjeta debito)/i.test(currentTx.remitente_o_contraparte)
        ) {
          const senderLearned = currentTx.remitente_o_contraparte.trim();
          await client.query(
            `
            UPDATE clientes_titulares
            SET remitentes_autorizados = ARRAY_APPEND(
              COALESCE(remitentes_autorizados, ARRAY[]::text[]),
              $1
            )
            WHERE id = $2::uuid
              AND NOT ($1 = ANY(COALESCE(remitentes_autorizados, ARRAY[]::text[])));
            `,
            [senderLearned, resolvedClientId]
          ).catch((e) => console.error('[ManualMatch] Error guardando remitente autorizado:', e));
        }

        const row = txRes.rows[0];
        if (!row) {
          throw new Error('No se pudo actualizar la transacción.');
        }

        return row;
      }
    );

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
