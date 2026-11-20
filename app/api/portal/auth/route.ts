import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  getActiveMailboxAssignedAccounts,
  resolveClientAssignedAccounts,
} from '@/lib/assigned-accounts';
import {
  attachClientSessionCookie,
  checkRateLimit,
  clearClientSessionCookie,
  getClientIp,
  getClientSession,
  hashSecretScrypt,
  verifySecretHash,
} from '@/lib/security';
import {
  computeClientWalletSummary,
  DEMO_DEFAULT_ASSIGNED_ACCOUNTS,
  DemoClientInternal,
  getDemoStore,
} from '@/lib/mock-seed-data';
import {
  AssignedReceivingAccount,
  ClientAccountRecord,
  ClientLiquidationRecord,
  ClientPortalWalletSummary,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PortalClientRow {
  id: string;
  negocio_id: string | null;
  nombre_titular: string;
  email: string | null;
  email_contacto: string | null;
  telefono: string | null;
  pin_acceso_hash: string | null;
  porcentaje_comision_zelle: number;
  porcentaje_comision_binance: number;
  porcentaje_comision: number;
  remitentes_autorizados: string[] | null;
  remitentes_zelle_habituales: string | null;
  cuentas_asignadas: AssignedReceivingAccount[] | null;
  activo: boolean;
  created_at: string;
}

interface WalletAggRow {
  moneda: string;
  total_bruto: number;
  total_comision: number;
  total_neto: number;
  tx_count: number;
}

function mapPortalClientRow(
  row: PortalClientRow,
  wallet: ClientPortalWalletSummary,
  assignedAccounts: AssignedReceivingAccount[]
): ClientAccountRecord {
  const senders = Array.isArray(row.remitentes_autorizados)
    ? row.remitentes_autorizados
    : [];

  return {
    id: row.id,
    nombre_titular: row.nombre_titular,
    email: row.email ?? row.email_contacto,
    email_contacto: row.email_contacto ?? row.email,
    telefono: row.telefono,
    porcentaje_comision_zelle: row.porcentaje_comision_zelle,
    porcentaje_comision_binance: row.porcentaje_comision_binance,
    porcentaje_comision: row.porcentaje_comision,
    remitentes_autorizados: senders,
    remitentes_zelle_habituales:
      row.remitentes_zelle_habituales ?? senders.join(', '),
    cuentas_asignadas: assignedAccounts,
    activo: row.activo,
    total_bruto_usd: wallet.totalBrutoUsd,
    total_comision_usd: wallet.totalComisionUsd,
    total_neto_usd: wallet.saldoNetoUsd,
    total_bruto_usdt: wallet.totalBrutoUsdt,
    total_comision_usdt: wallet.totalComisionUsdt,
    total_neto_usdt: wallet.saldoNetoUsdt,
    total_bruto_conciliado:
      Math.round((wallet.totalBrutoUsd + wallet.totalBrutoUsdt) * 100) / 100,
    total_comision_retenida:
      Math.round((wallet.totalComisionUsd + wallet.totalComisionUsdt) * 100) / 100,
    total_neto_disponible:
      Math.round((wallet.saldoNetoUsd + wallet.saldoNetoUsdt) * 100) / 100,
    pagos_conciliados_count: wallet.pagosConciliadosCount,
    created_at: row.created_at,
  };
}

async function loadPostgresPortalSession(
  clientRow: PortalClientRow
): Promise<{
  client: ClientAccountRecord;
  wallet: ClientPortalWalletSummary;
  orders: PendingPaymentOrder[];
  liquidaciones: ClientLiquidationRecord[];
}> {
  const [aggRes, liqAggRes, ordersRes, liqListRes, activeMailboxAccounts] = await Promise.all([
    dbQuery<WalletAggRow>(
      `
      SELECT
        moneda,
        COALESCE(SUM(monto_bruto), 0)::numeric(12,2) AS total_bruto,
        COALESCE(SUM(monto_comision), 0)::numeric(12,2) AS total_comision,
        COALESCE(SUM(monto_neto), 0)::numeric(12,2) AS total_neto,
        COUNT(*)::int AS tx_count
      FROM financial_transactions_reconciliation
      WHERE estado = 'CONCILIADO'
        AND tipo_movimiento = 'RECIBIDO'
        AND (
          cliente_id = $1::uuid
          OR (
            cliente_id IS NULL
            AND UPPER(TRIM(COALESCE(cliente_asignado_nombre, ''))) = UPPER(TRIM($2))
          )
        )
      GROUP BY moneda;
      `,
      [clientRow.id, clientRow.nombre_titular]
    ),
    dbQuery<{ moneda: string; total_liquidado: number; liq_count: number }>(
      `
      SELECT
        moneda,
        COALESCE(SUM(monto_liquidado), 0)::numeric(12,2) AS total_liquidado,
        COUNT(*)::int AS liq_count
      FROM liquidaciones_clientes
      WHERE cliente_id = $1::uuid
      GROUP BY moneda;
      `,
      [clientRow.id]
    ),
    dbQuery<PendingPaymentOrder>(
      `
      SELECT
        o.id,
        o.codigo_orden,
        o.cliente_id,
        o.cliente_nombre,
        o.cliente_email,
        COALESCE(o.plataforma_esperada, o.banco_destino, 'CITIBANK') AS plataforma_esperada,
        COALESCE(o.banco_destino, o.plataforma_esperada, 'CITIBANK') AS banco_destino,
        COALESCE(o.moneda, 'USD') AS moneda,
        o.monto_esperado,
        COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, o.cliente_nombre) AS remitente_reportado,
        COALESCE(o.nombre_remitente_reportado, o.remitente_reportado, o.cliente_nombre) AS nombre_remitente_reportado,
        o.referencia_reportada,
        (CASE WHEN o.comprobante_base64 IS NOT NULL AND LENGTH(o.comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
        NULL::text AS comprobante_base64,
        o.comprobante_mime,
        o.datos_ocr_extraidos,
        o.estado,
        COALESCE(o.transaccion_conciliada_id, o.alerta_conciliada_id) AS transaccion_conciliada_id,
        o.liquidacion_id,
        o.liquidado_at,
        o.notas_cliente,
        o.created_at,
        o.updated_at,
        t.fecha_transaccion AS tx_fecha_correo,
        t.remitente_o_contraparte AS tx_remitente_correo,
        t.referencia AS tx_referencia_correo,
        t.monto_bruto AS tx_monto_bruto,
        t.porcentaje_comision AS tx_porcentaje_comision,
        t.monto_comision AS tx_monto_comision,
        t.monto_neto AS tx_monto_neto
      FROM ordenes_pago_pendientes o
      LEFT JOIN financial_transactions_reconciliation t
        ON t.id = COALESCE(o.transaccion_conciliada_id, o.alerta_conciliada_id)
      WHERE o.cliente_id = $1::uuid
        AND o.liquidado_at IS NULL
      ORDER BY COALESCE(t.fecha_transaccion, o.created_at) DESC, o.created_at DESC
      LIMIT 1000;
      `,
      [clientRow.id]
    ),
    dbQuery<ClientLiquidationRecord>(
      `
      SELECT
        id,
        codigo_liquidacion,
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
        created_at
      FROM liquidaciones_clientes
      WHERE cliente_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 50;
      `,
      [clientRow.id]
    ),
    getActiveMailboxAssignedAccounts(clientRow.negocio_id ?? null),
  ]);

  let totalBrutoUsd = 0;
  let totalComisionUsd = 0;
  let saldoNetoUsd = 0;
  let totalBrutoUsdt = 0;
  let totalComisionUsdt = 0;
  let saldoNetoUsdt = 0;
  let pagosConciliadosCount = 0;

  for (const row of aggRes.rows) {
    pagosConciliadosCount += row.tx_count;
    if (row.moneda === 'USDT') {
      totalBrutoUsdt += row.total_bruto;
      totalComisionUsdt += row.total_comision;
      saldoNetoUsdt += row.total_neto;
    } else {
      totalBrutoUsd += row.total_bruto;
      totalComisionUsd += row.total_comision;
      saldoNetoUsd += row.total_neto;
    }
  }

  let totalLiquidadoUsd = 0;
  let totalLiquidadoUsdt = 0;
  for (const liq of liqAggRes.rows) {
    if (liq.moneda === 'USDT') {
      totalLiquidadoUsdt += Number(liq.total_liquidado);
    } else {
      totalLiquidadoUsd += Number(liq.total_liquidado);
    }
  }

  const saldoNetoUsdDisponible = Math.max(
    0,
    Math.round((saldoNetoUsd - totalLiquidadoUsd) * 100) / 100
  );
  const saldoNetoUsdtDisponible = Math.max(
    0,
    Math.round((saldoNetoUsdt - totalLiquidadoUsdt) * 100) / 100
  );

  const pagosPendientesCount = ordersRes.rows.filter(
    (o) => o.estado === 'PENDIENTE'
  ).length;

  const wallet: ClientPortalWalletSummary = {
    saldoNetoUsd: saldoNetoUsdDisponible,
    totalBrutoUsd: Math.round(totalBrutoUsd * 100) / 100,
    totalComisionUsd: Math.round(totalComisionUsd * 100) / 100,
    saldoNetoUsdt: saldoNetoUsdtDisponible,
    totalBrutoUsdt: Math.round(totalBrutoUsdt * 100) / 100,
    totalComisionUsdt: Math.round(totalComisionUsdt * 100) / 100,
    totalLiquidadoUsd: Math.round(totalLiquidadoUsd * 100) / 100,
    totalLiquidadoUsdt: Math.round(totalLiquidadoUsdt * 100) / 100,
    totalAcreditadoUsd: Math.round(saldoNetoUsd * 100) / 100,
    totalAcreditadoUsdt: Math.round(saldoNetoUsdt * 100) / 100,
    pagosConciliadosCount,
    pagosPendientesCount,
  };

  const assignedAccounts = resolveClientAssignedAccounts(
    clientRow.cuentas_asignadas,
    activeMailboxAccounts
  );

  return {
    client: mapPortalClientRow(clientRow, wallet, assignedAccounts),
    wallet,
    orders: ordersRes.rows,
    liquidaciones: liqListRes.rows,
  };
}

function buildDemoSessionResponse(demoClient: DemoClientInternal): {
  client: ClientAccountRecord;
  wallet: ClientPortalWalletSummary;
  orders: PendingPaymentOrder[];
  liquidaciones: ClientLiquidationRecord[];
} {
  const store = getDemoStore();
  const wallet = computeClientWalletSummary(
    demoClient.id,
    store.transactions,
    store.orders
  );
  const orders = store.orders
    .filter((o) => o.cliente_id === demoClient.id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  const publicClient: ClientAccountRecord = {
    id: demoClient.id,
    nombre_titular: demoClient.nombre_titular,
    email: demoClient.email,
    email_contacto: demoClient.email_contacto,
    telefono: demoClient.telefono,
    porcentaje_comision_zelle: demoClient.porcentaje_comision_zelle,
    porcentaje_comision_binance: demoClient.porcentaje_comision_binance,
    porcentaje_comision: demoClient.porcentaje_comision,
    remitentes_autorizados: demoClient.remitentes_autorizados,
    remitentes_zelle_habituales: demoClient.remitentes_zelle_habituales,
    cuentas_asignadas:
      demoClient.cuentas_asignadas && demoClient.cuentas_asignadas.length > 0
        ? demoClient.cuentas_asignadas
        : [...DEMO_DEFAULT_ASSIGNED_ACCOUNTS],
    activo: demoClient.activo,
    total_bruto_usd: wallet.totalBrutoUsd,
    total_comision_usd: wallet.totalComisionUsd,
    total_neto_usd: wallet.saldoNetoUsd,
    total_bruto_usdt: wallet.totalBrutoUsdt,
    total_comision_usdt: wallet.totalComisionUsdt,
    total_neto_usdt: wallet.saldoNetoUsdt,
    total_bruto_conciliado:
      Math.round((wallet.totalBrutoUsd + wallet.totalBrutoUsdt) * 100) / 100,
    total_comision_retenida:
      Math.round((wallet.totalComisionUsd + wallet.totalComisionUsdt) * 100) / 100,
    total_neto_disponible:
      Math.round((wallet.saldoNetoUsd + wallet.saldoNetoUsdt) * 100) / 100,
    pagos_conciliados_count: wallet.pagosConciliadosCount,
    created_at: demoClient.created_at,
  };

  return { client: publicClient, wallet, orders, liquidaciones: [] };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const clientSession = getClientSession(request);
  if (!clientSession) {
    return NextResponse.json(
      { ok: false, error: 'No existe una sesión activa en el portal.' },
      { status: 401 }
    );
  }

  const clienteId = clientSession.clienteId;

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    const demoClient = store.clients.find((c) => c.id === clienteId);
    if (!demoClient) {
      const res = NextResponse.json(
        { ok: false, error: 'Cliente no encontrado en modo Demo.' },
        { status: 401 }
      );
      return clearClientSessionCookie(res, request);
    }

    const session = buildDemoSessionResponse(demoClient);
    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      ...session,
    });
  }

  try {
    const clientRes = await dbQuery<PortalClientRow>(
      `
      SELECT
        id,
        negocio_id,
        nombre_titular,
        COALESCE(email, email_contacto) AS email,
        email_contacto,
        telefono,
        pin_acceso_hash,
        porcentaje_comision_zelle,
        porcentaje_comision_binance,
        porcentaje_comision,
        remitentes_autorizados,
        remitentes_zelle_habituales,
        COALESCE(cuentas_asignadas, '[]'::jsonb) AS cuentas_asignadas,
        activo,
        created_at
      FROM clientes_titulares
      WHERE id = $1::uuid
        AND activo = TRUE
      LIMIT 1;
      `,
      [clienteId]
    );

    const row = clientRes.rows[0];
    if (!row) {
      const res = NextResponse.json(
        { ok: false, error: 'Cuenta de cliente no encontrada o inactiva.' },
        { status: 401 }
      );
      return clearClientSessionCookie(res, request);
    }

    const session = await loadPostgresPortalSession(row);
    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      ...session,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Error consultando sesión.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

interface PortalAuthPostBody {
  action?: 'REGISTER' | 'LOGIN' | 'LOGOUT';
  email?: string;
  pin?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PortalAuthPostBody;
    const action = body.action ?? 'LOGIN';

    if (action === 'LOGOUT') {
      const res = NextResponse.json({ ok: true });
      return clearClientSessionCookie(res, request);
    }

    if (action === 'REGISTER') {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Las cuentas de acceso son creadas exclusivamente por el administrador desde el panel principal.',
        },
        { status: 403 }
      );
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const pin = (body.pin ?? '').trim();

    const ip = getClientIp(request);
    const rl = checkRateLimit(`portal-login:${ip}:${email}`, 8, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: `Demasiados intentos fallidos. Espera ${rl.retryAfterSec} segundos antes de intentar de nuevo.`,
        },
        { status: 429 }
      );
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { ok: false, error: 'Ingresa un correo electrónico válido.' },
        { status: 400 }
      );
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { ok: false, error: 'El PIN de acceso debe tener entre 4 y 6 dígitos numéricos.' },
        { status: 400 }
      );
    }

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const matched = store.clients.find(
        (c) =>
          (c.email ?? c.email_contacto ?? '').toLowerCase() === email &&
          c.pin_plain === pin
      );

      if (!matched) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Credenciales inválidas. Verifica tu correo y PIN asignado por el administrador.',
          },
          { status: 401 }
        );
      }

      const session = buildDemoSessionResponse(matched);
      const res = NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        ...session,
      });
      return attachClientSessionCookie(
        res,
        { clienteId: matched.id, negocioId: matched.negocio_id ?? null },
        request
      );
    }

    const loginRes = await dbQuery<PortalClientRow>(
      `
      SELECT
        id,
        negocio_id,
        nombre_titular,
        COALESCE(email, email_contacto) AS email,
        email_contacto,
        telefono,
        pin_acceso_hash,
        porcentaje_comision_zelle,
        porcentaje_comision_binance,
        porcentaje_comision,
        remitentes_autorizados,
        remitentes_zelle_habituales,
        COALESCE(cuentas_asignadas, '[]'::jsonb) AS cuentas_asignadas,
        activo,
        created_at
      FROM clientes_titulares
      WHERE LOWER(COALESCE(email, email_contacto, '')) = LOWER($1)
        AND activo = TRUE
      LIMIT 1;
      `,
      [email]
    );

    const row = loginRes.rows[0];
    const verified = row
      ? verifySecretHash(pin, row.pin_acceso_hash)
      : { valid: false, needsUpgrade: false };

    if (!row || !verified.valid) {
      return NextResponse.json(
        { ok: false, error: 'Credenciales inválidas. Verifica tu correo y PIN.' },
        { status: 401 }
      );
    }

    // Actualizar transparentemente PIN heredado SHA-256 a scrypt con salt
    if (verified.needsUpgrade) {
      const upgradedHash = hashSecretScrypt(pin);
      await dbQuery(
        'UPDATE clientes_titulares SET pin_acceso_hash = $2 WHERE id = $1::uuid;',
        [row.id, upgradedHash]
      );
    }

    const session = await loadPostgresPortalSession(row);
    const res = NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      ...session,
    });
    return attachClientSessionCookie(
      res,
      { clienteId: row.id, negocioId: row.negocio_id ?? null },
      request
    );
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Error en autenticación de portal.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
