import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { getDemoStore } from '@/lib/mock-seed-data';
import {
  requireAdminSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';
import {
  FinancialTransactionRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ManualMatchPayload {
  action?: 'MATCH_TX' | 'APPROVE_ORDER_WITHOUT_EMAIL' | 'REJECT_PENDING_ORDER';
  alertId?: string;
  ordenPagoId?: string | null;
  clienteNombreManual?: string;
  notasConciliacion?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  try {
    const body = (await request.json()) as ManualMatchPayload;
    const action = body.action ?? 'MATCH_TX';
    const alertId = body.alertId?.trim() ?? '';
    const ordenPagoId = body.ordenPagoId?.trim() || null;
    const clienteNombreManual = body.clienteNombreManual?.trim() ?? '';
    const notasConciliacion = body.notasConciliacion?.trim() ?? '';

    const dbConnected = await isDatabaseAvailable();

    // =========================================================================
    // ACCIÓN 1: DESCARTAR / ELIMINAR ORDEN PENDIENTE (DUPLICADA O INVÁLIDA)
    // =========================================================================
    if (action === 'REJECT_PENDING_ORDER') {
      if (!ordenPagoId) {
        return NextResponse.json(
          { ok: false, error: 'El identificador de la orden pendiente (ordenPagoId) es requerido.' },
          { status: 400 }
        );
      }

      if (!dbConnected) {
        const store = getDemoStore();
        const idx = store.orders.findIndex((o) => o.id === ordenPagoId && o.estado === 'PENDIENTE');
        if (idx === -1) {
          return NextResponse.json(
            { ok: false, error: 'Orden pendiente no encontrada.' },
            { status: 404 }
          );
        }
        const [removed] = store.orders.splice(idx, 1);
        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          deletedOrderId: ordenPagoId,
          codigoOrden: removed?.codigo_orden,
        });
      }

      const deletedOrder = await withTransaction(async (client) => {
        const res = await client.query<{ id: string; codigo_orden: string; cliente_nombre: string }>(
          `
          DELETE FROM ordenes_pago_pendientes
          WHERE id = $1::uuid
            AND estado = 'PENDIENTE'
            AND (negocio_id = $2::uuid OR negocio_id IS NULL)
          RETURNING id, codigo_orden, cliente_nombre;
          `,
          [ordenPagoId, authorizedNegocioId]
        );
        if (!res.rows[0]) {
          throw new Error('La orden especificada no existe o ya fue conciliada.');
        }
        return res.rows[0];
      });

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        deletedOrderId: deletedOrder.id,
        codigoOrden: deletedOrder.codigo_orden,
        clienteNombre: deletedOrder.cliente_nombre,
      });
    }

    // =========================================================================
    // ACCIÓN 2: CONFIRMAR Y ACREDITAR ORDEN MANUALMENTE SIN CORREO DEL BANCO
    // =========================================================================
    if (action === 'APPROVE_ORDER_WITHOUT_EMAIL' || (!alertId && ordenPagoId)) {
      if (!ordenPagoId) {
        return NextResponse.json(
          { ok: false, error: 'El identificador de la orden pendiente (ordenPagoId) es requerido.' },
          { status: 400 }
        );
      }

      if (!dbConnected) {
        const store = getDemoStore();
        const order = store.orders.find((o) => o.id === ordenPagoId);
        if (!order) {
          return NextResponse.json(
            { ok: false, error: 'La orden seleccionada no existe.' },
            { status: 404 }
          );
        }
        if (order.estado === 'CONCILIADO') {
          return NextResponse.json(
            { ok: false, error: 'Esta orden ya se encuentra conciliada.' },
            { status: 400 }
          );
        }

        const clientRecord = store.clients.find((c) => c.id === order.cliente_id);
        const feePct = (order.plataforma_esperada || 'CITIBANK').startsWith('BINANCE')
          ? (clientRecord?.porcentaje_comision_binance ?? 1.5)
          : (clientRecord?.porcentaje_comision_zelle ?? 4.0);
        const comision = Math.round(order.monto_esperado * (feePct / 100) * 100) / 100;
        const neto = Math.round((order.monto_esperado - comision) * 100) / 100;
        const nowIso = new Date().toISOString();
        const newTxId = `manual-tx-${Date.now()}`;
        const auditNote =
          notasConciliacion.length > 0
            ? notasConciliacion
            : `Confirmado manualmente desde captura del portal (${order.codigo_orden}) sin correo bancario. Titular: ${order.cliente_nombre}.`;

        const extIdDemo = `MANUAL-ORD-${order.codigo_orden}-${Date.now()}`;
        const newTx: FinancialTransactionRecord = {
          id: newTxId,
          negocio_id: order.negocio_id,
          external_unique_id: extIdDemo,
          message_id: extIdDemo,
          dedup_key: `${order.plataforma_esperada || 'CITIBANK'}:MANUAL:${order.codigo_orden}:${order.monto_esperado.toFixed(2)}`,
          plataforma: order.plataforma_esperada || 'CITIBANK',
          banco: order.plataforma_esperada || 'CITIBANK',
          moneda: order.moneda || 'USD',
          tipo_movimiento: 'RECIBIDO',
          monto_bruto: order.monto_esperado,
          porcentaje_comision: feePct,
          monto_comision: comision,
          monto_neto: neto,
          remitente_o_contraparte:
            order.remitente_reportado || order.nombre_remitente_reportado || order.cliente_nombre,
          remitente_o_destinatario:
            order.remitente_reportado || order.nombre_remitente_reportado || order.cliente_nombre,
          referencia: order.referencia_reportada || 'SIN-REF',
          fecha_transaccion: order.created_at,
          origen_deteccion: 'EMAIL_AI',
          metodo_extraccion: 'AI_FALLBACK',
          raw_payload: {
            source: 'MANUAL_PORTAL_APPROVAL',
            codigo_orden: order.codigo_orden,
          },
          raw_body: auditNote,
          estado: 'CONCILIADO',
          cliente_id: order.cliente_id,
          cliente_asignado_nombre: order.cliente_nombre,
          orden_conciliada_id: order.id,
          orden_pago_id: order.id,
          codigo_orden: order.codigo_orden,
          nota_auditoria: auditNote,
          notas_conciliacion: auditNote,
          conciliado_at: nowIso,
          created_at: nowIso,
          has_capture: Boolean(order.comprobante_base64),
          comprobante_base64: order.comprobante_base64,
          comprobante_mime: order.comprobante_mime,
          datos_ocr_extraidos: order.datos_ocr_extraidos,
        };

        store.transactions.unshift(newTx);
        order.estado = 'CONCILIADO';
        order.transaccion_conciliada_id = newTxId;
        order.updated_at = nowIso;

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          reconciledAt: nowIso,
          alert: newTx,
        });
      }

      const createdAlert = await withTransaction<FinancialTransactionRecord>(
        async (client) => {
          const orderLookup = await client.query<PendingPaymentOrder & { negocio_id?: string | null }>(
            `
            SELECT *
            FROM ordenes_pago_pendientes
            WHERE id = $1::uuid
              AND (negocio_id = $2::uuid OR negocio_id IS NULL)
            FOR UPDATE;
            `,
            [ordenPagoId, authorizedNegocioId]
          );

          const targetOrder = orderLookup.rows[0];
          if (!targetOrder) {
            throw new Error('La orden de pago seleccionada no existe.');
          }
          if (targetOrder.estado === 'CONCILIADO') {
            throw new Error(`La orden ${targetOrder.codigo_orden} ya se encuentra conciliada.`);
          }

          let effectiveFee = 4.0;
          if (targetOrder.cliente_id) {
            const feeRes = await client.query<{
              porcentaje_comision_zelle: number;
              porcentaje_comision_binance: number;
            }>(
              `
              SELECT porcentaje_comision_zelle, porcentaje_comision_binance
              FROM clientes_titulares
              WHERE id = $1::uuid
              LIMIT 1;
              `,
              [targetOrder.cliente_id]
            );
            const feeRow = feeRes.rows[0];
            if (feeRow) {
              effectiveFee = (targetOrder.plataforma_esperada || 'CITIBANK').startsWith('BINANCE')
                ? Number(feeRow.porcentaje_comision_binance ?? 1.5)
                : Number(feeRow.porcentaje_comision_zelle ?? 4.0);
            }
          }

          const platform = targetOrder.plataforma_esperada || targetOrder.banco_destino || 'CITIBANK';
          const currency = targetOrder.moneda || 'USD';
          const senderName =
            targetOrder.remitente_reportado ||
            targetOrder.nombre_remitente_reportado ||
            targetOrder.cliente_nombre ||
            'Remitente Portal';
          const refReported = targetOrder.referencia_reportada?.trim() || 'SIN-REF';
          const extId = `MANUAL-ORD-${targetOrder.codigo_orden}-${Date.now()}`;
          const dedupKey = `${platform}:MANUAL:${targetOrder.codigo_orden}:${Number(
            targetOrder.monto_esperado
          ).toFixed(2)}`;

          const auditNote =
            notasConciliacion.length > 0
              ? notasConciliacion
              : `Confirmado y acreditado manualmente por el administrador desde comprobante del portal (${targetOrder.codigo_orden}) sin correo bancario recibido. Comisión: ${effectiveFee.toFixed(2)}%.`;

          const rawPayload = {
            source: 'MANUAL_PORTAL_APPROVAL',
            codigo_orden: targetOrder.codigo_orden,
            remitente_reportado: senderName,
            referencia_reportada: refReported,
            raw_body: `Confirmación manual de captura subida en /portal (${targetOrder.codigo_orden}) por ${targetOrder.cliente_nombre}. Remitente: ${senderName} · Ref: ${refReported} · Monto: $${Number(targetOrder.monto_esperado).toFixed(2)} ${currency}.`,
          };

          const insertTxRes = await client.query<FinancialTransactionRecord>(
            `
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
              estado,
              cliente_id,
              cliente_asignado_nombre,
              orden_conciliada_id,
              nota_auditoria,
              conciliado_at
            )
            VALUES (
              $1::uuid,
              $2,
              $3,
              $4,
              $5,
              'RECIBIDO',
              $6,
              $7,
              $8,
              $9,
              COALESCE($10::timestamptz, NOW()),
              'EMAIL_AI',
              $11::jsonb,
              'CONCILIADO',
              $12::uuid,
              $13,
              $14::uuid,
              $15,
              NOW()
            )
            RETURNING
              *,
              external_unique_id AS message_id,
              plataforma AS banco,
              remitente_o_contraparte AS remitente_o_destinatario,
              COALESCE(raw_payload->>'raw_body', raw_payload::text) AS raw_body,
              'AI_FALLBACK' AS metodo_extraccion,
              orden_conciliada_id AS orden_pago_id,
              nota_auditoria AS notas_conciliacion;
            `,
            [
              targetOrder.negocio_id ?? null,
              extId,
              dedupKey,
              platform,
              currency,
              targetOrder.monto_esperado,
              effectiveFee,
              senderName,
              refReported,
              targetOrder.created_at,
              JSON.stringify(rawPayload),
              targetOrder.cliente_id,
              targetOrder.cliente_nombre,
              targetOrder.id,
              auditNote,
            ]
          );

          const newTx = insertTxRes.rows[0];
          if (!newTx) {
            throw new Error('No se pudo crear la transacción conciliada.');
          }

          await client.query(
            `
            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = $1::uuid,
                alerta_conciliada_id = $1::uuid,
                conciliado_por = 'MANUAL_ADMIN_NO_EMAIL',
                score_similitud = 1.0000,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = $2::uuid;
            `,
            [newTx.id, targetOrder.id]
          );

          return newTx;
        }
      );

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        alert: createdAlert,
      });
    }

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
            AND (negocio_id = $2::uuid OR negocio_id IS NULL)
          FOR UPDATE;
          `,
          [alertId, authorizedNegocioId]
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
              AND (negocio_id = $3::uuid OR negocio_id IS NULL)
            RETURNING *;
            `,
            [alertId, ordenPagoId, authorizedNegocioId]
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
            remitentes_autorizados: string[] | null;
          }>(
            `
            SELECT id, nombre_titular, remitentes_autorizados
            FROM clientes_titulares
            WHERE UPPER(TRIM(nombre_titular)) = UPPER(TRIM($1))
            LIMIT 1;
            `,
            [clienteNombreManual]
          );
          const foundClient = clientLookup.rows[0];
          if (!foundClient) {
            throw new Error(`El cliente titular "${clienteNombreManual}" no existe en el sistema.`);
          }

          // Validación estricta de seguridad:
          // Un pago no se puede conciliar a quien no lo haya enviado.
          // Si no hay orden de pago vinculada, el remitente bancario debe coincidir con el cliente o estar autorizado.
          const bankSender = (currentTx.remitente_o_contraparte || '').trim().toLowerCase();
          const targetName = foundClient.nombre_titular.trim().toLowerCase();
          const authList = (foundClient.remitentes_autorizados || []).map((s) => s.trim().toLowerCase());

          const isAuthorized =
            bankSender === targetName ||
            bankSender.includes(targetName) ||
            targetName.includes(bankSender) ||
            authList.some((a) => a === bankSender || bankSender.includes(a) || a.includes(bankSender));

          if (!isAuthorized) {
            throw new Error(
              `Bloqueo de seguridad: No se puede conciliar este pago a "${foundClient.nombre_titular}". El dinero fue enviado por "${currentTx.remitente_o_contraparte}" y no coincide con el cliente ni con sus remitentes autorizados. Para acreditarlo, el cliente debe primero reportar el pago con su comprobante en el portal.`
            );
          }

          resolvedClientId = foundClient.id;
          resolvedClientName = foundClient.nombre_titular;
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
