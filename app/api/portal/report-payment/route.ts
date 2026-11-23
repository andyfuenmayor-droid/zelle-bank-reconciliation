import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseAvailable, withTransaction } from '@/lib/db';
import { computeNameMatchScore } from '@/lib/name-similarity';
import {
  generateUniqueCode,
  getClientSession,
  isAllowedRasterImageDataUrl,
} from '@/lib/security';
import {
  buildDemoOcrFallback,
  computeClientWalletSummary,
  getDemoStore,
  runDemoAutoReconcileForOrder,
} from '@/lib/mock-seed-data';
import {
  ClientPortalWalletSummary,
  CurrencyType,
  ExpectedPlatformType,
  FinancialTransactionRecord,
  OcrExtractionData,
  PendingPaymentOrder,
} from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VALID_PLATFORMS: ReadonlyArray<ExpectedPlatformType> = [
  'CITIBANK',
  'TD_BANK',
  'BINANCE_PAY',
  'BINANCE_P2P',
  'BINANCE_ONCHAIN',
];

const VALID_CURRENCIES: ReadonlyArray<CurrencyType> = ['USD', 'USDT', 'VES'];

interface ReportPaymentBody {
  clienteId?: string;
  plataforma_esperada?: string;
  moneda?: string;
  monto_esperado?: number;
  fecha_transferencia?: string;
  remitente_reportado?: string;
  referencia_reportada?: string;
  comprobante_base64?: string;
  comprobante_mime?: string;
  notas_cliente?: string;
}

class NameMismatchError extends Error {
  similarityPercent: number;
  reportedName: string;

  constructor(message: string, similarityPercent: number, reportedName: string) {
    super(message);
    this.name = 'NameMismatchError';
    this.similarityPercent = similarityPercent;
    this.reportedName = reportedName;
  }
}

function extractMimeFromDataUrl(dataUrl: string, explicitMime?: string): string {
  if (explicitMime && explicitMime.trim().length > 0) {
    return explicitMime.trim();
  }
  const match = dataUrl.match(/^data:([^;]+);base64,/i);
  return match?.[1] ?? 'image/jpeg';
}

function formatDuplicateDateVe(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }
  try {
    return new Intl.DateTimeFormat('es-VE', {
      timeZone: 'America/Caracas',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function formatTransferDateOnlyVe(value: string | null | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, day] = trimmed.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
    try {
      return new Intl.DateTimeFormat('es-VE', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(d);
    } catch {
      return trimmed;
    }
  }
  return formatDuplicateDateVe(trimmed);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const clientSession = getClientSession(request);
    if (!clientSession) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Tu sesión del portal expiró. Inicia sesión nuevamente para reportar un pago.',
        },
        { status: 401 }
      );
    }

    const body = (await request.json()) as ReportPaymentBody;
    const clienteId = clientSession.clienteId;
    const rawPlatform = (body.plataforma_esperada ?? '').trim().toUpperCase();
    const rawCurrency = (body.moneda ?? '').trim().toUpperCase();
    const montoEsperado = Number(body.monto_esperado ?? 0);
    const fechaTransferencia = (body.fecha_transferencia ?? '').trim() || null;
    const remitenteReportado = (body.remitente_reportado ?? '').trim();
    const rawReferenciaReportada = (body.referencia_reportada ?? '').trim();
    const comprobanteBase64 = (body.comprobante_base64 ?? '').trim();
    const notasCliente = (body.notas_cliente ?? '').trim() || null;

    if (!clienteId) {
      return NextResponse.json(
        { ok: false, error: 'Debes iniciar sesión en el portal para reportar un pago.' },
        { status: 401 }
      );
    }

    if (
      !VALID_PLATFORMS.includes(rawPlatform as ExpectedPlatformType)
    ) {
      return NextResponse.json(
        { ok: false, error: 'Selecciona una plataforma de pago válida.' },
        { status: 400 }
      );
    }
    const plataforma = rawPlatform as ExpectedPlatformType;

    const defaultCurrency: CurrencyType = plataforma.startsWith('BINANCE')
      ? 'USDT'
      : 'USD';
    const moneda: CurrencyType = VALID_CURRENCIES.includes(
      rawCurrency as CurrencyType
    )
      ? (rawCurrency as CurrencyType)
      : defaultCurrency;

    if (!Number.isFinite(montoEsperado) || montoEsperado <= 0) {
      return NextResponse.json(
        { ok: false, error: 'El monto del pago debe ser mayor a 0.' },
        { status: 400 }
      );
    }

    if (remitenteReportado.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Indica el nombre del titular Zelle o tu nickname/ID en Binance.',
        },
        { status: 400 }
      );
    }

    // En Zelle (Citibank / TD Bank) muchos bancos (Chase, Zelle iOS, Wells Fargo) no muestran código en pantalla inicial.
    // Permitir referencia vacía y normalizarla a 'SIN-REF' para conciliar por Monto + Nombre del Remitente.
    if (plataforma.startsWith('BINANCE') && rawReferenciaReportada.length < 3) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Ingresa el número de confirmación, Order ID o TxID del comprobante de Binance.',
        },
        { status: 400 }
      );
    }
    const referenciaReportada =
      rawReferenciaReportada.length >= 3 ? rawReferenciaReportada : 'SIN-REF';

    if (!isAllowedRasterImageDataUrl(comprobanteBase64)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'La captura de pantalla del comprobante de pago es obligatoria en formato PNG, JPG o WEBP. Debes adjuntar una imagen real para enviar el reporte.',
        },
        { status: 400 }
      );
    }

    const comprobanteMime = extractMimeFromDataUrl(
      comprobanteBase64,
      body.comprobante_mime
    );
    const normalizedAmount = Math.round(montoEsperado * 100) / 100;
    const codigoOrden = generateUniqueCode('ORD');

    const dbConnected = await isDatabaseAvailable();

    if (!dbConnected) {
      const store = getDemoStore();
      const client = store.clients.find((c) => c.id === clienteId);
      if (!client) {
        return NextResponse.json(
          { ok: false, error: 'Cuenta de cliente no encontrada.' },
          { status: 404 }
        );
      }

      const ocrData = buildDemoOcrFallback({
        plataforma,
        moneda,
        monto: normalizedAmount,
        referencia: referenciaReportada,
        remitente: remitenteReportado,
      });

      const newOrder: PendingPaymentOrder = {
        id: crypto.randomUUID(),
        negocio_id: client.negocio_id ?? null,
        codigo_orden: codigoOrden,
        cliente_id: client.id,
        cliente_nombre: client.nombre_titular,
        cliente_email: client.email ?? client.email_contacto ?? 'cliente@conciliarcuenta.com',
        plataforma_esperada: plataforma,
        banco_destino: plataforma,
        moneda,
        monto_esperado: normalizedAmount,
        fecha_transferencia: fechaTransferencia,
        remitente_reportado: remitenteReportado,
        nombre_remitente_reportado: remitenteReportado,
        referencia_reportada: referenciaReportada,
        comprobante_base64: comprobanteBase64,
        comprobante_mime: comprobanteMime,
        datos_ocr_extraidos: ocrData,
        estado: 'PENDIENTE',
        transaccion_conciliada_id: null,
        notas_cliente: notasCliente,
        created_at: new Date().toISOString(),
      };

      store.orders.unshift(newOrder);
      const matchResult = runDemoAutoReconcileForOrder(newOrder.id);
      const wallet = computeClientWalletSummary(
        client.id,
        store.transactions,
        store.orders
      );

      return NextResponse.json({
        ok: true,
        mode: 'DEMO_FALLBACK',
        instantReconciled: matchResult.reconciled,
        order: newOrder,
        reconciledTransaction: matchResult.transaction,
        wallet,
      });
    }

    // Metadatos OCR rápidos de los datos ya escaneados y confirmados en el Paso 1
    // (evita re-llamar a Gemini Vision al presionar Enviar y elimina demoras/cortes en móvil)
    const ocrResult: OcrExtractionData = {
      ...buildDemoOcrFallback({
        plataforma,
        moneda,
        monto: normalizedAmount,
        referencia: referenciaReportada,
        remitente: remitenteReportado,
      }),
      observaciones:
        referenciaReportada === 'SIN-REF'
          ? 'Comprobante registrado desde el Portal sin código de confirmación visible (conciliación por monto y remitente).'
          : 'Comprobante validado y registrado desde el Portal de Clientes.',
    };

    const txOutcome = await withTransaction<{
      order: PendingPaymentOrder;
      instantReconciled: boolean;
      reconciledTransaction: FinancialTransactionRecord | null;
      nameMatchPercent: number | null;
      wallet: ClientPortalWalletSummary;
    }>(async (client) => {
      const clientRes = await client.query<{
        id: string;
        negocio_id: string | null;
        nombre_titular: string;
        email: string | null;
        email_contacto: string | null;
      }>(
        `
        SELECT id, negocio_id, nombre_titular, email, email_contacto
        FROM clientes_titulares
        WHERE id = $1::uuid
          AND activo = TRUE
        LIMIT 1;
        `,
        [clienteId]
      );

      const clientRow = clientRes.rows[0];
      if (!clientRow) {
        throw new Error('La cuenta de cliente especificada no existe o está inactiva.');
      }

      const clientEmail =
        clientRow.email ??
        clientRow.email_contacto ??
        'cliente@conciliarcuenta.com';

      // Validación anti-duplicados: evitar que un cliente suba dos veces el mismo código de confirmación real
      const cleanRefCheck = referenciaReportada
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const isSpecificBankRef =
        cleanRefCheck.length >= 6 &&
        !/^[0-9]+$/.test(cleanRefCheck) &&
        ![
          'SINREF',
          'NOREF',
          'BANKOFAMERICA',
          'CITIBANK',
          'TDBANK',
          'WELLSFARGO',
          'TRANSFERENCIA',
          'COMPROBANTE',
        ].includes(cleanRefCheck);

      if (isSpecificBankRef) {
        const dupOrderRes = await client.query<{
          codigo_orden: string;
          estado: string;
          cliente_nombre: string | null;
          remitente_reportado: string;
          monto_esperado: number;
          moneda: string | null;
          fecha_transferencia: string | null;
          created_at: string;
          conciliado_at: string | null;
          liquidado_at: string | null;
          codigo_liquidacion: string | null;
          numero_ciclo: number | null;
          liquidacion_fecha: string | null;
          tx_fecha: string | null;
        }>(
          `
          SELECT
            o.codigo_orden,
            o.estado,
            o.cliente_nombre,
            COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, 'Remitente') AS remitente_reportado,
            o.monto_esperado,
            COALESCE(o.moneda, 'USD') AS moneda,
            o.fecha_transferencia,
            o.created_at,
            o.conciliado_at,
            COALESCE(o.liquidado_at, t.liquidado_at) AS liquidado_at,
            l.codigo_liquidacion,
            l.numero_ciclo,
            l.created_at AS liquidacion_fecha,
            t.fecha_transaccion AS tx_fecha
          FROM ordenes_pago_pendientes o
          LEFT JOIN financial_transactions_reconciliation t
            ON t.id = COALESCE(o.transaccion_conciliada_id, o.alerta_conciliada_id)
          LEFT JOIN (
            SELECT
              id,
              codigo_liquidacion,
              created_at,
              ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY created_at ASC, id ASC)::int AS numero_ciclo
            FROM liquidaciones_clientes
          ) l
            ON l.id = COALESCE(o.liquidacion_id, t.liquidacion_id)
          WHERE o.estado IN ('CONCILIADO', 'PENDIENTE', 'LIQUIDADO')
            AND UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Za-z0-9]', '', 'g')) = $1
          ORDER BY o.created_at DESC
          LIMIT 1;
          `,
          [cleanRefCheck]
        );
        const dupOrder = dupOrderRes.rows[0];
        if (dupOrder) {
          const dupCurrency = dupOrder.moneda || 'USD';
          const fechaPagoStr =
            formatDuplicateDateVe(dupOrder.tx_fecha) ??
            formatTransferDateOnlyVe(dupOrder.fecha_transferencia);
          const fechaRegistroStr = formatDuplicateDateVe(dupOrder.created_at);
          const fechaConciliadoStr = formatDuplicateDateVe(dupOrder.conciliado_at);
          const fechaLiqStr = formatDuplicateDateVe(
            dupOrder.liquidacion_fecha ?? dupOrder.liquidado_at
          );
          const isLiquidated = Boolean(
            dupOrder.estado === 'LIQUIDADO' ||
              dupOrder.liquidado_at ||
              dupOrder.codigo_liquidacion
          );
          const cicloPrefix = dupOrder.numero_ciclo
            ? `Ciclo #${dupOrder.numero_ciclo} (cerrado)`
            : 'Ciclo cerrado';
          const cicloDesc = isLiquidated
            ? `${cicloPrefix} — Liquidado${fechaLiqStr ? ` el ${fechaLiqStr}` : ''}${
                dupOrder.codigo_liquidacion
                  ? ` (${dupOrder.codigo_liquidacion})`
                  : ''
              }`
            : dupOrder.estado === 'CONCILIADO'
              ? 'Ciclo activo actual (conciliado, pendiente por liquidar)'
              : 'Ciclo activo actual (en verificación bancaria)';

          const details: string[] = [
            `Comprobante duplicado: La referencia "${referenciaReportada}" (${dupOrder.remitente_reportado} · $${Number(
              dupOrder.monto_esperado
            ).toFixed(2)} ${dupCurrency}) ya fue registrada en la orden ${dupOrder.codigo_orden}${
              dupOrder.cliente_nombre
                ? ` a favor de ${dupOrder.cliente_nombre}`
                : ''
            }.`,
          ];
          if (fechaPagoStr) {
            details.push(`• Fecha del pago/correo: ${fechaPagoStr}`);
          }
          if (fechaConciliadoStr) {
            details.push(`• Fecha de conciliación: ${fechaConciliadoStr}`);
          } else if (fechaRegistroStr) {
            details.push(`• Fecha de registro: ${fechaRegistroStr}`);
          }
          details.push(`• Ciclo: ${cicloDesc}.`);
          details.push('No se permite subir el mismo comprobante dos veces.');

          throw new Error(details.join('\n'));
        }

        const dupTxRes = await client.query<{
          referencia: string;
          remitente_o_contraparte: string;
          monto_bruto: number;
          moneda: string | null;
          cliente_asignado_nombre: string | null;
          fecha_transaccion: string | null;
          conciliado_at: string | null;
          liquidado_at: string | null;
          codigo_liquidacion: string | null;
          numero_ciclo: number | null;
          liquidacion_fecha: string | null;
          codigo_orden: string | null;
          orden_referencia_reportada: string | null;
          orden_remitente_reportado: string | null;
        }>(
          `
          SELECT
            t.referencia,
            t.remitente_o_contraparte,
            t.monto_bruto,
            COALESCE(t.moneda, 'USD') AS moneda,
            t.cliente_asignado_nombre,
            t.fecha_transaccion,
            t.conciliado_at,
            t.liquidado_at,
            l.codigo_liquidacion,
            l.numero_ciclo,
            l.created_at AS liquidacion_fecha,
            o.codigo_orden,
            o.referencia_reportada AS orden_referencia_reportada,
            COALESCE(o.remitente_reportado, o.nombre_remitente_reportado) AS orden_remitente_reportado
          FROM financial_transactions_reconciliation t
          LEFT JOIN (
            SELECT
              id,
              codigo_liquidacion,
              created_at,
              ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY created_at ASC, id ASC)::int AS numero_ciclo
            FROM liquidaciones_clientes
          ) l
            ON l.id = t.liquidacion_id
          LEFT JOIN ordenes_pago_pendientes o
            ON o.id = t.orden_conciliada_id
          WHERE t.estado = 'CONCILIADO'
            AND t.tipo_movimiento = 'RECIBIDO'
            AND t.monto_bruto = $2
            AND (
              UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Za-z0-9]', '', 'g')) = $1
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $1 || '%'
              OR (
                LENGTH($1) >= 7
                AND TRANSLATE(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Za-z0-9]', '', 'g')), 'ILO', '110')
                  LIKE '%' || TRANSLATE($1, 'ILO', '110') || '%'
              )
            )
          LIMIT 1;
          `,
          [cleanRefCheck, normalizedAmount]
        );
        const dupTx = dupTxRes.rows[0];
        if (dupTx) {
          const dupCurrency = dupTx.moneda || 'USD';
          const fechaCorreoStr = formatDuplicateDateVe(dupTx.fecha_transaccion);
          const fechaConciliadoStr = formatDuplicateDateVe(dupTx.conciliado_at);
          const fechaLiqStr = formatDuplicateDateVe(
            dupTx.liquidacion_fecha ?? dupTx.liquidado_at
          );
          const isLiquidated = Boolean(
            dupTx.liquidado_at || dupTx.codigo_liquidacion
          );
          const cicloTxPrefix = dupTx.numero_ciclo
            ? `Ciclo #${dupTx.numero_ciclo} (cerrado)`
            : 'Ciclo cerrado';
          const cicloDesc = isLiquidated
            ? `${cicloTxPrefix} — Liquidado${fechaLiqStr ? ` el ${fechaLiqStr}` : ''}${
                dupTx.codigo_liquidacion
                  ? ` (${dupTx.codigo_liquidacion})`
                  : ''
              }`
            : 'Ciclo activo actual (acreditado, pendiente por liquidar)';

          const details: string[] = [
            `Comprobante ya acreditado: La referencia bancaria "${dupTx.referencia}" (${dupTx.remitente_o_contraparte} · $${Number(
              dupTx.monto_bruto
            ).toFixed(2)} ${dupCurrency}) ya fue conciliada y acreditada anteriormente${
              dupTx.cliente_asignado_nombre
                ? ` a favor de ${dupTx.cliente_asignado_nombre}`
                : ''
            }.`,
          ];
          if (dupTx.codigo_orden) {
            const extraOrderMeta: string[] = [];
            if (
              dupTx.orden_referencia_reportada &&
              dupTx.orden_referencia_reportada.toUpperCase() !==
                dupTx.referencia.toUpperCase()
            ) {
              extraOrderMeta.push(`Ref. en orden: ${dupTx.orden_referencia_reportada}`);
            }
            if (dupTx.orden_remitente_reportado) {
              extraOrderMeta.push(`Remitente: ${dupTx.orden_remitente_reportado}`);
            }
            details.push(
              `• Orden asociada: ${dupTx.codigo_orden}${
                extraOrderMeta.length > 0 ? ` (${extraOrderMeta.join(' · ')})` : ''
              }`
            );
          }
          if (fechaCorreoStr) {
            details.push(`• Fecha del correo bancario: ${fechaCorreoStr}`);
          }
          if (fechaConciliadoStr) {
            details.push(`• Fecha de conciliación: ${fechaConciliadoStr}`);
          }
          details.push(`• Ciclo: ${cicloDesc}.`);

          throw new Error(details.join('\n'));
        }

        // Validación obligatoria de nombre cuando el correo bancario coincidente YA llegó a la BD:
        // - Si el correo coincidente aún NO ha llegado -> graba y envía normalmente en PENDIENTE.
        // - Si el correo coincidente YA llegó -> verifica que el nombre introducido coincida (>= 70%);
        //   si no coincide, no graba y solicita al cliente corregir el nombre del remitente.
        const matchingBankEmailRes = await client.query<{
          id: string;
          remitente_o_contraparte: string;
          referencia: string;
          monto_bruto: number;
        }>(
          `
          SELECT id, remitente_o_contraparte, referencia, monto_bruto
          FROM financial_transactions_reconciliation
          WHERE estado IN ('DETECTADO', 'REVISION_MANUAL')
            AND tipo_movimiento = 'RECIBIDO'
            AND moneda = $1
            AND monto_bruto = $2
            AND (negocio_id IS NOT DISTINCT FROM $3::uuid OR negocio_id IS NULL OR $3::uuid IS NULL)
            AND (
              UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')) = $4
              OR UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $4 || '%'
              OR $4 LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')) || '%'
              OR (
                LENGTH($4) >= 6
                AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g'))) >= 6
                AND RIGHT(UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')), 6) = RIGHT($4, 6)
              )
              OR (
                LENGTH($4) >= 7
                AND (
                  TRANSLATE(UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')), 'ILO', '110')
                    LIKE '%' || TRANSLATE($4, 'ILO', '110') || '%'
                  OR TRANSLATE($4, 'ILO', '110')
                    LIKE '%' || TRANSLATE(UPPER(REGEXP_REPLACE(COALESCE(referencia, ''), '[^A-Za-z0-9]', '', 'g')), 'ILO', '110') || '%'
                )
              )
            )
          ORDER BY fecha_transaccion ASC
          LIMIT 1;
          `,
          [moneda, normalizedAmount, clientRow.negocio_id, cleanRefCheck]
        );

        const matchedBankEmail = matchingBankEmailRes.rows[0];
        if (matchedBankEmail) {
          const nameCheck = computeNameMatchScore(
            remitenteReportado,
            matchedBankEmail.remitente_o_contraparte
          );
          if (nameCheck.similarityPercent < 70) {
            throw new NameMismatchError(
              `El correo bancario para este pago ($${normalizedAmount.toFixed(2)} ${moneda} · Ref: ${referenciaReportada}) ya fue recibido, pero el nombre ingresado "${remitenteReportado}" no coincide con el remitente del banco (${nameCheck.similarityPercent}% de coincidencia). Por favor introduce el nombre correcto que realizó la transferencia y vuelve a enviar.`,
              nameCheck.similarityPercent,
              remitenteReportado
            );
          }
        }
      }

      const insertOrderRes = await client.query<PendingPaymentOrder>(
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
          fecha_transferencia,
          remitente_reportado,
          nombre_remitente_reportado,
          referencia_reportada,
          comprobante_base64,
          comprobante_mime,
          datos_ocr_extraidos,
          estado,
          notas_cliente
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, 'PENDIENTE', $17)
        RETURNING *;
        `,
        [
          clientRow.negocio_id,
          codigoOrden,
          clientRow.id,
          clientRow.nombre_titular,
          clientEmail,
          plataforma,
          plataforma,
          moneda,
          normalizedAmount,
          fechaTransferencia,
          remitenteReportado,
          remitenteReportado,
          referenciaReportada,
          comprobanteBase64,
          comprobanteMime,
          JSON.stringify(ocrResult),
          notasCliente,
        ]
      );

      let orderRow = insertOrderRes.rows[0];
      if (!orderRow) {
        throw new Error('No se pudo crear la orden de pago.');
      }

      // Cotejar directamente la orden contra la base de correos bancarios usando la función PL/pgSQL
      const matchRes = await client.query<{
        conciliado: boolean;
        nuevo_estado: string;
        transaccion_id: string | null;
        referencia_tx: string | null;
        cliente_id: string;
        cliente_nombre: string;
        metodo_match: string;
        score_similitud: number;
        mensaje: string;
      }>(
        'SELECT * FROM fn_conciliar_orden_cliente($1::uuid);',
        [orderRow.id]
      );
      const match = matchRes.rows[0];

      let reconciledTransaction: FinancialTransactionRecord | null = null;
      let instantReconciled = false;
      let nameMatchPercent: number | null = null;

      if (match?.conciliado && match.transaccion_id) {
        instantReconciled = true;
        const txFetch = await client.query<FinancialTransactionRecord>(
          `
          SELECT
            *,
            external_unique_id AS message_id,
            plataforma AS banco,
            remitente_o_contraparte AS remitente_o_destinatario,
            COALESCE(raw_payload->>'raw_body', raw_payload::text) AS raw_body,
            origen_deteccion AS metodo_extraccion,
            orden_conciliada_id AS orden_pago_id,
            nota_auditoria AS notas_conciliacion
          FROM financial_transactions_reconciliation
          WHERE id = $1::uuid;
          `,
          [match.transaccion_id]
        );
        reconciledTransaction = txFetch.rows[0] ?? null;
        if (reconciledTransaction?.remitente_o_contraparte) {
          nameMatchPercent = computeNameMatchScore(
            remitenteReportado,
            reconciledTransaction.remitente_o_contraparte
          ).similarityPercent;
        }

        const refreshedOrder = await client.query<PendingPaymentOrder>(
          'SELECT * FROM ordenes_pago_pendientes WHERE id = $1::uuid;',
          [orderRow.id]
        );
        if (refreshedOrder.rows[0]) {
          orderRow = {
            ...refreshedOrder.rows[0],
            origen_registro: 'PORTAL_CLIENTE',
            has_capture: Boolean(refreshedOrder.rows[0].comprobante_base64),
            tx_fecha_correo: reconciledTransaction?.fecha_transaccion ?? null,
            tx_remitente_correo: reconciledTransaction?.remitente_o_contraparte ?? null,
            tx_referencia_correo: reconciledTransaction?.referencia ?? null,
            tx_monto_bruto: reconciledTransaction?.monto_bruto ?? null,
            tx_porcentaje_comision: reconciledTransaction?.porcentaje_comision ?? null,
            tx_monto_comision: reconciledTransaction?.monto_comision ?? null,
            tx_monto_neto: reconciledTransaction?.monto_neto ?? null,
          };
        }
      } else {
        orderRow = {
          ...orderRow,
          origen_registro: 'PORTAL_CLIENTE',
          has_capture: Boolean(orderRow.comprobante_base64),
        };
      }

      const [aggRes, liqAggRes, pendingRes] = await Promise.all([
        client.query<{
          moneda: string;
          total_bruto: number;
          total_comision: number;
          total_neto: number;
          tx_count: number;
        }>(
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
        client.query<{ moneda: string; total_liquidado: number }>(
          `
          SELECT
            moneda,
            COALESCE(SUM(monto_liquidado), 0)::numeric(12,2) AS total_liquidado
          FROM liquidaciones_clientes
          WHERE cliente_id = $1::uuid
          GROUP BY moneda;
          `,
          [clientRow.id]
        ),
        client.query<{ pending_count: number }>(
          `
          SELECT COUNT(*)::int AS pending_count
          FROM ordenes_pago_pendientes
          WHERE cliente_id = $1::uuid AND estado = 'PENDIENTE';
          `,
          [clientRow.id]
        ),
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

      const saldoDisponibleUsd = Math.max(
        0,
        Math.round((saldoNetoUsd - totalLiquidadoUsd) * 100) / 100
      );
      const saldoDisponibleUsdt = Math.max(
        0,
        Math.round((saldoNetoUsdt - totalLiquidadoUsdt) * 100) / 100
      );

      const wallet: ClientPortalWalletSummary = {
        saldoNetoUsd: saldoDisponibleUsd,
        totalBrutoUsd: Math.round(totalBrutoUsd * 100) / 100,
        totalComisionUsd: Math.round(totalComisionUsd * 100) / 100,
        saldoNetoUsdt: saldoDisponibleUsdt,
        totalBrutoUsdt: Math.round(totalBrutoUsdt * 100) / 100,
        totalComisionUsdt: Math.round(totalComisionUsdt * 100) / 100,
        totalLiquidadoUsd: Math.round(totalLiquidadoUsd * 100) / 100,
        totalLiquidadoUsdt: Math.round(totalLiquidadoUsdt * 100) / 100,
        totalAcreditadoUsd: Math.round(saldoNetoUsd * 100) / 100,
        totalAcreditadoUsdt: Math.round(saldoNetoUsdt * 100) / 100,
        pagosConciliadosCount,
        pagosPendientesCount: pendingRes.rows[0]?.pending_count ?? 0,
      };

      return {
        order: orderRow,
        instantReconciled,
        reconciledTransaction,
        nameMatchPercent,
        wallet,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      ...txOutcome,
    });
  } catch (error: unknown) {
    if (error instanceof NameMismatchError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'NAME_MISMATCH',
          similarityPercent: error.similarityPercent,
          reportedName: error.reportedName,
          error: error.message,
        },
        { status: 422 }
      );
    }
    const msg =
      error instanceof Error
        ? error.message
        : 'Error interno procesando el reporte de pago.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
