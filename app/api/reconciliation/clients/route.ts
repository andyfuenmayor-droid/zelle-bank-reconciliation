import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable, withTransaction } from '@/lib/db';
import {
  getActiveMailboxAssignedAccounts,
  normalizeAssignedAccounts,
  resolveClientAssignedAccounts,
} from '@/lib/assigned-accounts';
import {
  generateUniqueCode,
  hashSecretScrypt,
  requireAdminSession,
  resolveAuthorizedNegocioId,
} from '@/lib/security';
import {
  buildSampleReceiptBase64,
  DEMO_DEFAULT_ASSIGNED_ACCOUNTS,
  DemoClientInternal,
  getDemoClientsWithTotals,
  getDemoStore,
  runDemoAutoReconcileForOrder,
} from '@/lib/mock-seed-data';
import {
  AssignedReceivingAccount,
  ClientAccountRecord,
  CurrencyType,
  ExpectedPlatformType,
  PendingPaymentOrder,
  PlatformType,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    const headerNegocioId = authorizedNegocioId || store.businessUsers[0]?.id || '';
    const allClients = getDemoClientsWithTotals()
      .filter((c) => !headerNegocioId || (c.negocio_id ?? store.businessUsers[0]?.id) === headerNegocioId)
      .map((c) => {
        const internal = store.clients.find((dc) => dc.id === c.id);
        return {
          ...c,
          tiene_pin_configurado: Boolean(internal?.pin_plain),
        };
      });
    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      clients: allClients,
      pendingOrders: store.orders.filter(
        (o) =>
          o.estado === 'PENDIENTE' &&
          (!headerNegocioId ||
            (o.negocio_id ?? store.businessUsers[0]?.id) === headerNegocioId)
      ),
    });
  }

  try {
    const scope = { negocioId: authorizedNegocioId };
    const filterByNegocio = scope.negocioId !== null;
    const queryParams = filterByNegocio ? [scope.negocioId] : [];
    const clientWhere = filterByNegocio ? 'WHERE c.negocio_id = $1::uuid' : '';
    const orderWhere = filterByNegocio
      ? "WHERE estado = 'PENDIENTE' AND negocio_id = $1::uuid"
      : "WHERE estado = 'PENDIENTE'";

    const clientsSql = `
      SELECT
        c.id,
        c.negocio_id,
        c.nombre_titular,
        COALESCE(c.email, c.email_contacto) AS email,
        c.email_contacto,
        c.telefono,
        (c.pin_acceso_hash IS NOT NULL AND c.pin_acceso_hash <> '') AS tiene_pin_configurado,
        c.porcentaje_comision_zelle,
        c.porcentaje_comision_binance,
        c.porcentaje_comision,
        COALESCE(c.remitentes_autorizados, ARRAY[]::TEXT[]) AS remitentes_autorizados,
        COALESCE(c.remitentes_zelle_habituales, array_to_string(c.remitentes_autorizados, ', ')) AS remitentes_zelle_habituales,
        COALESCE(c.cuentas_asignadas, '[]'::jsonb) AS cuentas_asignadas,
        c.activo,
        c.created_at,
        COALESCE(SUM(t.monto_bruto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda <> 'USDT'), 0)::numeric(12,2) AS total_bruto_usd,
        COALESCE(SUM(t.monto_comision) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda <> 'USDT'), 0)::numeric(12,2) AS total_comision_usd,
        COALESCE(SUM(t.monto_neto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda <> 'USDT'), 0)::numeric(12,2) AS total_neto_usd,
        COALESCE(SUM(t.monto_bruto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda = 'USDT'), 0)::numeric(12,2) AS total_bruto_usdt,
        COALESCE(SUM(t.monto_comision) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda = 'USDT'), 0)::numeric(12,2) AS total_comision_usdt,
        COALESCE(SUM(t.monto_neto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda = 'USDT'), 0)::numeric(12,2) AS total_neto_usdt,
        COALESCE(SUM(t.monto_bruto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO'), 0)::numeric(12,2) AS total_bruto_conciliado,
        COALESCE(SUM(t.monto_comision) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO'), 0)::numeric(12,2) AS total_comision_retenida,
        COUNT(t.id) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO')::int AS pagos_conciliados_count,
        COALESCE(liq.total_liquidado_usd, 0)::numeric(12,2) AS total_liquidado_usd,
        COALESCE(liq.total_liquidado_usdt, 0)::numeric(12,2) AS total_liquidado_usdt,
        (COALESCE(SUM(t.monto_neto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda <> 'USDT'), 0) - COALESCE(liq.total_liquidado_usd, 0))::numeric(12,2) AS saldo_disponible_usd,
        (COALESCE(SUM(t.monto_neto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO' AND t.moneda = 'USDT'), 0) - COALESCE(liq.total_liquidado_usdt, 0))::numeric(12,2) AS saldo_disponible_usdt,
        (COALESCE(SUM(t.monto_neto) FILTER (WHERE t.estado = 'CONCILIADO' AND t.tipo_movimiento = 'RECIBIDO'), 0) - (COALESCE(liq.total_liquidado_usd, 0) + COALESCE(liq.total_liquidado_usdt, 0)))::numeric(12,2) AS total_neto_disponible,
        COALESCE(liq.liquidaciones_count, 0)::int AS liquidaciones_count
      FROM clientes_titulares c
      LEFT JOIN financial_transactions_reconciliation t
        ON (
          t.cliente_id = c.id
          OR (
            t.cliente_id IS NULL
            AND UPPER(TRIM(COALESCE(t.cliente_asignado_nombre, ''))) = UPPER(TRIM(c.nombre_titular))
          )
        )
        AND (t.negocio_id IS NOT DISTINCT FROM c.negocio_id OR t.negocio_id IS NULL OR c.negocio_id IS NULL)
      LEFT JOIN (
        SELECT
          cliente_id,
          COALESCE(SUM(monto_liquidado) FILTER (WHERE moneda <> 'USDT'), 0)::numeric(12,2) AS total_liquidado_usd,
          COALESCE(SUM(monto_liquidado) FILTER (WHERE moneda = 'USDT'), 0)::numeric(12,2) AS total_liquidado_usdt,
          COUNT(*)::int AS liquidaciones_count
        FROM liquidaciones_clientes
        GROUP BY cliente_id
      ) liq ON liq.cliente_id = c.id
      ${clientWhere}
      GROUP BY c.id, liq.total_liquidado_usd, liq.total_liquidado_usdt, liq.liquidaciones_count
      ORDER BY c.created_at DESC;
    `;

    const ordersSql = `
      SELECT
        id,
        negocio_id,
        codigo_orden,
        cliente_id,
        cliente_nombre,
        cliente_email,
        COALESCE(plataforma_esperada, banco_destino, 'CITIBANK') AS plataforma_esperada,
        COALESCE(banco_destino, plataforma_esperada, 'CITIBANK') AS banco_destino,
        COALESCE(moneda, 'USD') AS moneda,
        monto_esperado,
        fecha_transferencia,
        COALESCE(remitente_reportado, nombre_remitente_reportado, cliente_nombre) AS remitente_reportado,
        COALESCE(nombre_remitente_reportado, remitente_reportado, cliente_nombre) AS nombre_remitente_reportado,
        referencia_reportada,
        (CASE WHEN comprobante_base64 IS NOT NULL AND LENGTH(comprobante_base64) > 10 THEN true ELSE false END) AS has_capture,
        NULL::text AS comprobante_base64,
        comprobante_mime,
        datos_ocr_extraidos,
        estado,
        COALESCE(transaccion_conciliada_id, alerta_conciliada_id) AS transaccion_conciliada_id,
        liquidacion_id,
        liquidado_at,
        notas_cliente,
        created_at,
        updated_at
      FROM ordenes_pago_pendientes
      ${orderWhere}
      ORDER BY created_at DESC;
    `;

    const [clientsRes, ordersRes, activeMailboxAccounts] = await Promise.all([
      dbQuery<ClientAccountRecord>(clientsSql, queryParams),
      dbQuery<PendingPaymentOrder>(ordersSql, queryParams),
      getActiveMailboxAssignedAccounts(scope.negocioId),
    ]);

    const clients = clientsRes.rows.map((c) => ({
      ...c,
      cuentas_asignadas: resolveClientAssignedAccounts(
        c.cuentas_asignadas,
        activeMailboxAccounts
      ),
    }));

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      clients,
      pendingOrders: ordersRes.rows,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error consultando clientes.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

interface ClientOrOrderPostBody {
  action?: 'CREATE_CLIENT' | 'UPDATE_CLIENT' | 'CREATE_ORDER';
  negocioId?: string;
  // CREATE_CLIENT / UPDATE_CLIENT
  clientId?: string;
  nombreTitular?: string;
  emailContacto?: string;
  telefono?: string;
  pin?: string;
  remitentesZelleHabituales?: string;
  remitentesAutorizados?: string[];
  cuentasAsignadas?: AssignedReceivingAccount[];
  porcentajeComision?: number;
  porcentajeComisionZelle?: number;
  porcentajeComisionBinance?: number;
  // CREATE_ORDER
  clienteId?: string;
  clienteNombre?: string;
  clienteEmail?: string;
  nombreRemitenteReportado?: string;
  plataformaEsperada?: PlatformType;
  bancoDestino?: PlatformType;
  moneda?: CurrencyType;
  montoEsperado?: number;
  referenciaReportada?: string;
  comprobanteBase64?: string;
  notasCliente?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const body = (await request.json()) as ClientOrOrderPostBody;
    const authorizedNegocioId = resolveAuthorizedNegocioId(
      auth.session,
      request,
      body.negocioId
    );
    const action = body.action ?? 'CREATE_CLIENT';
    const dbConnected = await isDatabaseAvailable();

    if (action === 'CREATE_CLIENT') {
      const nombreTitular = (body.nombreTitular ?? '').trim();
      const email = (body.emailContacto ?? '').trim().toLowerCase();
      const telefono = (body.telefono ?? '').trim() || null;
      const pin = (body.pin ?? '').trim();
      const emptySenders: string[] = [];

      const zelleFee =
        typeof body.porcentajeComisionZelle === 'number' &&
        Number.isFinite(body.porcentajeComisionZelle)
          ? body.porcentajeComisionZelle
          : typeof body.porcentajeComision === 'number' &&
              Number.isFinite(body.porcentajeComision)
            ? body.porcentajeComision
            : 4.0;

      const binanceFee =
        typeof body.porcentajeComisionBinance === 'number' &&
        Number.isFinite(body.porcentajeComisionBinance)
          ? body.porcentajeComisionBinance
          : 1.5;

      if (nombreTitular.length < 2) {
        return NextResponse.json(
          { ok: false, error: 'El nombre del cliente titular es obligatorio.' },
          { status: 400 }
        );
      }

      if (!email || !email.includes('@')) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'El correo de acceso al portal es obligatorio para crear la cuenta.',
          },
          { status: 400 }
        );
      }

      if (!/^\d{4,6}$/.test(pin)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'El PIN de acceso al portal debe tener entre 4 y 6 dígitos numéricos.',
          },
          { status: 400 }
        );
      }

      const pinHash = hashSecretScrypt(pin);
      const normalizedAssignedInput = normalizeAssignedAccounts(
        body.cuentasAsignadas
      );

      if (!dbConnected) {
        const store = getDemoStore();
        const resolvedDemoNegocioId =
          body.negocioId?.trim() ||
          request.headers.get('x-negocio-id')?.trim() ||
          store.businessUsers[0]?.id ||
          null;
        const duplicate = store.clients.find(
          (c) => (c.email ?? c.email_contacto ?? '').toLowerCase() === email
        );
        if (duplicate) {
          return NextResponse.json(
            {
              ok: false,
              error: `Ya existe una cuenta registrada con el correo ${email}.`,
            },
            { status: 409 }
          );
        }

        const assignedDemo =
          normalizedAssignedInput.length > 0
            ? normalizedAssignedInput
            : DEMO_DEFAULT_ASSIGNED_ACCOUNTS.map((acc) => ({ ...acc }));

        const newClient: DemoClientInternal = {
          id: crypto.randomUUID(),
          negocio_id: resolvedDemoNegocioId,
          nombre_titular: nombreTitular,
          email,
          email_contacto: email,
          telefono,
          pin_plain: pin,
          tiene_pin_configurado: true,
          porcentaje_comision_zelle: zelleFee,
          porcentaje_comision_binance: binanceFee,
          porcentaje_comision: zelleFee,
          remitentes_autorizados: emptySenders,
          remitentes_zelle_habituales: null,
          cuentas_asignadas: assignedDemo,
          activo: true,
          total_bruto_usd: 0,
          total_comision_usd: 0,
          total_neto_usd: 0,
          total_bruto_usdt: 0,
          total_comision_usdt: 0,
          total_neto_usdt: 0,
          total_bruto_conciliado: 0,
          total_comision_retenida: 0,
          total_neto_disponible: 0,
          pagos_conciliados_count: 0,
          created_at: new Date().toISOString(),
        };
        store.clients.unshift(newClient);

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          client: newClient,
          autoReconciledCount: 0,
        });
      }

      const existing = await dbQuery<{ id: string }>(
        `
        SELECT id FROM clientes_titulares
        WHERE LOWER(COALESCE(email, email_contacto, '')) = LOWER($1)
        LIMIT 1;
        `,
        [email]
      );

      if (existing.rows[0]) {
        return NextResponse.json(
          {
            ok: false,
            error: `Ya existe una cuenta con el correo ${email}. Usa "Editar / PIN" en la tabla para actualizar sus credenciales.`,
          },
          { status: 409 }
        );
      }

      const scope = { negocioId: authorizedNegocioId };
      const activeMailboxAccounts = await getActiveMailboxAssignedAccounts(
        scope.negocioId
      );
      const accountsToSave =
        normalizedAssignedInput.length > 0
          ? resolveClientAssignedAccounts(
              normalizedAssignedInput,
              activeMailboxAccounts
            )
          : activeMailboxAccounts;

      const insertRes = await dbQuery<ClientAccountRecord>(
        `
        INSERT INTO clientes_titulares (
          negocio_id,
          nombre_titular,
          email,
          email_contacto,
          telefono,
          pin_acceso_hash,
          porcentaje_comision_zelle,
          porcentaje_comision_binance,
          porcentaje_comision,
          remitentes_autorizados,
          remitentes_zelle_habituales,
          cuentas_asignadas
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING
          id,
          negocio_id,
          nombre_titular,
          email,
          email_contacto,
          telefono,
          TRUE AS tiene_pin_configurado,
          porcentaje_comision_zelle,
          porcentaje_comision_binance,
          porcentaje_comision,
          remitentes_autorizados,
          remitentes_zelle_habituales,
          cuentas_asignadas,
          activo,
          created_at,
          0::numeric(12,2) AS total_bruto_usd,
          0::numeric(12,2) AS total_comision_usd,
          0::numeric(12,2) AS total_neto_usd,
          0::numeric(12,2) AS total_bruto_usdt,
          0::numeric(12,2) AS total_comision_usdt,
          0::numeric(12,2) AS total_neto_usdt,
          0::numeric(12,2) AS total_bruto_conciliado,
          0::numeric(12,2) AS total_comision_retenida,
          0::numeric(12,2) AS total_neto_disponible,
          0::int AS pagos_conciliados_count;
        `,
        [
          scope.negocioId,
          nombreTitular,
          email,
          email,
          telefono,
          pinHash,
          zelleFee,
          binanceFee,
          zelleFee,
          emptySenders,
          null,
          JSON.stringify(accountsToSave),
        ]
      );

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        client: insertRes.rows[0],
        autoReconciledCount: 0,
      });
    }

    if (action === 'UPDATE_CLIENT') {
      const clientId = (body.clientId ?? '').trim();
      const nombreTitular = (body.nombreTitular ?? '').trim();
      const email = (body.emailContacto ?? '').trim().toLowerCase();
      const telefono = (body.telefono ?? '').trim() || null;
      const pin = (body.pin ?? '').trim();

      if (!clientId) {
        return NextResponse.json(
          { ok: false, error: 'El identificador del cliente es requerido.' },
          { status: 400 }
        );
      }

      if (nombreTitular.length < 2) {
        return NextResponse.json(
          { ok: false, error: 'El nombre del cliente titular es obligatorio.' },
          { status: 400 }
        );
      }

      if (!email || !email.includes('@')) {
        return NextResponse.json(
          { ok: false, error: 'El correo de acceso al portal es obligatorio.' },
          { status: 400 }
        );
      }

      if (pin.length > 0 && !/^\d{4,6}$/.test(pin)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Si cambias el PIN, debe tener entre 4 y 6 dígitos numéricos.',
          },
          { status: 400 }
        );
      }

      const zelleFee =
        typeof body.porcentajeComisionZelle === 'number' &&
        Number.isFinite(body.porcentajeComisionZelle)
          ? body.porcentajeComisionZelle
          : 4.0;
      const binanceFee =
        typeof body.porcentajeComisionBinance === 'number' &&
        Number.isFinite(body.porcentajeComisionBinance)
          ? body.porcentajeComisionBinance
          : 1.5;

      if (!dbConnected) {
        const store = getDemoStore();
        const target = store.clients.find((c) => c.id === clientId);
        if (!target) {
          return NextResponse.json(
            { ok: false, error: 'Cliente no encontrado.' },
            { status: 404 }
          );
        }

        const conflict = store.clients.find(
          (c) =>
            c.id !== clientId &&
            (c.email ?? c.email_contacto ?? '').toLowerCase() === email
        );
        if (conflict) {
          return NextResponse.json(
            { ok: false, error: `Otro cliente ya usa el correo ${email}.` },
            { status: 409 }
          );
        }

        target.nombre_titular = nombreTitular;
        target.email = email;
        target.email_contacto = email;
        target.telefono = telefono;
        if (pin.length > 0) {
          target.pin_plain = pin;
        }
        target.tiene_pin_configurado = Boolean(target.pin_plain);
        target.porcentaje_comision_zelle = zelleFee;
        target.porcentaje_comision_binance = binanceFee;
        target.porcentaje_comision = zelleFee;
        target.remitentes_autorizados = [];
        target.remitentes_zelle_habituales = null;
        if (body.cuentasAsignadas !== undefined) {
          target.cuentas_asignadas = normalizeAssignedAccounts(
            body.cuentasAsignadas
          );
        }

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          client: target,
          autoReconciledCount: 0,
        });
      }

      const conflict = await dbQuery<{ id: string }>(
        `
        SELECT id FROM clientes_titulares
        WHERE id <> $1::uuid
          AND LOWER(COALESCE(email, email_contacto, '')) = LOWER($2)
        LIMIT 1;
        `,
        [clientId, email]
      );

      if (conflict.rows[0]) {
        return NextResponse.json(
          { ok: false, error: `Otro cliente ya tiene asignado el correo ${email}.` },
          { status: 409 }
        );
      }

      const scope = { negocioId: authorizedNegocioId };
      const pinHash = pin.length > 0 ? hashSecretScrypt(pin) : null;
      const activeMailboxAccounts = await getActiveMailboxAssignedAccounts(
        scope.negocioId
      );
      const accountsJsonParam =
        body.cuentasAsignadas !== undefined
          ? JSON.stringify(
              resolveClientAssignedAccounts(
                normalizeAssignedAccounts(body.cuentasAsignadas),
                activeMailboxAccounts
              )
            )
          : null;

      const updateRes = await dbQuery<ClientAccountRecord>(
        `
        UPDATE clientes_titulares
        SET nombre_titular = $2,
            email = $3,
            email_contacto = $3,
            telefono = $4,
            pin_acceso_hash = COALESCE($5, pin_acceso_hash),
            porcentaje_comision_zelle = $6,
            porcentaje_comision_binance = $7,
            porcentaje_comision = $6,
            remitentes_autorizados = $8,
            remitentes_zelle_habituales = $9,
            cuentas_asignadas = COALESCE($10::jsonb, cuentas_asignadas)
        WHERE id = $1::uuid
          AND (negocio_id = $11::uuid OR negocio_id IS NULL)
        RETURNING
          id,
          nombre_titular,
          email,
          email_contacto,
          telefono,
          (pin_acceso_hash IS NOT NULL AND pin_acceso_hash <> '') AS tiene_pin_configurado,
          porcentaje_comision_zelle,
          porcentaje_comision_binance,
          porcentaje_comision,
          remitentes_autorizados,
          remitentes_zelle_habituales,
          cuentas_asignadas,
          activo,
          created_at,
          0::numeric(12,2) AS total_bruto_usd,
          0::numeric(12,2) AS total_comision_usd,
          0::numeric(12,2) AS total_neto_usd,
          0::numeric(12,2) AS total_bruto_usdt,
          0::numeric(12,2) AS total_comision_usdt,
          0::numeric(12,2) AS total_neto_usdt,
          0::numeric(12,2) AS total_bruto_conciliado,
          0::numeric(12,2) AS total_comision_retenida,
          0::numeric(12,2) AS total_neto_disponible,
          0::int AS pagos_conciliados_count;
        `,
        [
          clientId,
          nombreTitular,
          email,
          telefono,
          pinHash,
          zelleFee,
          binanceFee,
          [],
          null,
          accountsJsonParam,
          scope.negocioId,
        ]
      );

      if (!updateRes.rows[0]) {
        return NextResponse.json(
          { ok: false, error: 'Cuenta de cliente no encontrada.' },
          { status: 404 }
        );
      }

      const updatedClient: ClientAccountRecord = {
        ...updateRes.rows[0],
        cuentas_asignadas: resolveClientAssignedAccounts(
          updateRes.rows[0].cuentas_asignadas,
          activeMailboxAccounts
        ),
      };

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        client: updatedClient,
        autoReconciledCount: 0,
      });
    }

    if (action === 'CREATE_ORDER') {
      const clienteNombre = (body.clienteNombre ?? '').trim();
      const clienteEmail = (
        body.clienteEmail ?? 'cliente@conciliarcuenta.com'
      ).trim();
      const remitenteReportado = (
        body.nombreRemitenteReportado || clienteNombre
      ).trim();
      const rawPlatform = (
        body.plataformaEsperada ??
        body.bancoDestino ??
        'CITIBANK'
      ).toUpperCase();

      const validExpected: ReadonlyArray<ExpectedPlatformType> = [
        'CITIBANK',
        'TD_BANK',
        'BINANCE_PAY',
        'BINANCE_P2P',
        'BINANCE_ONCHAIN',
      ];
      const plataformaEsperada: ExpectedPlatformType = validExpected.includes(
        rawPlatform as ExpectedPlatformType
      )
        ? (rawPlatform as ExpectedPlatformType)
        : 'CITIBANK';

      const moneda: CurrencyType =
        body.moneda ??
        (plataformaEsperada.startsWith('BINANCE') ? 'USDT' : 'USD');

      const montoEsperado = Number(body.montoEsperado ?? 0);
      const referenciaReportada =
        (body.referenciaReportada ?? '').trim() || 'SIN-REF';
      const notasCliente = (body.notasCliente ?? '').trim() || null;

      if (
        !clienteNombre ||
        !Number.isFinite(montoEsperado) ||
        montoEsperado <= 0
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'El nombre del cliente y un monto esperado mayor a 0 son obligatorios.',
          },
          { status: 400 }
        );
      }

      const codigoOrden = generateUniqueCode('ORD');

      const comprobanteBase64 =
        body.comprobanteBase64?.trim() ||
        buildSampleReceiptBase64({
          plataforma: plataformaEsperada,
          monto: `${moneda === 'USD' ? '$' : ''}${montoEsperado.toFixed(2)}`,
          moneda,
          remitente: remitenteReportado,
          referencia: referenciaReportada,
          fecha: new Date().toISOString().slice(0, 16).replace('T', ' '),
        });

      if (!dbConnected) {
        const store = getDemoStore();
        const demoNegocioId =
          body.negocioId?.trim() ||
          request.headers.get('x-negocio-id')?.trim() ||
          store.businessUsers[0]?.id ||
          null;
        let existingClient = store.clients.find(
          (c) =>
            (c.negocio_id ?? store.businessUsers[0]?.id) === demoNegocioId &&
            (c.id === body.clienteId ||
              c.nombre_titular.toLowerCase() === clienteNombre.toLowerCase())
        );
        if (!existingClient) {
          existingClient = {
            id: crypto.randomUUID(),
            negocio_id: demoNegocioId,
            nombre_titular: clienteNombre,
            email: clienteEmail,
            email_contacto: clienteEmail,
            telefono: null,
            pin_plain: '1234',
            porcentaje_comision_zelle: 4.0,
            porcentaje_comision_binance: 1.5,
            porcentaje_comision: 4.0,
            remitentes_autorizados: [],
            remitentes_zelle_habituales: null,
            cuentas_asignadas: DEMO_DEFAULT_ASSIGNED_ACCOUNTS.map((acc) => ({
              ...acc,
            })),
            activo: true,
            total_bruto_usd: 0,
            total_comision_usd: 0,
            total_neto_usd: 0,
            total_bruto_usdt: 0,
            total_comision_usdt: 0,
            total_neto_usdt: 0,
            total_bruto_conciliado: 0,
            total_comision_retenida: 0,
            total_neto_disponible: 0,
            pagos_conciliados_count: 0,
            created_at: new Date().toISOString(),
          };
          store.clients.unshift(existingClient);
        }

        const newOrder: PendingPaymentOrder = {
          id: crypto.randomUUID(),
          negocio_id: demoNegocioId,
          codigo_orden: codigoOrden,
          cliente_id: existingClient.id,
          cliente_nombre: existingClient.nombre_titular,
          cliente_email: clienteEmail,
          plataforma_esperada: plataformaEsperada,
          banco_destino: plataformaEsperada,
          moneda,
          monto_esperado: Math.round(montoEsperado * 100) / 100,
          remitente_reportado: remitenteReportado,
          nombre_remitente_reportado: remitenteReportado,
          referencia_reportada: referenciaReportada,
          comprobante_base64: comprobanteBase64,
          comprobante_mime: 'image/svg+xml',
          datos_ocr_extraidos: null,
          estado: 'PENDIENTE',
          transaccion_conciliada_id: null,
          notas_cliente: notasCliente,
          created_at: new Date().toISOString(),
        };

        store.orders.unshift(newOrder);
        const matched = runDemoAutoReconcileForOrder(newOrder.id);

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          order: newOrder,
          autoReconciledCount: matched.reconciled ? 1 : 0,
        });
      }

      const scope = { negocioId: authorizedNegocioId };

      const result = await withTransaction(async (client) => {
        let resolvedClientId = body.clienteId?.trim() || '';

        if (resolvedClientId) {
          const check = await client.query<{ id: string }>(
            'SELECT id FROM clientes_titulares WHERE id = $1::uuid LIMIT 1;',
            [resolvedClientId]
          );
          if (!check.rows[0]) {
            resolvedClientId = '';
          }
        }

        if (!resolvedClientId) {
          const byName = await client.query<{ id: string }>(
            scope.negocioId
              ? 'SELECT id FROM clientes_titulares WHERE UPPER(TRIM(nombre_titular)) = UPPER(TRIM($1)) AND (negocio_id = $2::uuid OR negocio_id IS NULL) LIMIT 1;'
              : 'SELECT id FROM clientes_titulares WHERE UPPER(TRIM(nombre_titular)) = UPPER(TRIM($1)) LIMIT 1;',
            scope.negocioId ? [clienteNombre, scope.negocioId] : [clienteNombre]
          );
          if (byName.rows[0]) {
            resolvedClientId = byName.rows[0].id;
          } else {
            const autoCreated = await client.query<{ id: string }>(
              `
              INSERT INTO clientes_titulares (
                negocio_id,
                nombre_titular,
                email_contacto,
                remitentes_autorizados,
                remitentes_zelle_habituales
              )
              VALUES ($1::uuid, $2, $3, $4, $5)
              RETURNING id;
              `,
              [
                scope.negocioId,
                clienteNombre,
                clienteEmail,
                [clienteNombre, remitenteReportado],
                `${clienteNombre}, ${remitenteReportado}`,
              ]
            );
            resolvedClientId = autoCreated.rows[0]?.id ?? crypto.randomUUID();
          }
        }

        const orderRes = await client.query<PendingPaymentOrder>(
          `
          INSERT INTO ordenes_pago_pendientes (
            negocio_id,
            codigo_orden,
            cliente_id,
            cliente_nombre,
            cliente_email,
            plataforma_esperada,
            banco_destino,
            moneda,
            monto_esperado,
            remitente_reportado,
            nombre_remitente_reportado,
            referencia_reportada,
            comprobante_base64,
            comprobante_mime,
            estado,
            notas_cliente
          )
          VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDIENTE', $15)
          RETURNING *;
          `,
          [
            scope.negocioId,
            codigoOrden,
            resolvedClientId,
            clienteNombre,
            clienteEmail,
            plataformaEsperada,
            plataformaEsperada,
            moneda,
            Math.round(montoEsperado * 100) / 100,
            remitenteReportado,
            remitenteReportado,
            referenciaReportada,
            comprobanteBase64,
            'image/svg+xml',
            notasCliente,
          ]
        );

        let autoReconciledCount = 0;
        const newOrder = orderRes.rows[0];
        if (newOrder) {
          const matchRes = await client.query<{ conciliado: boolean }>(
            'SELECT * FROM fn_conciliar_orden_cliente($1::uuid);',
            [newOrder.id]
          );
          if (matchRes.rows[0]?.conciliado) {
            autoReconciledCount = 1;
          }
        }

        return {
          order: newOrder,
          autoReconciledCount,
        };
      });

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        ...result,
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

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = requireAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }
  const authorizedNegocioId = resolveAuthorizedNegocioId(auth.session, request);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id')?.trim() ?? '';

  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'Se requiere el id del cliente.' },
      { status: 400 }
    );
  }

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    store.clients = store.clients.filter((c) => c.id !== id);
    return NextResponse.json({ ok: true, mode: 'DEMO_FALLBACK' });
  }

  try {
    await dbQuery(
      'DELETE FROM clientes_titulares WHERE id = $1::uuid AND (negocio_id = $2::uuid OR negocio_id IS NULL);',
      [id, authorizedNegocioId]
    );
    return NextResponse.json({ ok: true, mode: 'POSTGRESQL_LIVE' });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error eliminando cliente.';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
