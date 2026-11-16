import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable, SqlPrimitive } from '@/lib/db';
import { parseBankAlertEmail, sanitizeEmailContent } from '@/lib/bank-parser';
import {
  INITIAL_DEMO_ALERTS,
  INITIAL_DEMO_PENDING_ORDERS,
} from '@/lib/mock-seed-data';
import {
  AutoReconciliationResult,
  BankEmailAlertRecord,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const banco = searchParams.get('banco');
  const tipoMovimiento = searchParams.get('tipo_movimiento');
  const estado = searchParams.get('estado');
  const search = searchParams.get('search')?.trim() ?? '';

  const dbConnected = await isDatabaseAvailable();

  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      alerts: INITIAL_DEMO_ALERTS,
      pendingOrders: INITIAL_DEMO_PENDING_ORDERS,
    });
  }

  try {
    const conditions: string[] = [];
    const params: SqlPrimitive[] = [];

    if (banco && banco !== 'TODOS') {
      params.push(banco);
      conditions.push(`banco = $${params.length}`);
    }

    if (tipoMovimiento && tipoMovimiento !== 'TODOS') {
      params.push(tipoMovimiento);
      conditions.push(`tipo_movimiento = $${params.length}`);
    }

    if (estado && estado !== 'TODOS') {
      params.push(estado);
      conditions.push(`estado = $${params.length}`);
    }

    if (search.length > 0) {
      params.push(`%${search}%`);
      conditions.push(
        `(COALESCE(remitente_o_destinatario, '') ILIKE $${params.length} OR COALESCE(referencia, '') ILIKE $${params.length} OR COALESCE(cliente_asignado_nombre, '') ILIKE $${params.length})`
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const alertsSql = `
      SELECT
        id,
        message_id,
        banco,
        tipo_movimiento,
        monto_bruto,
        porcentaje_comision,
        monto_comision,
        monto_neto,
        remitente_o_destinatario,
        referencia,
        fecha_transaccion,
        raw_body,
        metodo_extraccion,
        estado,
        orden_pago_id,
        cliente_asignado_nombre,
        notas_conciliacion,
        conciliado_at,
        created_at
      FROM bank_email_alerts
      ${whereClause}
      ORDER BY fecha_transaccion DESC, created_at DESC
      LIMIT 250;
    `;

    const pendingOrdersSql = `
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
      ORDER BY created_at DESC
      LIMIT 100;
    `;

    const [alertsRes, ordersRes] = await Promise.all([
      dbQuery<BankEmailAlertRecord>(alertsSql, params),
      dbQuery<PendingPaymentOrder>(pendingOrdersSql),
    ]);

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      alerts: alertsRes.rows,
      pendingOrders: ordersRes.rows,
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
  fromAddress?: string;
  subject?: string;
  rawEmailBody?: string;
  messageId?: string;
}

/**
 * Permite probar en vivo el motor híbrido `parseBankAlertEmail` con una alerta cruda de Citibank/TD Bank
 * e insertarla + conciliarla en PostgreSQL (o devolver el resultado parseado si está en modo Demo).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as SimulateEmailRequestBody;
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

    const feePercentage = parsed.tipo_movimiento === 'RECIBIDO' ? 4.0 : 0.0;
    const feeAmount = Math.round(parsed.monto_bruto * (feePercentage / 100) * 100) / 100;
    const netAmount = Math.round((parsed.monto_bruto - feeAmount) * 100) / 100;
    const messageId =
      body.messageId?.trim() ||
      `<sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${
        parsed.banco === 'TD_BANK' ? 'tdbank.com' : 'alerts.citibank.com'
      }>`;

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const simulatedRecord: BankEmailAlertRecord = {
        id: crypto.randomUUID(),
        message_id: messageId,
        banco: parsed.banco,
        tipo_movimiento: parsed.tipo_movimiento,
        monto_bruto: parsed.monto_bruto,
        porcentaje_comision: feePercentage,
        monto_comision: feeAmount,
        monto_neto: netAmount,
        remitente_o_destinatario: parsed.remitente_o_destinatario,
        referencia: parsed.referencia,
        fecha_transaccion: parsed.fecha_transaccion,
        raw_body: sanitizeEmailContent(rawEmailBody),
        metodo_extraccion: parsed.metodo_extraccion,
        estado:
          parsed.metodo_extraccion === 'AI_FALLBACK' || !parsed.remitente_o_destinatario
            ? 'REVISION_MANUAL'
            : 'DETECTADO',
        orden_pago_id: null,
        cliente_asignado_nombre: null,
        notas_conciliacion: `Extraído vía ${parsed.metodo_extraccion} (confianza ${Math.round(parsed.confianza * 100)}%).`,
        conciliado_at: null,
        created_at: new Date().toISOString(),
      };

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        alert: simulatedRecord,
      });
    }

    const insertSql = `
      INSERT INTO bank_email_alerts (
        message_id,
        banco,
        tipo_movimiento,
        monto_bruto,
        porcentaje_comision,
        remitente_o_destinatario,
        referencia,
        fecha_transaccion,
        raw_body,
        metodo_extraccion,
        estado
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (message_id) DO NOTHING
      RETURNING *;
    `;

    const initialStatus =
      parsed.metodo_extraccion === 'AI_FALLBACK' || !parsed.remitente_o_destinatario
        ? 'REVISION_MANUAL'
        : 'DETECTADO';

    const insertRes = await dbQuery<BankEmailAlertRecord>(insertSql, [
      messageId,
      parsed.banco,
      parsed.tipo_movimiento,
      parsed.monto_bruto,
      feePercentage,
      parsed.remitente_o_destinatario,
      parsed.referencia,
      parsed.fecha_transaccion,
      sanitizeEmailContent(rawEmailBody),
      parsed.metodo_extraccion,
      initialStatus,
    ]);

    const inserted = insertRes.rows[0];
    if (!inserted) {
      return NextResponse.json(
        { ok: false, error: 'El message_id ya existe en bank_email_alerts (idempotencia).' },
        { status: 409 }
      );
    }

    if (inserted.tipo_movimiento === 'RECIBIDO') {
      await dbQuery<AutoReconciliationResult>(
        'SELECT * FROM fn_conciliar_pago_zelle($1::uuid);',
        [inserted.id]
      );
    }

    const refreshed = await dbQuery<BankEmailAlertRecord>(
      'SELECT * FROM bank_email_alerts WHERE id = $1::uuid;',
      [inserted.id]
    );

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      alert: refreshed.rows[0] ?? inserted,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error al procesar correo bancario.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
