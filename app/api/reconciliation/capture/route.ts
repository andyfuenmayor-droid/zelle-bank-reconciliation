import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import { getDemoStore } from '@/lib/mock-seed-data';
import {
  getAdminSession,
  getClientSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminSession = getAdminSession(request);
  const clientSession = getClientSession(request);

  if (!adminSession && !clientSession) {
    return NextResponse.json(
      { ok: false, error: 'Debes iniciar sesión para visualizar comprobantes.' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get('orderId')?.trim();
  const txId = searchParams.get('txId')?.trim();

  if (!orderId && !txId) {
    return NextResponse.json(
      { ok: false, error: 'Parámetro orderId o txId es requerido.' },
      { status: 400 }
    );
  }

  const authorizedNegocioId = adminSession
    ? resolveAuthorizedNegocioId(adminSession, request)
    : null;

  const dbConnected = await isDatabaseAvailable();

  if (!dbConnected) {
    const store = getDemoStore();
    let order = orderId ? store.orders.find((o) => o.id === orderId) : null;
    if (!order && txId) {
      const tx = store.transactions.find((t) => t.id === txId);
      if (tx?.orden_conciliada_id) {
        order = store.orders.find((o) => o.id === tx.orden_conciliada_id);
      }
    }

    if (!order || !order.comprobante_base64) {
      return NextResponse.json(
        { ok: false, error: 'Comprobante no disponible en modo Demo.' },
        { status: 404 }
      );
    }

    if (!adminSession && clientSession && order.cliente_id !== clientSession.clienteId) {
      return NextResponse.json(
        { ok: false, error: 'No autorizado para visualizar este comprobante.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      codigo_orden: order.codigo_orden,
      comprobante_base64: order.comprobante_base64,
      comprobante_mime: order.comprobante_mime ?? 'image/jpeg',
    });
  }

  try {
    let orderRow: {
      id: string;
      codigo_orden: string;
      comprobante_base64: string;
      comprobante_mime: string | null;
    } | undefined;

    if (orderId) {
      const res = adminSession
        ? await dbQuery<{
            id: string;
            codigo_orden: string;
            comprobante_base64: string;
            comprobante_mime: string | null;
          }>(
            `
            SELECT id, codigo_orden, comprobante_base64, comprobante_mime
            FROM ordenes_pago_pendientes
            WHERE id = $1::uuid
              AND (negocio_id = $2::uuid OR negocio_id IS NULL)
            LIMIT 1;
            `,
            [orderId, authorizedNegocioId]
          )
        : await dbQuery<{
            id: string;
            codigo_orden: string;
            comprobante_base64: string;
            comprobante_mime: string | null;
          }>(
            `
            SELECT id, codigo_orden, comprobante_base64, comprobante_mime
            FROM ordenes_pago_pendientes
            WHERE id = $1::uuid
              AND cliente_id = $2::uuid
            LIMIT 1;
            `,
            [orderId, clientSession!.clienteId]
          );
      orderRow = res.rows[0];
    } else if (txId) {
      const res = adminSession
        ? await dbQuery<{
            id: string;
            codigo_orden: string;
            comprobante_base64: string;
            comprobante_mime: string | null;
          }>(
            `
            SELECT o.id, o.codigo_orden, o.comprobante_base64, o.comprobante_mime
            FROM financial_transactions_reconciliation t
            JOIN ordenes_pago_pendientes o ON o.id = t.orden_conciliada_id
            WHERE t.id = $1::uuid
              AND (t.negocio_id = $2::uuid OR t.negocio_id IS NULL)
            LIMIT 1;
            `,
            [txId, authorizedNegocioId]
          )
        : await dbQuery<{
            id: string;
            codigo_orden: string;
            comprobante_base64: string;
            comprobante_mime: string | null;
          }>(
            `
            SELECT o.id, o.codigo_orden, o.comprobante_base64, o.comprobante_mime
            FROM financial_transactions_reconciliation t
            JOIN ordenes_pago_pendientes o ON o.id = t.orden_conciliada_id
            WHERE t.id = $1::uuid
              AND o.cliente_id = $2::uuid
            LIMIT 1;
            `,
            [txId, clientSession!.clienteId]
          );
      orderRow = res.rows[0];
    }

    if (!orderRow || !orderRow.comprobante_base64) {
      return NextResponse.json(
        { ok: false, error: 'Comprobante no encontrado para esta operación.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      orderId: orderRow.id,
      codigo_orden: orderRow.codigo_orden,
      comprobante_base64: orderRow.comprobante_base64,
      comprobante_mime: orderRow.comprobante_mime ?? 'image/jpeg',
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al obtener comprobante.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
