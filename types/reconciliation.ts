export type PlatformType =
  | 'CITIBANK'
  | 'TD_BANK'
  | 'BINANCE_PAY'
  | 'BINANCE_P2P'
  | 'BINANCE_ONCHAIN'
  | 'OTRO';

export type ExpectedPlatformType =
  | 'CITIBANK'
  | 'TD_BANK'
  | 'BINANCE_PAY'
  | 'BINANCE_P2P'
  | 'BINANCE_ONCHAIN';

export type BankName = PlatformType;

export type CurrencyType = 'USD' | 'USDT' | 'VES';

export type MovementType = 'RECIBIDO' | 'ENVIADO';

export type DetectionOrigin = 'EMAIL_REGEX' | 'EMAIL_AI' | 'BINANCE_API';

export type ExtractionMethod =
  | 'REGEX'
  | 'AI_FALLBACK'
  | 'EMAIL_REGEX'
  | 'EMAIL_AI'
  | 'BINANCE_API';

export type AlertStatus = 'DETECTADO' | 'CONCILIADO' | 'REVISION_MANUAL';

export type PendingOrderStatus =
  | 'PENDIENTE'
  | 'CONCILIADO'
  | 'LIQUIDADO'
  | 'EXPIRADO'
  | 'CANCELADO';

export type LiquidationPaymentMethod =
  | 'ZELLE'
  | 'BINANCE_USDT'
  | 'PAGO_MOVIL'
  | 'TRANSFERENCIA_BANCARIA'
  | 'EFECTIVO'
  | 'OTRO';

export type BusinessUserRole = 'SUPER_ADMIN' | 'NEGOCIO';

/**
 * Usuario / Cuenta de Negocio con acceso al Panel Administrativo
 */
export interface BusinessUserRecord {
  id: string;
  nombre_negocio: string;
  nombre_usuario: string;
  email: string;
  telefono: string | null;
  rol: BusinessUserRole;
  activo: boolean;
  mailboxes_count?: number;
  clients_count?: number;
  transactions_count?: number;
  last_login_at: string | null;
  created_at: string;
}

/**
 * Resultado opcional de validación visual (OCR / Vision) sobre la captura subida por el cliente
 */
export interface OcrExtractionData {
  monto_detectado?: number | null;
  moneda_detectada?: string | null;
  fecha_detectada?: string | null;
  referencia_detectada?: string | null;
  remitente_detectado?: string | null;
  plataforma_detectada?: string | null;
  coincide_con_reporte?: boolean;
  confianza_ocr?: number;
  observaciones?: string;
}

/**
 * Transacción financiera normalizada proveniente de API de Binance o parser de correos
 */
export interface NormalizedFinancialTx {
  external_unique_id: string;
  dedup_key: string;
  plataforma: PlatformType;
  moneda: CurrencyType;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  porcentaje_comision: number;
  remitente_o_contraparte: string;
  referencia: string;
  fecha_transaccion: string; // ISO 8601
  origen_deteccion: DetectionOrigin;
  raw_payload: Record<string, unknown>;
  confianza?: number;
}

/**
 * Estructura tipada devuelta por el motor de parseo híbrido (Capa 1 Regex + Capa 2 AI Fallback)
 */
export interface ParsedBankTransaction {
  plataforma: PlatformType;
  banco: PlatformType;
  moneda: CurrencyType;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  remitente_o_destinatario: string | null;
  remitente_o_contraparte: string;
  referencia: string | null;
  fecha_transaccion: string; // ISO 8601
  metodo_extraccion: ExtractionMethod;
  origen_deteccion: DetectionOrigin;
  dedup_key: string;
  confianza: number; // 0.0 a 1.0
}

/**
 * Representación unificada de una fila de `financial_transactions_reconciliation`
 * (mantiene alias retrocompatibles con `bank_email_alerts`)
 */
export interface FinancialTransactionRecord {
  id: string;
  external_unique_id: string;
  dedup_key: string;
  plataforma: PlatformType;
  moneda: CurrencyType;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  porcentaje_comision: number;
  monto_comision: number;
  monto_neto: number;
  remitente_o_contraparte: string;
  referencia: string;
  fecha_transaccion: string;
  origen_deteccion: DetectionOrigin;
  raw_payload: Record<string, unknown>;
  estado: AlertStatus;
  cliente_id: string | null;
  cliente_asignado_nombre: string | null;
  orden_conciliada_id: string | null;
  negocio_id?: string | null;
  nota_auditoria: string | null;
  conciliado_at: string | null;
  created_at: string;
  // Datos enriquecidos de la orden vinculada (para visor de capturas en el dashboard)
  has_capture?: boolean;
  capture_order_id?: string | null;
  comprobante_base64?: string | null;
  comprobante_mime?: string | null;
  datos_ocr_extraidos?: OcrExtractionData | null;
  codigo_orden?: string | null;
  // Alias retrocompatibles con la versión anterior
  message_id: string;
  banco: PlatformType;
  remitente_o_destinatario: string | null;
  raw_body: string | null;
  metodo_extraccion: ExtractionMethod;
  orden_pago_id: string | null;
  notas_conciliacion: string | null;
}

export type BankEmailAlertRecord = FinancialTransactionRecord;

/**
 * Representación de una orden de pago pendiente reportada por un cliente (con captura Base64)
 */
export interface PendingPaymentOrder {
  id: string;
  codigo_orden: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_email: string;
  plataforma_esperada: PlatformType;
  banco_destino: PlatformType;
  moneda: CurrencyType;
  monto_esperado: number;
  remitente_reportado: string;
  nombre_remitente_reportado: string;
  referencia_reportada: string | null;
  fecha_transferencia?: string | null;
  has_capture?: boolean;
  comprobante_base64?: string | null;
  comprobante_mime?: string | null;
  datos_ocr_extraidos: OcrExtractionData | null;
  estado: PendingOrderStatus;
  transaccion_conciliada_id: string | null;
  liquidacion_id?: string | null;
  liquidado_at?: string | null;
  negocio_id?: string | null;
  notas_cliente: string | null;
  created_at: string;
  updated_at?: string;
}

/**
 * Cuenta receptora asignada a un cliente (a dónde debe enviar el pago y en qué moneda)
 */
export interface AssignedReceivingAccount {
  id: string;
  mailbox_id?: string | null;
  plataforma: ExpectedPlatformType;
  alias: string;
  cuenta_receptora: string;
  moneda: CurrencyType;
}

/**
 * Cuenta de Cliente / Titular registrada en `clientes_titulares`
 */
export interface ClientAccountRecord {
  id: string;
  nombre_titular: string;
  email: string | null;
  email_contacto: string | null;
  telefono: string | null;
  porcentaje_comision_zelle: number;
  porcentaje_comision_binance: number;
  porcentaje_comision: number;
  remitentes_autorizados: string[];
  remitentes_zelle_habituales: string | null;
  cuentas_asignadas?: AssignedReceivingAccount[];
  negocio_id?: string | null;
  tiene_pin_configurado?: boolean;
  activo: boolean;
  total_bruto_usd: number;
  total_comision_usd: number;
  total_neto_usd: number;
  total_bruto_usdt: number;
  total_comision_usdt: number;
  total_neto_usdt: number;
  total_bruto_conciliado: number;
  total_comision_retenida: number;
  total_neto_disponible: number;
  total_liquidado_usd?: number;
  total_liquidado_usdt?: number;
  saldo_disponible_usd?: number;
  saldo_disponible_usdt?: number;
  liquidaciones_count?: number;
  pagos_conciliados_count: number;
  created_at: string;
}

/**
 * Resumen de billetera del cliente en el Portal de Autogestión (`/portal`)
 */
export interface ClientPortalWalletSummary {
  saldoNetoUsd: number;
  totalBrutoUsd: number;
  totalComisionUsd: number;
  saldoNetoUsdt: number;
  totalBrutoUsdt: number;
  totalComisionUsdt: number;
  totalLiquidadoUsd?: number;
  totalLiquidadoUsdt?: number;
  totalAcreditadoUsd?: number;
  totalAcreditadoUsdt?: number;
  pagosConciliadosCount: number;
  pagosPendientesCount: number;
}

/**
 * Registro de Liquidación / Pago a Cliente o a Tercero (con motivo y cuenta destino)
 */
export interface ClientLiquidationRecord {
  id: string;
  codigo_liquidacion: string;
  negocio_id?: string | null;
  cliente_id: string;
  cliente_nombre: string;
  monto_liquidado: number;
  moneda: CurrencyType;
  destinatario_beneficiario: string;
  motivo_concepto: string;
  metodo_pago_salida: LiquidationPaymentMethod;
  referencia_salida?: string | null;
  comprobante_salida_base64?: string | null;
  saldo_anterior: number;
  saldo_restante: number;
  liquidado_por: string;
  notas_operador?: string | null;
  created_at: string;
}

/**
 * Buzón de correo IMAP monitoreado para recibir alertas de Citibank / TD Bank / Binance
 */
export interface ImapMailboxRecord {
  id: string;
  alias: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  mailbox_folder: string;
  bancos_monitoreados: string;
  plataforma?: ExpectedPlatformType;
  cuenta_receptora?: string;
  moneda?: CurrencyType;
  negocio_id?: string | null;
  activo: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

/**
 * Resultado devuelto por la función PL/pgSQL `fn_auto_conciliar_transaccion`
 */
export interface AutoReconciliationResult {
  conciliado: boolean;
  nuevo_estado: AlertStatus;
  orden_pago_id: string | null;
  codigo_orden: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  metodo_match: string;
  score_similitud: number;
  mensaje: string;
}

/**
 * Métricas agregadas del Panel de Control Financiero Multi-Canal (Zelle USD + Binance USDT)
 */
export interface FinancialSummaryMetrics {
  // Bloque Zelle (Citibank + TD Bank en USD) - Exclusivo de Conciliados
  zelleBrutoRecibidoUsd: number;
  zelleComisionRetenidaUsd: number;
  zelleNetoLiquidableUsd: number;
  zellePorConciliarUsd: number;
  zelleBrutoEnviadoUsd: number;
  // Bloque Binance (Pay + P2P + On-Chain en USDT) - Exclusivo de Conciliados
  binanceRecibidoUsdt: number;
  binanceComisionRetenidaUsdt: number;
  binanceEnviadoUsdt: number;
  binanceNetoDisponibleUsdt: number;
  binancePorConciliarUsdt: number;
  // Totales globales de estado
  totalBrutoRecibido: number;
  totalComisionDescontada: number;
  totalNetoDisponible: number;
  totalBrutoEnviado: number;
  pagosConciliadosCount: number;
  pagosRevisionManualCount: number;
  pagosDetectadosCount: number;
}
