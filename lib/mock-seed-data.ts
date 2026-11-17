import {
  AssignedReceivingAccount,
  BusinessUserRecord,
  ClientAccountRecord,
  ClientPortalWalletSummary,
  FinancialTransactionRecord,
  OcrExtractionData,
  PendingPaymentOrder,
  PlatformType,
} from '@/types/reconciliation';

function toBase64Utf8(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf-8').toString('base64');
  }
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Genera una captura de comprobante bancaria o de Binance en SVG Data URL Base64
 * de alta resolución para previsualización en Demo y pruebas.
 */
export function buildSampleReceiptBase64(params: {
  plataforma: PlatformType;
  monto: string;
  moneda: string;
  remitente: string;
  referencia: string;
  fecha: string;
}): string {
  const isBinance = params.plataforma.startsWith('BINANCE');
  const accent = isBinance ? '#F0B90B' : '#10B981';
  const badge =
    params.plataforma === 'CITIBANK'
      ? 'CITIBANK ZELLE® TRANSFER'
      : params.plataforma === 'TD_BANK'
        ? 'TD BANK ZELLE® RECEIPT'
        : params.plataforma === 'BINANCE_PAY'
          ? 'BINANCE PAY RECEIPT'
          : params.plataforma === 'BINANCE_P2P'
            ? 'BINANCE P2P ORDER'
            : 'BINANCE ON-CHAIN DEPOSIT';

  const safeText = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="720" viewBox="0 0 540 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1220"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
  </defs>
  <rect width="540" height="720" rx="24" fill="url(#bg)" stroke="#1F2937" stroke-width="2"/>
  <rect x="28" y="28" width="484" height="664" rx="18" fill="#0F172A" stroke="#1E293B"/>
  <rect x="145" y="56" width="250" height="32" rx="16" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-opacity="0.5"/>
  <text x="270" y="77" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="${accent}" text-anchor="middle">${safeText(badge)}</text>
  <circle cx="270" cy="146" r="34" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-width="2"/>
  <path d="M254 147 L266 158 L288 134" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="270" y="210" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#E2E8F0" text-anchor="middle">COMPROBANTE VERIFICADO</text>
  <text x="270" y="268" font-family="Courier New, monospace" font-size="40" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${safeText(params.monto)} ${safeText(params.moneda)}</text>
  <line x1="56" y1="305" x2="484" y2="305" stroke="#1E293B" stroke-width="1.5"/>
  <text x="60" y="348" font-family="Arial, sans-serif" font-size="12" fill="#94A3B8">REMITENTE / CONTRAPARTE</text>
  <text x="60" y="374" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#F8FAFC">${safeText(params.remitente)}</text>
  <text x="60" y="426" font-family="Arial, sans-serif" font-size="12" fill="#94A3B8">REFERENCIA / ORDER ID / TXID</text>
  <text x="60" y="454" font-family="Courier New, monospace" font-size="17" font-weight="bold" fill="${accent}">${safeText(params.referencia)}</text>
  <text x="60" y="506" font-family="Arial, sans-serif" font-size="12" fill="#94A3B8">PLATAFORMA DESTINO</text>
  <text x="60" y="532" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#E2E8F0">${safeText(params.plataforma)}</text>
  <text x="60" y="582" font-family="Arial, sans-serif" font-size="12" fill="#94A3B8">FECHA DE OPERACIÓN</text>
  <text x="60" y="608" font-family="Arial, sans-serif" font-size="15" fill="#CBD5E1">${safeText(params.fecha)}</text>
  <rect x="60" y="636" width="420" height="34" rx="8" fill="#1E293B"/>
  <text x="270" y="657" font-family="Courier New, monospace" font-size="11" fill="#94A3B8" text-anchor="middle">STATUS: COMPLETED · FINTECH RECEIPT CAPTURE</text>
</svg>`;

  return `data:image/svg+xml;base64,${toBase64Utf8(svg)}`;
}

const SAMPLE_CITI_RECEIPT = buildSampleReceiptBase64({
  plataforma: 'CITIBANK',
  monto: '$2,500.00',
  moneda: 'USD',
  remitente: 'CARLOS ALBERTO MENDOZA',
  referencia: 'CITI884920194',
  fecha: '2026-11-16 14:15 UTC',
});

const SAMPLE_TD_THIRD_PARTY_RECEIPT = buildSampleReceiptBase64({
  plataforma: 'TD_BANK',
  monto: '$1,850.00',
  moneda: 'USD',
  remitente: 'INVERSIONES DEL CARIBE LLC',
  referencia: 'TDZ90341827',
  fecha: '2026-11-16 15:10 UTC',
});

const SAMPLE_BINANCE_PAY_RECEIPT = buildSampleReceiptBase64({
  plataforma: 'BINANCE_PAY',
  monto: '1,250.00',
  moneda: 'USDT',
  remitente: 'CarlosMendoza_Pay',
  referencia: '293849201192',
  fecha: '2026-11-16 16:30 UTC',
});

const SAMPLE_BINANCE_P2P_RECEIPT = buildSampleReceiptBase64({
  plataforma: 'BINANCE_P2P',
  monto: '850.00',
  moneda: 'USDT',
  remitente: 'CryptoVen_Ex',
  referencia: '206649182736451',
  fecha: '2026-11-16 17:02 UTC',
});

const SAMPLE_CITI_PENDING_RECEIPT = buildSampleReceiptBase64({
  plataforma: 'CITIBANK',
  monto: '$650.00',
  moneda: 'USD',
  remitente: 'JORGE LUIS VILLAMIZAR',
  referencia: 'CITI665091200',
  fecha: '2026-11-16 17:10 UTC',
});

export interface DemoClientInternal extends ClientAccountRecord {
  pin_plain: string;
}

export const DEMO_DEFAULT_ASSIGNED_ACCOUNTS: ReadonlyArray<AssignedReceivingAccount> = [
  {
    id: 'acc-citi-demo-1',
    mailbox_id: null,
    plataforma: 'CITIBANK',
    alias: 'Citibank Zelle Principal',
    cuenta_receptora: 'tesoreria-zelle@importadoraandina.com',
    moneda: 'USD',
  },
  {
    id: 'acc-binance-demo-1',
    mailbox_id: null,
    plataforma: 'BINANCE_PAY',
    alias: 'Binance Pay USDT',
    cuenta_receptora: 'Pay ID: 492817502 (tesoreria@importadoraandina.com)',
    moneda: 'USDT',
  },
];

export const INITIAL_DEMO_CLIENTS: ReadonlyArray<DemoClientInternal> = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    nombre_titular: 'Carlos Alberto Mendoza (Importadora Andina)',
    email: 'carlos@importadoraandina.com',
    email_contacto: 'carlos@importadoraandina.com',
    telefono: '+1 305 555 0142',
    pin_plain: '1234',
    porcentaje_comision_zelle: 4.0,
    porcentaje_comision_binance: 1.5,
    porcentaje_comision: 4.0,
    remitentes_autorizados: [],
    remitentes_zelle_habituales: null,
    cuentas_asignadas: [...DEMO_DEFAULT_ASSIGNED_ACCOUNTS],
    activo: true,
    total_bruto_usd: 2500.0,
    total_comision_usd: 100.0,
    total_neto_usd: 2400.0,
    total_bruto_usdt: 1250.0,
    total_comision_usdt: 18.75,
    total_neto_usdt: 1231.25,
    total_bruto_conciliado: 3750.0,
    total_comision_retenida: 118.75,
    total_neto_disponible: 3631.25,
    pagos_conciliados_count: 2,
    created_at: '2026-11-10T10:00:00.000Z',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000004',
    nombre_titular: 'Roberto Gómez (Comercializadora Gómez)',
    email: 'rgomez@comercializadoragomez.com',
    email_contacto: 'rgomez@comercializadoragomez.com',
    telefono: '+1 786 555 0199',
    pin_plain: '4321',
    porcentaje_comision_zelle: 4.0,
    porcentaje_comision_binance: 1.5,
    porcentaje_comision: 4.0,
    remitentes_autorizados: [],
    remitentes_zelle_habituales: null,
    cuentas_asignadas: [DEMO_DEFAULT_ASSIGNED_ACCOUNTS[0]],
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
    created_at: '2026-11-11T12:00:00.000Z',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000005',
    nombre_titular: 'Grupo Logístico Pacífico (Andrés Duarte)',
    email: 'tesoreria@logisticapacifico.com',
    email_contacto: 'tesoreria@logisticapacifico.com',
    telefono: '+1 954 555 0177',
    pin_plain: '2026',
    porcentaje_comision_zelle: 4.0,
    porcentaje_comision_binance: 1.5,
    porcentaje_comision: 4.0,
    remitentes_autorizados: [],
    remitentes_zelle_habituales: null,
    cuentas_asignadas: [...DEMO_DEFAULT_ASSIGNED_ACCOUNTS],
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
    created_at: '2026-11-12T09:30:00.000Z',
  },
  {
    id: 'c1000000-0000-4000-8000-000000000006',
    nombre_titular: 'Farmacias San Gabriel C.A. (Dra. Valeria Silva)',
    email: 'pagos@farmaciassangabriel.com',
    email_contacto: 'pagos@farmaciassangabriel.com',
    telefono: '+58 412 555 0188',
    pin_plain: '5678',
    porcentaje_comision_zelle: 4.0,
    porcentaje_comision_binance: 1.5,
    porcentaje_comision: 4.0,
    remitentes_autorizados: [],
    remitentes_zelle_habituales: null,
    cuentas_asignadas: [DEMO_DEFAULT_ASSIGNED_ACCOUNTS[0]],
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
    created_at: '2026-11-13T11:15:00.000Z',
  },
];

export const INITIAL_DEMO_ALERTS: ReadonlyArray<FinancialTransactionRecord> = [
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334401',
    external_unique_id: '<citi-alert-20261116-998812@alerts.citibank.com>',
    dedup_key: 'CITIBANK:CITI884920194:2500.00',
    plataforma: 'CITIBANK',
    moneda: 'USD',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 2500.0,
    porcentaje_comision: 4.0,
    monto_comision: 100.0,
    monto_neto: 2400.0,
    remitente_o_contraparte: 'CARLOS ALBERTO MENDOZA',
    referencia: 'CITI884920194',
    fecha_transaccion: '2026-11-16T14:15:00.000Z',
    origen_deteccion: 'EMAIL_REGEX',
    raw_payload: {
      raw_body:
        'Citibank® Alert: You received a Zelle® payment of $2,500.00 from CARLOS ALBERTO MENDOZA. Confirmation Number: CITI884920194. The money has been deposited into your Citibank account.',
    },
    estado: 'CONCILIADO',
    cliente_id: 'c1000000-0000-4000-8000-000000000001',
    cliente_asignado_nombre: 'Carlos Alberto Mendoza (Importadora Andina)',
    orden_conciliada_id: 'f901a001-5521-4111-8899-001122334401',
    nota_auditoria:
      'Conciliación automática exacta por CITIBANK (2500.00 USD) y referencia (CITI884920194) con orden ORD-2026-8801.',
    conciliado_at: '2026-11-16T14:15:05.000Z',
    created_at: '2026-11-16T14:15:04.000Z',
    comprobante_base64: SAMPLE_CITI_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    codigo_orden: 'ORD-2026-8801',
    datos_ocr_extraidos: {
      monto_detectado: 2500,
      moneda_detectada: 'USD',
      referencia_detectada: 'CITI884920194',
      remitente_detectado: 'CARLOS ALBERTO MENDOZA',
      plataforma_detectada: 'CITIBANK',
      coincide_con_reporte: true,
      confianza_ocr: 0.99,
      observaciones: 'Captura coincidente con alerta de Citibank.',
    },
    message_id: '<citi-alert-20261116-998812@alerts.citibank.com>',
    banco: 'CITIBANK',
    remitente_o_destinatario: 'CARLOS ALBERTO MENDOZA',
    raw_body:
      'Citibank® Alert: You received a Zelle® payment of $2,500.00 from CARLOS ALBERTO MENDOZA. Confirmation Number: CITI884920194. The money has been deposited into your Citibank account.',
    metodo_extraccion: 'REGEX',
    orden_pago_id: 'f901a001-5521-4111-8899-001122334401',
    notas_conciliacion:
      'Conciliación automática exacta por CITIBANK (2500.00 USD) y referencia (CITI884920194) con orden ORD-2026-8801.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334407',
    external_unique_id: 'BINANCE_PAY:293849201192',
    dedup_key: 'BINANCE_PAY:293849201192:1250.00',
    plataforma: 'BINANCE_PAY',
    moneda: 'USDT',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 1250.0,
    porcentaje_comision: 1.5,
    monto_comision: 18.75,
    monto_neto: 1231.25,
    remitente_o_contraparte: 'CarlosMendoza_Pay',
    referencia: '293849201192',
    fecha_transaccion: '2026-11-16T16:32:00.000Z',
    origen_deteccion: 'BINANCE_API',
    raw_payload: {
      source: 'binance_pay_api',
      transactionId: '293849201192',
      currency: 'USDT',
      amount: '1250.00',
      payerInfo: { name: 'CarlosMendoza_Pay', binanceId: '882910442' },
    },
    estado: 'CONCILIADO',
    cliente_id: 'c1000000-0000-4000-8000-000000000001',
    cliente_asignado_nombre: 'Carlos Alberto Mendoza (Importadora Andina)',
    orden_conciliada_id: 'f901a001-5521-4111-8899-001122334407',
    nota_auditoria:
      'Conciliación automática vía Binance Pay API (1250.00 USDT) con orden ORD-2026-8810. Comisión 1.50%.',
    conciliado_at: '2026-11-16T16:32:04.000Z',
    created_at: '2026-11-16T16:32:03.000Z',
    comprobante_base64: SAMPLE_BINANCE_PAY_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    codigo_orden: 'ORD-2026-8810',
    datos_ocr_extraidos: {
      monto_detectado: 1250,
      moneda_detectada: 'USDT',
      referencia_detectada: '293849201192',
      remitente_detectado: 'CarlosMendoza_Pay',
      plataforma_detectada: 'BINANCE_PAY',
      coincide_con_reporte: true,
      confianza_ocr: 0.98,
      observaciones: 'Idempotencia API + Portal verificada.',
    },
    message_id: 'BINANCE_PAY:293849201192',
    banco: 'BINANCE_PAY',
    remitente_o_destinatario: 'CarlosMendoza_Pay',
    raw_body:
      'Binance Pay API Response: Received 1,250.00 USDT from CarlosMendoza_Pay (Binance ID 882910442). Transaction ID: 293849201192.',
    metodo_extraccion: 'BINANCE_API',
    orden_pago_id: 'f901a001-5521-4111-8899-001122334407',
    notas_conciliacion:
      'Conciliación automática vía Binance Pay API (1250.00 USDT) con orden ORD-2026-8810. Comisión 1.50%.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334402',
    external_unique_id: '<td-zelle-20261116-773190@tdbank.com>',
    dedup_key: 'TD_BANK:TDZ90341827:1850.00',
    plataforma: 'TD_BANK',
    moneda: 'USD',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 1850.0,
    porcentaje_comision: 4.0,
    monto_comision: 74.0,
    monto_neto: 1776.0,
    remitente_o_contraparte: 'INVERSIONES DEL CARIBE LLC',
    referencia: 'TDZ90341827',
    fecha_transaccion: '2026-11-16T15:40:00.000Z',
    origen_deteccion: 'EMAIL_REGEX',
    raw_payload: {
      raw_body:
        'TD Bank Online Banking: Zelle® payment from INVERSIONES DEL CARIBE LLC has been deposited into your account. Amount: $1,850.00. Confirmation Code: TDZ90341827.',
    },
    estado: 'REVISION_MANUAL',
    cliente_id: null,
    cliente_asignado_nombre: null,
    orden_conciliada_id: null,
    nota_auditoria:
      'Posible pago de tercero o referencia mal escrita: monto exacto ($1850.00) en TD_BANK coincide con orden ORD-2026-8804 ("Roberto Gómez"), pero el remitente ("INVERSIONES DEL CARIBE LLC") difiere del titular.',
    conciliado_at: null,
    created_at: '2026-11-16T15:40:12.000Z',
    comprobante_base64: SAMPLE_TD_THIRD_PARTY_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    codigo_orden: 'ORD-2026-8804',
    message_id: '<td-zelle-20261116-773190@tdbank.com>',
    banco: 'TD_BANK',
    remitente_o_destinatario: 'INVERSIONES DEL CARIBE LLC',
    raw_body:
      'TD Bank Online Banking: Zelle® payment from INVERSIONES DEL CARIBE LLC has been deposited into your account. Amount: $1,850.00. Confirmation Code: TDZ90341827.',
    metodo_extraccion: 'REGEX',
    orden_pago_id: null,
    notas_conciliacion:
      'Posible pago de tercero o referencia mal escrita: monto exacto ($1850.00) en TD_BANK coincide con orden ORD-2026-8804 ("Roberto Gómez"), pero el remitente ("INVERSIONES DEL CARIBE LLC") difiere del titular.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334408',
    external_unique_id: 'BINANCE_P2P:206649182736451',
    dedup_key: 'BINANCE_P2P:206649182736451:850.00',
    plataforma: 'BINANCE_P2P',
    moneda: 'USDT',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 850.0,
    porcentaje_comision: 1.5,
    monto_comision: 12.75,
    monto_neto: 837.25,
    remitente_o_contraparte: 'CryptoVen_Ex',
    referencia: '206649182736451',
    fecha_transaccion: '2026-11-16T17:04:00.000Z',
    origen_deteccion: 'BINANCE_API',
    raw_payload: {
      source: 'binance_p2p_api',
      orderNumber: '206649182736451',
      tradeType: 'BUY',
      asset: 'USDT',
      amount: '850.00',
      orderStatus: 'COMPLETED',
      counterPartNickName: 'CryptoVen_Ex',
    },
    estado: 'REVISION_MANUAL',
    cliente_id: null,
    cliente_asignado_nombre: null,
    orden_conciliada_id: null,
    nota_auditoria:
      'Orden P2P completada (850.00 USDT) con contraparte "CryptoVen_Ex". Coincide con orden ORD-2026-8811 por monto; revisar captura de respaldo.',
    conciliado_at: null,
    created_at: '2026-11-16T17:04:10.000Z',
    comprobante_base64: SAMPLE_BINANCE_P2P_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    codigo_orden: 'ORD-2026-8811',
    message_id: 'BINANCE_P2P:206649182736451',
    banco: 'BINANCE_P2P',
    remitente_o_destinatario: 'CryptoVen_Ex',
    raw_body:
      'Binance P2P API: Order 206649182736451 COMPLETED. Bought 850.00 USDT from counterparty CryptoVen_Ex.',
    metodo_extraccion: 'BINANCE_API',
    orden_pago_id: null,
    notas_conciliacion:
      'Orden P2P completada (850.00 USDT) con contraparte "CryptoVen_Ex". Coincide con orden ORD-2026-8811 por monto; revisar captura de respaldo.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334403',
    external_unique_id: '<citi-es-20261116-554102@citibank.com>',
    dedup_key: 'CITIBANK:CITI441098231:920.50',
    plataforma: 'CITIBANK',
    moneda: 'USD',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 920.5,
    porcentaje_comision: 4.0,
    monto_comision: 36.82,
    monto_neto: 883.68,
    remitente_o_contraparte: 'MARIA FERNANDA SALAZAR',
    referencia: 'CITI441098231',
    fecha_transaccion: '2026-11-16T16:05:00.000Z',
    origen_deteccion: 'EMAIL_REGEX',
    raw_payload: {
      raw_body:
        'Alerta de Citibank: Has recibido un pago con Zelle® de MARIA FERNANDA SALAZAR por $920.50 en tu cuenta. Número de confirmación: CITI441098231.',
    },
    estado: 'CONCILIADO',
    cliente_id: null,
    cliente_asignado_nombre: 'María Fernanda Salazar',
    orden_conciliada_id: 'f901a001-5521-4111-8899-001122334402',
    nota_auditoria:
      'Conciliación automática por monto ($920.50) y similitud de remitente (96.4% pg_trgm) con orden ORD-2026-8802.',
    conciliado_at: '2026-11-16T16:05:08.000Z',
    created_at: '2026-11-16T16:05:07.000Z',
    message_id: '<citi-es-20261116-554102@citibank.com>',
    banco: 'CITIBANK',
    remitente_o_destinatario: 'MARIA FERNANDA SALAZAR',
    raw_body:
      'Alerta de Citibank: Has recibido un pago con Zelle® de MARIA FERNANDA SALAZAR por $920.50 en tu cuenta. Número de confirmación: CITI441098231.',
    metodo_extraccion: 'REGEX',
    orden_pago_id: 'f901a001-5521-4111-8899-001122334402',
    notas_conciliacion:
      'Conciliación automática por monto ($920.50) y similitud de remitente (96.4% pg_trgm) con orden ORD-2026-8802.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334409',
    external_unique_id: 'BINANCE_ONCHAIN:TX88492011A9F82C1',
    dedup_key: 'BINANCE_ONCHAIN:TX88492011A9F82C1:500.00',
    plataforma: 'BINANCE_ONCHAIN',
    moneda: 'USDT',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 500.0,
    porcentaje_comision: 1.5,
    monto_comision: 7.5,
    monto_neto: 492.5,
    remitente_o_contraparte: 'On-Chain USDT (TRX-TRC20) · TY8xKp...92Lm',
    referencia: 'TX88492011A9F82C1',
    fecha_transaccion: '2026-11-16T17:15:00.000Z',
    origen_deteccion: 'BINANCE_API',
    raw_payload: {
      source: 'binance_deposit_hisrec',
      coin: 'USDT',
      network: 'TRX',
      amount: '500.00',
      txId: 'TX88492011A9F82C1',
      status: 1,
    },
    estado: 'DETECTADO',
    cliente_id: null,
    cliente_asignado_nombre: null,
    orden_conciliada_id: null,
    nota_auditoria:
      'Depósito On-Chain confirmado en red TRC20 esperando reporte y captura del cliente en /portal.',
    conciliado_at: null,
    created_at: '2026-11-16T17:15:05.000Z',
    message_id: 'BINANCE_ONCHAIN:TX88492011A9F82C1',
    banco: 'BINANCE_ONCHAIN',
    remitente_o_destinatario: 'On-Chain USDT (TRX-TRC20) · TY8xKp...92Lm',
    raw_body:
      'Binance Deposit Confirmed: 500.00 USDT via TRC20 network. TxID: TX88492011A9F82C1.',
    metodo_extraccion: 'BINANCE_API',
    orden_pago_id: null,
    notas_conciliacion:
      'Depósito On-Chain confirmado en red TRC20 esperando reporte y captura del cliente en /portal.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334405',
    external_unique_id: '<citi-detect-20261116-119084@alerts.citibank.com>',
    dedup_key: 'CITIBANK:CITI665091200:650.00',
    plataforma: 'CITIBANK',
    moneda: 'USD',
    tipo_movimiento: 'RECIBIDO',
    monto_bruto: 650.0,
    porcentaje_comision: 4.0,
    monto_comision: 26.0,
    monto_neto: 624.0,
    remitente_o_contraparte: 'JORGE LUIS VILLAMIZAR',
    referencia: 'CITI665091200',
    fecha_transaccion: '2026-11-16T17:12:00.000Z',
    origen_deteccion: 'EMAIL_REGEX',
    raw_payload: {
      raw_body:
        'Citibank®: JORGE LUIS VILLAMIZAR sent you $650.00 with Zelle®. Confirmation Number: CITI665091200.',
    },
    estado: 'DETECTADO',
    cliente_id: null,
    cliente_asignado_nombre: null,
    orden_conciliada_id: null,
    nota_auditoria:
      'Alerta detectada en espera de reporte de pago del cliente o asignación manual.',
    conciliado_at: null,
    created_at: '2026-11-16T17:12:03.000Z',
    message_id: '<citi-detect-20261116-119084@alerts.citibank.com>',
    banco: 'CITIBANK',
    remitente_o_destinatario: 'JORGE LUIS VILLAMIZAR',
    raw_body:
      'Citibank®: JORGE LUIS VILLAMIZAR sent you $650.00 with Zelle®. Confirmation Number: CITI665091200.',
    metodo_extraccion: 'REGEX',
    orden_pago_id: null,
    notas_conciliacion:
      'Alerta detectada en espera de reporte de pago del cliente o asignación manual.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334406',
    external_unique_id: '<td-out-20261116-880123@tdbank.com>',
    dedup_key: 'TD_BANK:TDOUT5519201:1200.00',
    plataforma: 'TD_BANK',
    moneda: 'USD',
    tipo_movimiento: 'ENVIADO',
    monto_bruto: 1200.0,
    porcentaje_comision: 0.0,
    monto_comision: 0.0,
    monto_neto: 1200.0,
    remitente_o_contraparte: 'PROVEEDORA TECH MIAMI INC',
    referencia: 'TDOUT5519201',
    fecha_transaccion: '2026-11-16T17:30:00.000Z',
    origen_deteccion: 'EMAIL_REGEX',
    raw_payload: {
      raw_body:
        'TD Bank Alert: You sent a Zelle® payment of $1,200.00 to PROVEEDORA TECH MIAMI INC. Confirmation Number: TDOUT5519201.',
    },
    estado: 'CONCILIADO',
    cliente_id: null,
    cliente_asignado_nombre: 'Liquidación a Proveedor (Tesorería)',
    orden_conciliada_id: null,
    nota_auditoria: 'Dispersión saliente verificada por tesorería.',
    conciliado_at: '2026-11-16T17:30:10.000Z',
    created_at: '2026-11-16T17:30:09.000Z',
    message_id: '<td-out-20261116-880123@tdbank.com>',
    banco: 'TD_BANK',
    remitente_o_destinatario: 'PROVEEDORA TECH MIAMI INC',
    raw_body:
      'TD Bank Alert: You sent a Zelle® payment of $1,200.00 to PROVEEDORA TECH MIAMI INC. Confirmation Number: TDOUT5519201.',
    metodo_extraccion: 'REGEX',
    orden_pago_id: null,
    notas_conciliacion: 'Dispersión saliente verificada por tesorería.',
  },
  {
    id: 'a101d9e0-8421-4c9a-9f11-110022334410',
    external_unique_id: 'BINANCE_PAY:293849299910',
    dedup_key: 'BINANCE_PAY:293849299910:420.00',
    plataforma: 'BINANCE_PAY',
    moneda: 'USDT',
    tipo_movimiento: 'ENVIADO',
    monto_bruto: 420.0,
    porcentaje_comision: 0.0,
    monto_comision: 0.0,
    monto_neto: 420.0,
    remitente_o_contraparte: 'LiquidezMesa_OTC',
    referencia: '293849299910',
    fecha_transaccion: '2026-11-16T17:45:00.000Z',
    origen_deteccion: 'BINANCE_API',
    raw_payload: {
      source: 'binance_pay_api',
      transactionId: '293849299910',
      currency: 'USDT',
      amount: '-420.00',
      receiverInfo: { name: 'LiquidezMesa_OTC' },
    },
    estado: 'CONCILIADO',
    cliente_id: null,
    cliente_asignado_nombre: 'Dispersión OTC Tesorería',
    orden_conciliada_id: null,
    nota_auditoria: 'Envío de USDT saliente confirmado vía Binance Pay API.',
    conciliado_at: '2026-11-16T17:45:05.000Z',
    created_at: '2026-11-16T17:45:04.000Z',
    message_id: 'BINANCE_PAY:293849299910',
    banco: 'BINANCE_PAY',
    remitente_o_destinatario: 'LiquidezMesa_OTC',
    raw_body:
      'Binance Pay API: Sent 420.00 USDT to LiquidezMesa_OTC. Ref: 293849299910.',
    metodo_extraccion: 'BINANCE_API',
    orden_pago_id: null,
    notas_conciliacion: 'Envío de USDT saliente confirmado vía Binance Pay API.',
  },
];

export const INITIAL_DEMO_PENDING_ORDERS: ReadonlyArray<PendingPaymentOrder> = [
  {
    id: 'f901a001-5521-4111-8899-001122334401',
    codigo_orden: 'ORD-2026-8801',
    cliente_id: 'c1000000-0000-4000-8000-000000000001',
    cliente_nombre: 'Carlos Alberto Mendoza (Importadora Andina)',
    cliente_email: 'carlos@importadoraandina.com',
    plataforma_esperada: 'CITIBANK',
    banco_destino: 'CITIBANK',
    moneda: 'USD',
    monto_esperado: 2500.0,
    remitente_reportado: 'Carlos Alberto Mendoza',
    nombre_remitente_reportado: 'Carlos Alberto Mendoza',
    referencia_reportada: 'CITI884920194',
    comprobante_base64: SAMPLE_CITI_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    datos_ocr_extraidos: {
      monto_detectado: 2500,
      moneda_detectada: 'USD',
      referencia_detectada: 'CITI884920194',
      remitente_detectado: 'CARLOS ALBERTO MENDOZA',
      plataforma_detectada: 'CITIBANK',
      coincide_con_reporte: true,
      confianza_ocr: 0.99,
    },
    estado: 'CONCILIADO',
    transaccion_conciliada_id: 'a101d9e0-8421-4c9a-9f11-110022334401',
    notas_cliente: 'Pago de factura #1042 desde cuenta Citibank principal.',
    created_at: '2026-11-16T14:10:00.000Z',
  },
  {
    id: 'f901a001-5521-4111-8899-001122334407',
    codigo_orden: 'ORD-2026-8810',
    cliente_id: 'c1000000-0000-4000-8000-000000000001',
    cliente_nombre: 'Carlos Alberto Mendoza (Importadora Andina)',
    cliente_email: 'carlos@importadoraandina.com',
    plataforma_esperada: 'BINANCE_PAY',
    banco_destino: 'BINANCE_PAY',
    moneda: 'USDT',
    monto_esperado: 1250.0,
    remitente_reportado: 'CarlosMendoza_Pay',
    nombre_remitente_reportado: 'CarlosMendoza_Pay',
    referencia_reportada: '293849201192',
    comprobante_base64: SAMPLE_BINANCE_PAY_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    datos_ocr_extraidos: {
      monto_detectado: 1250,
      moneda_detectada: 'USDT',
      referencia_detectada: '293849201192',
      remitente_detectado: 'CarlosMendoza_Pay',
      plataforma_detectada: 'BINANCE_PAY',
      coincide_con_reporte: true,
      confianza_ocr: 0.98,
    },
    estado: 'CONCILIADO',
    transaccion_conciliada_id: 'a101d9e0-8421-4c9a-9f11-110022334407',
    notas_cliente: 'Envío vía Binance Pay inmediato.',
    created_at: '2026-11-16T16:29:00.000Z',
  },
  {
    id: 'f901a001-5521-4111-8899-001122334404',
    codigo_orden: 'ORD-2026-8804',
    cliente_id: 'c1000000-0000-4000-8000-000000000004',
    cliente_nombre: 'Roberto Gómez (Comercializadora Gómez)',
    cliente_email: 'rgomez@comercializadoragomez.com',
    plataforma_esperada: 'TD_BANK',
    banco_destino: 'TD_BANK',
    moneda: 'USD',
    monto_esperado: 1850.0,
    remitente_reportado: 'Roberto Gómez',
    nombre_remitente_reportado: 'Roberto Gómez',
    referencia_reportada: 'TDZ90341827',
    comprobante_base64: SAMPLE_TD_THIRD_PARTY_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    datos_ocr_extraidos: {
      monto_detectado: 1850,
      moneda_detectada: 'USD',
      referencia_detectada: 'TDZ90341827',
      remitente_detectado: 'INVERSIONES DEL CARIBE LLC',
      plataforma_detectada: 'TD_BANK',
      coincide_con_reporte: false,
      confianza_ocr: 0.91,
      observaciones:
        'El comprobante muestra remitente INVERSIONES DEL CARIBE LLC distinto a Roberto Gómez.',
    },
    estado: 'PENDIENTE',
    transaccion_conciliada_id: null,
    notas_cliente: 'Pago enviado desde cuenta empresarial asociada.',
    created_at: '2026-11-16T15:10:00.000Z',
  },
  {
    id: 'f901a001-5521-4111-8899-001122334408',
    codigo_orden: 'ORD-2026-8811',
    cliente_id: 'c1000000-0000-4000-8000-000000000005',
    cliente_nombre: 'Grupo Logístico Pacífico (Andrés Duarte)',
    cliente_email: 'tesoreria@logisticapacifico.com',
    plataforma_esperada: 'BINANCE_P2P',
    banco_destino: 'BINANCE_P2P',
    moneda: 'USDT',
    monto_esperado: 850.0,
    remitente_reportado: 'GrupoPacifico_USDT',
    nombre_remitente_reportado: 'GrupoPacifico_USDT',
    referencia_reportada: '206649182736451',
    comprobante_base64: SAMPLE_BINANCE_P2P_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    datos_ocr_extraidos: {
      monto_detectado: 850,
      moneda_detectada: 'USDT',
      referencia_detectada: '206649182736451',
      remitente_detectado: 'CryptoVen_Ex',
      plataforma_detectada: 'BINANCE_P2P',
      coincide_con_reporte: false,
      confianza_ocr: 0.89,
    },
    estado: 'PENDIENTE',
    transaccion_conciliada_id: null,
    notas_cliente: 'Compra P2P liberada por operador externo.',
    created_at: '2026-11-16T17:02:00.000Z',
  },
  {
    id: 'f901a001-5521-4111-8899-001122334406',
    codigo_orden: 'ORD-2026-8806',
    cliente_id: 'c1000000-0000-4000-8000-000000000006',
    cliente_nombre: 'Farmacias San Gabriel C.A. (Dra. Valeria Silva)',
    cliente_email: 'pagos@farmaciassangabriel.com',
    plataforma_esperada: 'CITIBANK',
    banco_destino: 'CITIBANK',
    moneda: 'USD',
    monto_esperado: 650.0,
    remitente_reportado: 'Jorge Luis Villamizar',
    nombre_remitente_reportado: 'Jorge Luis Villamizar',
    referencia_reportada: 'CITI665091200',
    comprobante_base64: SAMPLE_CITI_PENDING_RECEIPT,
    comprobante_mime: 'image/svg+xml',
    datos_ocr_extraidos: null,
    estado: 'PENDIENTE',
    transaccion_conciliada_id: null,
    notas_cliente: 'Zelle de administrador de sucursal.',
    created_at: '2026-11-16T17:10:00.000Z',
  },
];

// =============================================================================
// ESTADO EN MEMORIA PARA MODO `DEMO_FALLBACK` (SIN POSTGRESQL LOCAL)
// =============================================================================

export interface DemoBusinessUserInternal extends BusinessUserRecord {
  password_plain: string;
}

export const DEFAULT_DEMO_BUSINESS_ID = 'b0000000-0000-4000-8000-000000000001';

export const INITIAL_DEMO_BUSINESS_USERS: ReadonlyArray<DemoBusinessUserInternal> =
  [
    {
      id: DEFAULT_DEMO_BUSINESS_ID,
      nombre_negocio: 'Operadora Principal',
      nombre_usuario: 'Administrador Principal',
      email: 'admin@conciliacion.com',
      telefono: '+1 305 555 0100',
      rol: 'SUPER_ADMIN',
      password_plain: 'admin1234',
      activo: true,
      last_login_at: new Date().toISOString(),
      created_at: '2026-10-19T00:00:00.000Z',
    },
  ];

export interface DemoInMemoryStore {
  businessUsers: DemoBusinessUserInternal[];
  clients: DemoClientInternal[];
  transactions: FinancialTransactionRecord[];
  orders: PendingPaymentOrder[];
}

declare global {
  // eslint-disable-next-line no-var
  var __fintechDemoStore: DemoInMemoryStore | undefined;
}

export function getDemoStore(): DemoInMemoryStore {
  if (!globalThis.__fintechDemoStore) {
    globalThis.__fintechDemoStore = {
      businessUsers: INITIAL_DEMO_BUSINESS_USERS.map((u) => ({ ...u })),
      clients: INITIAL_DEMO_CLIENTS.map((c) => ({
        ...c,
        negocio_id: c.negocio_id ?? DEFAULT_DEMO_BUSINESS_ID,
        remitentes_autorizados: [...c.remitentes_autorizados],
        cuentas_asignadas: (c.cuentas_asignadas ?? []).map((acc) => ({ ...acc })),
      })),
      transactions: INITIAL_DEMO_ALERTS.map((t) => ({
        ...t,
        negocio_id: t.negocio_id ?? DEFAULT_DEMO_BUSINESS_ID,
      })),
      orders: INITIAL_DEMO_PENDING_ORDERS.map((o) => ({
        ...o,
        negocio_id: o.negocio_id ?? DEFAULT_DEMO_BUSINESS_ID,
      })),
    };
  }
  return globalThis.__fintechDemoStore;
}

export function computeClientWalletSummary(
  clientId: string,
  transactions: ReadonlyArray<FinancialTransactionRecord>,
  orders: ReadonlyArray<PendingPaymentOrder>
): ClientPortalWalletSummary {
  let totalBrutoUsd = 0;
  let totalComisionUsd = 0;
  let saldoNetoUsd = 0;
  let totalBrutoUsdt = 0;
  let totalComisionUsdt = 0;
  let saldoNetoUsdt = 0;
  let pagosConciliadosCount = 0;

  for (const tx of transactions) {
    if (
      tx.cliente_id === clientId &&
      tx.estado === 'CONCILIADO' &&
      tx.tipo_movimiento === 'RECIBIDO'
    ) {
      pagosConciliadosCount += 1;
      if (tx.moneda === 'USDT') {
        totalBrutoUsdt += tx.monto_bruto;
        totalComisionUsdt += tx.monto_comision;
        saldoNetoUsdt += tx.monto_neto;
      } else {
        totalBrutoUsd += tx.monto_bruto;
        totalComisionUsd += tx.monto_comision;
        saldoNetoUsd += tx.monto_neto;
      }
    }
  }

  const pagosPendientesCount = orders.filter(
    (o) => o.cliente_id === clientId && o.estado === 'PENDIENTE'
  ).length;

  return {
    saldoNetoUsd: Math.round(saldoNetoUsd * 100) / 100,
    totalBrutoUsd: Math.round(totalBrutoUsd * 100) / 100,
    totalComisionUsd: Math.round(totalComisionUsd * 100) / 100,
    saldoNetoUsdt: Math.round(saldoNetoUsdt * 100) / 100,
    totalBrutoUsdt: Math.round(totalBrutoUsdt * 100) / 100,
    totalComisionUsdt: Math.round(totalComisionUsdt * 100) / 100,
    pagosConciliadosCount,
    pagosPendientesCount,
  };
}

export function getDemoClientsWithTotals(): ClientAccountRecord[] {
  const store = getDemoStore();
  return store.clients.map((client) => {
    const wallet = computeClientWalletSummary(
      client.id,
      store.transactions,
      store.orders
    );
    return {
      ...client,
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
    };
  });
}

function normalizeAlphaNum(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Simula `fn_auto_conciliar_transaccion` en memoria cuando PostgreSQL no está disponible (`DEMO_FALLBACK`).
 */
export function runDemoAutoReconcileForOrder(orderId: string): {
  reconciled: boolean;
  transaction: FinancialTransactionRecord | null;
} {
  const store = getDemoStore();
  const order = store.orders.find((o) => o.id === orderId);
  if (!order || order.estado !== 'PENDIENTE') {
    return { reconciled: false, transaction: null };
  }

  const orderRef = normalizeAlphaNum(order.referencia_reportada);
  const orderSender = order.remitente_reportado.trim().toLowerCase();

  // Paso 1: Match exacto por moneda + monto + referencia (o últimos 6 dígitos)
  let matchedTx = store.transactions.find((tx) => {
    if (tx.estado === 'CONCILIADO' || tx.tipo_movimiento !== 'RECIBIDO') {
      return false;
    }
    if (
      tx.moneda !== order.moneda ||
      Math.abs(tx.monto_bruto - order.monto_esperado) >= 0.01
    ) {
      return false;
    }
    const txRef = normalizeAlphaNum(tx.referencia);
    if (orderRef.length < 4 || txRef.length < 4) {
      return false;
    }
    return (
      txRef === orderRef ||
      (txRef.length >= 6 &&
        orderRef.length >= 6 &&
        txRef.slice(-6) === orderRef.slice(-6))
    );
  });

  // Paso 2: Match por plataforma + monto + remitente similar
  if (!matchedTx) {
    matchedTx = store.transactions.find((tx) => {
      if (tx.estado === 'CONCILIADO' || tx.tipo_movimiento !== 'RECIBIDO') {
        return false;
      }
      if (
        tx.plataforma !== order.plataforma_esperada ||
        tx.moneda !== order.moneda ||
        Math.abs(tx.monto_bruto - order.monto_esperado) >= 0.01
      ) {
        return false;
      }
      const txSender = tx.remitente_o_contraparte.trim().toLowerCase();
      return (
        txSender === orderSender ||
        txSender.includes(orderSender) ||
        orderSender.includes(txSender)
      );
    });
  }

  if (!matchedTx) {
    return { reconciled: false, transaction: null };
  }

  const client = store.clients.find((c) => c.id === order.cliente_id);
  const feePct = matchedTx.plataforma.startsWith('BINANCE')
    ? client?.porcentaje_comision_binance ?? 1.5
    : client?.porcentaje_comision_zelle ?? 4.0;
  const feeAmount =
    Math.round(matchedTx.monto_bruto * (feePct / 100) * 100) / 100;
  const netAmount = Math.round((matchedTx.monto_bruto - feeAmount) * 100) / 100;
  const nowIso = new Date().toISOString();

  order.estado = 'CONCILIADO';
  order.transaccion_conciliada_id = matchedTx.id;
  order.updated_at = nowIso;

  matchedTx.estado = 'CONCILIADO';
  matchedTx.porcentaje_comision = feePct;
  matchedTx.monto_comision = feeAmount;
  matchedTx.monto_neto = netAmount;
  matchedTx.cliente_id = order.cliente_id;
  matchedTx.cliente_asignado_nombre = order.cliente_nombre;
  matchedTx.orden_conciliada_id = order.id;
  matchedTx.orden_pago_id = order.id;
  matchedTx.codigo_orden = order.codigo_orden;
  matchedTx.comprobante_base64 = order.comprobante_base64;
  matchedTx.comprobante_mime = order.comprobante_mime;
  matchedTx.datos_ocr_extraidos = order.datos_ocr_extraidos;
  matchedTx.conciliado_at = nowIso;
  matchedTx.nota_auditoria = `Conciliación instantánea (${matchedTx.plataforma}) con orden ${order.codigo_orden} reportada en el Portal de Clientes.`;
  matchedTx.notas_conciliacion = matchedTx.nota_auditoria;

  return { reconciled: true, transaction: matchedTx };
}

export function buildDemoOcrFallback(params: {
  plataforma: PlatformType;
  moneda: string;
  monto: number;
  referencia: string;
  remitente: string;
}): OcrExtractionData {
  return {
    monto_detectado: params.monto,
    moneda_detectada: params.moneda,
    referencia_detectada: params.referencia,
    remitente_detectado: params.remitente,
    plataforma_detectada: params.plataforma,
    coincide_con_reporte: true,
    confianza_ocr: 0.85,
    observaciones:
      'Captura recibida y verificada en modo DEMO_FALLBACK.',
  };
}
