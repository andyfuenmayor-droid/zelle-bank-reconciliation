import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestNegocioScope } from '@/lib/business-scope';
import { dbQuery, isDatabaseAvailable, withTransaction } from '@/lib/db';
import {
  ClientLiquidationRecord,
  CurrencyType,
  LiquidationPaymentMethod,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateLiquidationBody {
  cliente_id?: string;
  monto_liquidado?: number;
  moneda?: string;
  destinatario_beneficiario?: string;
  motivo_concepto?: string;
  metodo_pago_salida?: string;
  referencia_salida?: string;
  comprobante_salida_base64?: string;
  liquidado_por?: string;
  notas_operador?: string;
  archivar_comprobantes?: boolean;
}

const VALID_CURRENCIES: ReadonlyArray<CurrencyType> = ['USD', 'USDT', 'VES'];
const VALID_PAYMENT_METHODS: ReadonlyArray<LiquidationPaymentMethod> = [
  'ZELLE',
  'BINANCE_USDT',
  'PAGO_MOVIL',
  'TRANSFERENCIA_BANCARIA',
  'EFECTIVO',
  'OTRO',
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      liquidaciones: [],
    });
  }

  try {
    const scope = await resolveRequestNegocioScope(request);
    const { searchParams } = new URL(request.url);
    const clienteId = searchParams.get('clienteId')?.trim() || null;

    const conditions: string[] = [];
    const params: (string | null)[] = [];
    let pIdx = 1;

    if (scope.negocioId) {
      conditions.push(`l.negocio_id = $${pIdx++}::uuid`);
      params.push(scope.negocioId);
    }
    if (clienteId) {
      conditions.push(`l.cliente_id = $${pIdx++}::uuid`);
      params.push(clienteId);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        l.id,
        l.codigo_liquidacion,
        l.negocio_id,
        l.cliente_id,
        l.cliente_nombre,
        l.monto_liquidado,
        l.moneda,
        l.destinatario_beneficiario,
        l.motivo_concepto,
        l.metodo_pago_salida,
        l.referencia_salida,
        l.comprobante_salida_base64,
        l.saldo_anterior,
        l.saldo_restante,
        l.liquidado_por,
        l.notas_operador,
        l.created_at
      FROM liquidaciones_clientes l
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT 100;
    `;

    const res = await dbQuery<ClientLiquidationRecord>(sql, params);
    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      liquidaciones: res.rows,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al obtener liquidaciones';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    return NextResponse.json(
      { ok: false, error: 'Base de datos no disponible.' },
      { status: 503 }
    );
  }

  try {
    const scope = await resolveRequestNegocioScope(request);
    const body = (await request.json()) as CreateLiquidationBody;

    const clienteId = (body.cliente_id ?? '').trim();
    const montoLiquidado = Number(body.monto_liquidado ?? 0);
    const rawCurrency = (body.moneda ?? 'USD').trim().toUpperCase() as CurrencyType;
    const moneda = VALID_CURRENCIES.includes(rawCurrency) ? rawCurrency : 'USD';
    const destinatario = (body.destinatario_beneficiario ?? '').trim();
    const motivo = (body.motivo_concepto ?? '').trim();
    const rawMethod = (body.metodo_pago_salida ?? 'ZELLE').trim().toUpperCase() as LiquidationPaymentMethod;
    const metodoPago = VALID_PAYMENT_METHODS.includes(rawMethod) ? rawMethod : 'ZELLE';
    const referenciaSalida = (body.referencia_salida ?? '').trim() || null;
    const comprobanteBase64 = (body.comprobante_salida_base64 ?? '').trim() || null;
    const liquidadoPor = (body.liquidado_por ?? 'ADMINISTRADOR').trim() || 'ADMINISTRADOR';
    const notasOperador = (body.notas_operador ?? '').trim() || null;
    const archivarComprobantes = body.archivar_comprobantes ?? true;

    if (!clienteId) {
      return NextResponse.json(
        { ok: false, error: 'Debe especificar el cliente a liquidar.' },
        { status: 400 }
      );
    }
    if (!Number.isFinite(montoLiquidado) || montoLiquidado <= 0) {
      return NextResponse.json(
        { ok: false, error: 'El monto a liquidar debe ser un valor positivo mayor a 0.' },
        { status: 400 }
      );
    }
    if (!destinatario) {
      return NextResponse.json(
        { ok: false, error: 'Debe indicar a quién se liquida o el destinatario del pago.' },
        { status: 400 }
      );
    }
    if (!motivo) {
      return NextResponse.json(
        { ok: false, error: 'Debe ingresar el motivo o concepto de la liquidación.' },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      // 1. Bloquear cliente para cálculo ACID
      const clientRes = await client.query<{ id: string; nombre_titular: string; negocio_id: string | null }>(
        `SELECT id, nombre_titular, negocio_id FROM clientes_titulares WHERE id = $1::uuid FOR UPDATE`,
        [clienteId]
      );
      if (clientRes.rows.length === 0) {
        throw new Error('El cliente titular especificado no existe.');
      }
      const clientRow = clientRes.rows[0];

      // 2. Calcular total neto acumulado de depósitos conciliados
      const depositsRes = await client.query<{ total_acreditado: number }>(
        `
        SELECT COALESCE(SUM(monto_neto), 0)::numeric(12,2) AS total_acreditado
        FROM financial_transactions_reconciliation
        WHERE estado = 'CONCILIADO'
          AND tipo_movimiento = 'RECIBIDO'
          AND moneda = $1
          AND (
            cliente_id = $2::uuid
            OR UPPER(TRIM(COALESCE(cliente_asignado_nombre, ''))) = UPPER(TRIM($3))
          )
        `,
        [moneda, clientRow.id, clientRow.nombre_titular]
      );
      const totalAcreditado = Number(depositsRes.rows[0]?.total_acreditado ?? 0);

      // 3. Calcular total ya liquidado previamente
      const liqRes = await client.query<{ total_liquidado: number }>(
        `
        SELECT COALESCE(SUM(monto_liquidado), 0)::numeric(12,2) AS total_liquidado
        FROM liquidaciones_clientes
        WHERE cliente_id = $1::uuid AND moneda = $2
        `,
        [clientRow.id, moneda]
      );
      const totalPrevioLiquidado = Number(liqRes.rows[0]?.total_liquidado ?? 0);

      const saldoAnterior = Math.round((totalAcreditado - totalPrevioLiquidado) * 100) / 100;

      if (montoLiquidado > saldoAnterior + 0.009) {
        throw new Error(
          `Fondos insuficientes: El monto a liquidar ($${montoLiquidado.toFixed(2)}) supera el saldo disponible actual ($${saldoAnterior.toFixed(2)} ${moneda}).`
        );
      }

      const saldoRestante = Math.round((saldoAnterior - montoLiquidado) * 100) / 100;

      // 4. Generar código único de liquidación
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const codigoLiquidacion = `LIQ-${new Date().getFullYear()}-${randomSuffix}`;
      const negocioId = clientRow.negocio_id ?? scope.negocioId;

      // 5. Insertar registro de liquidación
      const insertRes = await client.query<ClientLiquidationRecord>(
        `
        INSERT INTO liquidaciones_clientes (
          codigo_liquidacion,
          negocio_id,
          cliente_id,
          cliente_nombre,
          monto_liquidado,
          moneda,
          destinatario_beneficiario,
          motivo_concepto,
          metodo_pago_salida,
          referencia_salida,
          comprobante_salida_base64,
          saldo_anterior,
          saldo_restante,
          liquidado_por,
          notas_operador
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        ) RETURNING *;
        `,
        [
          codigoLiquidacion,
          negocioId,
          clientRow.id,
          clientRow.nombre_titular,
          montoLiquidado,
          moneda,
          destinatario,
          motivo,
          metodoPago,
          referenciaSalida,
          comprobanteBase64,
          saldoAnterior,
          saldoRestante,
          liquidadoPor,
          notasOperador,
        ]
      );

      const createdLiq = insertRes.rows[0];

      // 6. Si se solicita archivar comprobantes del ciclo actual
      if (archivarComprobantes && createdLiq) {
        // Actualizar órdenes de pago conciliadas no liquidadas
        await client.query(
          `
          UPDATE ordenes_pago_pendientes
          SET liquidacion_id = $1::uuid,
              liquidado_at = NOW(),
              estado = 'LIQUIDADO'
          WHERE cliente_id = $2::uuid
            AND estado = 'CONCILIADO'
            AND liquidado_at IS NULL;
          `,
          [createdLiq.id, clientRow.id]
        );

        // Actualizar transacciones financieras bancarias
        await client.query(
          `
          UPDATE financial_transactions_reconciliation
          SET liquidacion_id = $1::uuid,
              liquidado_at = NOW()
          WHERE (
            cliente_id = $2::uuid
            OR UPPER(TRIM(COALESCE(cliente_asignado_nombre, ''))) = UPPER(TRIM($3))
          )
          AND estado = 'CONCILIADO'
          AND liquidado_at IS NULL;
          `,
          [createdLiq.id, clientRow.id, clientRow.nombre_titular]
        );
      }

      return {
        createdLiq,
        saldoAnterior,
        saldoRestante,
      };
    });

    return NextResponse.json({
      ok: true,
      liquidacion: result.createdLiq,
      saldo_anterior: result.saldoAnterior,
      saldo_restante: result.saldoRestante,
      mensaje: `Liquidación ${result.createdLiq.codigo_liquidacion} procesada con éxito. Saldo restante: $${result.saldoRestante.toFixed(2)} ${moneda}.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al procesar la liquidación';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
