import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  getActiveMailboxAssignedAccounts,
  resolveClientAssignedAccounts,
} from '@/lib/assigned-accounts';
import {
  computeClientWalletSummary,
  DEMO_DEFAULT_ASSIGNED_ACCOUNTS,
  DemoClientInternal,
  getDemoStore,
} from '@/lib/mock-seed-data';
import {
  AssignedReceivingAccount,
  ClientAccountRecord,
  ClientPortalWalletSummary,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hashPinSha256(pin: string): string {
  return crypto.createHash('sha256').update(pin.trim()).digest('hex');
}

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
}> {
  const [aggRes, ordersRes, activeMailboxAccounts] = await Promise.all([
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
          OR UPPER(TRIM(COALESCE(cliente_asignado_nombre, ''))) = UPPER(TRIM($2))
        )
      GROUP BY moneda;
      `,
      [clientRow.id, clientRow.nombre_titular]
    ),
    dbQuery<PendingPaymentOrder>(
      `
      SELECT
        id,
        codigo_orden,
        cliente_id,
        cliente_nombre,
        cliente_email,
        COALESCE(plataforma_esperada, banco_destino, 'CITIBANK') AS plataforma_esperada,
        COALESCE(banco_destino, plataforma_esperada, 'CITIBANK') AS banco_destino,
        COALESCE(moneda, 'USD') AS moneda,
        monto_esperado,
        COALESCE(remitente_reportado, nombre_remitente_reportado, cliente_nombre) AS remitente_reportado,
        COALESCE(nombre_remitente_reportado, remitente_reportado, cliente_nombre) AS nombre_remitente_reportado,
        referencia_reportada,
        comprobante_base64,
        comprobante_mime,
        datos_ocr_extraidos,
        estado,
        COALESCE(transaccion_conciliada_id, alerta_conciliada_id) AS transaccion_conciliada_id,
        notas_cliente,
        created_at,
        updated_at
      FROM ordenes_pago_pendientes
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

  const pagosPendientesCount = ordersRes.rows.filter(
    (o) => o.estado === 'PENDIENTE'
  ).length;

  const wallet: ClientPortalWalletSummary = {
    saldoNetoUsd: Math.round(saldoNetoUsd * 100) / 100,
    totalBrutoUsd: Math.round(totalBrutoUsd * 100) / 100,
    totalComisionUsd: Math.round(totalComisionUsd * 100) / 100,
    saldoNetoUsdt: Math.round(saldoNetoUsdt * 100) / 100,
    totalBrutoUsdt: Math.round(totalBrutoUsdt * 100) / 100,
    totalComisionUsdt: Math.round(totalComisionUsdt * 100) / 100,
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
  };
}

function buildDemoSessionResponse(demoClient: DemoClientInternal): {
  client: ClientAccountRecord;
  wallet: ClientPortalWalletSummary;
  orders: PendingPaymentOrder[];
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

  return { client: publicClient, wallet, orders };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const clienteId = searchParams.get('clienteId')?.trim() ?? '';

  if (!clienteId) {
    return NextResponse.json(
      { ok: false, error: 'El parámetro clienteId es obligatorio.' },
      { status: 400 }
    );
  }

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    const demoClient = store.clients.find((c) => c.id === clienteId);
    if (!demoClient) {
      return NextResponse.json(
        { ok: false, error: 'Cliente no encontrado en modo Demo.' },
        { status: 404 }
      );
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
      LIMIT 1;
      `,
      [clienteId]
    );

    const row = clientRes.rows[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'Cuenta de cliente no encontrada.' },
        { status: 404 }
      );
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
  action?: 'REGISTER' | 'LOGIN';
  email?: string;
  pin?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as PortalAuthPostBody;
    const action = body.action ?? 'LOGIN';

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
    const pinHash = hashPinSha256(pin);

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
      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        ...session,
      });
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
        AND pin_acceso_hash = $2
        AND activo = TRUE
      LIMIT 1;
      `,
      [email, pinHash]
    );

    const row = loginRes.rows[0];
    if (!row) {
      return NextResponse.json(
        { ok: false, error: 'Credenciales inválidas. Verifica tu correo y PIN.' },
        { status: 401 }
      );
    }

    const session = await loadPostgresPortalSession(row);
    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      ...session,
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Error en autenticación de portal.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
