export type BankName = 'CITIBANK' | 'TD_BANK' | 'OTRO';

export type MovementType = 'RECIBIDO' | 'ENVIADO';

export type ExtractionMethod = 'REGEX' | 'AI_FALLBACK';

export type AlertStatus = 'DETECTADO' | 'CONCILIADO' | 'REVISION_MANUAL';

export type PendingOrderStatus = 'PENDIENTE' | 'CONCILIADO' | 'EXPIRADO' | 'CANCELADO';

/**
 * Estructura tipada devuelta por el motor de parseo híbrido (Regex + AI Fallback)
 */
export interface ParsedBankTransaction {
  banco: BankName;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  remitente_o_destinatario: string | null;
  referencia: string | null;
  fecha_transaccion: string; // ISO 8601
  metodo_extraccion: ExtractionMethod;
  confianza: number; // 0.0 a 1.0
}

/**
 * Representación de una fila de `bank_email_alerts` en PostgreSQL / API
 */
export interface BankEmailAlertRecord {
  id: string;
  message_id: string;
  banco: BankName;
  tipo_movimiento: MovementType;
  monto_bruto: number;
  porcentaje_comision: number;
  monto_comision: number;
  monto_neto: number;
  remitente_o_destinatario: string | null;
  referencia: string | null;
  fecha_transaccion: string;
  raw_body: string | null;
  metodo_extraccion: ExtractionMethod;
  estado: AlertStatus;
  orden_pago_id: string | null;
  cliente_asignado_nombre: string | null;
  notas_conciliacion: string | null;
  conciliado_at: string | null;
  created_at: string;
}

/**
 * Representación de una orden de pago pendiente reportada por un cliente
 */
export interface PendingPaymentOrder {
  id: string;
  codigo_orden: string;
  cliente_id: string;
  cliente_nombre: string;
  cliente_email: string;
  nombre_remitente_reportado: string;
  banco_destino: BankName;
  monto_esperado: number;
  referencia_reportada: string | null;
  estado: PendingOrderStatus;
  created_at: string;
}

/**
 * Cuenta de Cliente / Titular registrada en `clientes_titulares`
 */
export interface ClientAccountRecord {
  id: string;
  nombre_titular: string;
  email_contacto: string | null;
  telefono: string | null;
  remitentes_zelle_habituales: string | null;
  porcentaje_comision: number;
  activo: boolean;
  total_bruto_conciliado: number;
  total_comision_retenida: number;
  total_neto_disponible: number;
  pagos_conciliados_count: number;
  created_at: string;
}

/**
 * Buzón de correo IMAP monitoreado para recibir alertas de Citibank / TD Bank
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
  activo: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}

/**
 * Resultado devuelto por la función PL/pgSQL `fn_conciliar_pago_zelle`
 */
export interface AutoReconciliationResult {
  conciliado: boolean;
  nuevo_estado: AlertStatus;
  orden_pago_id: string | null;
  codigo_orden: string | null;
  cliente_nombre: string | null;
  metodo_match: string;
  score_similitud: number;
  mensaje: string;
}

/**
 * Métricas agregadas del Panel de Control Financiero
 */
export interface FinancialSummaryMetrics {
  totalBrutoRecibido: number;
  totalComisionDescontada: number;
  totalNetoDisponible: number;
  totalBrutoEnviado: number;
  pagosConciliadosCount: number;
  pagosRevisionManualCount: number;
  pagosDetectadosCount: number;
}
