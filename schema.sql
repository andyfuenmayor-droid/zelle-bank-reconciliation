-- =============================================================================
-- FINTECH MULTI-CANAL RECONCILIATION SCHEMA
-- Canales: Zelle (Citibank / TD Bank) + Binance (Pay / P2P / On-Chain)
-- Motor: PostgreSQL 15+
-- =============================================================================

BEGIN;

-- 1. Extensiones requeridas para UUIDs, búsqueda difusa (trigramas) y normalización
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1.5. Tabla de Usuarios y Cuentas de Negocio (Acceso Multi-Tenant al Panel)
CREATE TABLE IF NOT EXISTS usuarios_negocios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_negocio VARCHAR(160) NOT NULL,
    nombre_usuario VARCHAR(140) NOT NULL,
    email VARCHAR(180) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    telefono VARCHAR(40),
    rol VARCHAR(30) NOT NULL DEFAULT 'NEGOCIO' CHECK (rol IN ('SUPER_ADMIN', 'NEGOCIO')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_negocios_email_unique
    ON usuarios_negocios (LOWER(email));

-- 1.6. Tabla de Configuración de Inteligencia Artificial y Visión OCR
CREATE TABLE IF NOT EXISTS system_ai_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    ai_provider VARCHAR(30) NOT NULL DEFAULT 'openai',
    openai_api_key TEXT,
    openai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
    gemini_api_key TEXT,
    gemini_model VARCHAR(50) NOT NULL DEFAULT 'gemini-1.5-flash',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_ai_settings (id, ai_provider, openai_model, gemini_model)
VALUES ('default', 'openai', 'gpt-4o-mini', 'gemini-1.5-flash')
ON CONFLICT (id) DO NOTHING;

-- 2. Tabla de Clientes / Titulares de Cuenta (Portal + Directorio de Remitentes)
CREATE TABLE IF NOT EXISTS clientes_titulares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE,
    nombre_titular TEXT NOT NULL,
    email VARCHAR(180) UNIQUE,
    email_contacto VARCHAR(255),
    telefono VARCHAR(40),
    pin_acceso_hash TEXT,
    porcentaje_comision_zelle NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (porcentaje_comision_zelle >= 0 AND porcentaje_comision_zelle <= 100),
    porcentaje_comision_binance NUMERIC(5,2) NOT NULL DEFAULT 1.50 CHECK (porcentaje_comision_binance >= 0 AND porcentaje_comision_binance <= 100),
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    remitentes_autorizados TEXT[] NOT NULL DEFAULT '{}',
    remitentes_zelle_habituales TEXT,
    cuentas_asignadas JSONB NOT NULL DEFAULT '[]'::jsonb,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente si `clientes_titulares` existía de la versión anterior
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS email VARCHAR(180);
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS email_contacto VARCHAR(255);
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS telefono VARCHAR(40);
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS pin_acceso_hash TEXT;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS porcentaje_comision_zelle NUMERIC(5,2) NOT NULL DEFAULT 4.00;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS porcentaje_comision_binance NUMERIC(5,2) NOT NULL DEFAULT 1.50;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 4.00;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS remitentes_autorizados TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS remitentes_zelle_habituales TEXT;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS cuentas_asignadas JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_titulares_email_unique
    ON clientes_titulares (LOWER(email))
    WHERE email IS NOT NULL;

-- 3. Tabla de Buzones de Correo IMAP Monitoreados (Citibank / TD Bank / Binance)
CREATE TABLE IF NOT EXISTS imap_monitored_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE,
    alias VARCHAR(120) NOT NULL DEFAULT 'Bandeja Principal Multi-Canal',
    email_address VARCHAR(255) UNIQUE NOT NULL,
    imap_host VARCHAR(255) NOT NULL DEFAULT 'imap.gmail.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
    imap_password TEXT NOT NULL,
    mailbox_folder VARCHAR(120) NOT NULL DEFAULT 'INBOX',
    bancos_monitoreados VARCHAR(64) NOT NULL DEFAULT 'CITIBANK_TD_BINANCE',
    plataforma VARCHAR(30) NOT NULL DEFAULT 'CITIBANK',
    cuenta_receptora TEXT,
    moneda VARCHAR(10) NOT NULL DEFAULT 'USD',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE imap_monitored_accounts ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;
ALTER TABLE imap_monitored_accounts ADD COLUMN IF NOT EXISTS plataforma VARCHAR(30) NOT NULL DEFAULT 'CITIBANK';
ALTER TABLE imap_monitored_accounts ADD COLUMN IF NOT EXISTS cuenta_receptora TEXT;
ALTER TABLE imap_monitored_accounts ADD COLUMN IF NOT EXISTS moneda VARCHAR(10) NOT NULL DEFAULT 'USD';

UPDATE imap_monitored_accounts
SET cuenta_receptora = email_address
WHERE cuenta_receptora IS NULL OR BTRIM(cuenta_receptora) = '';

-- 4. Tabla de Órdenes de Pago Pendientes (Reportes y Capturas subidas por el cliente)
CREATE TABLE IF NOT EXISTS ordenes_pago_pendientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE,
    codigo_orden VARCHAR(64) UNIQUE NOT NULL,
    cliente_id UUID NOT NULL REFERENCES clientes_titulares(id) ON DELETE CASCADE,
    cliente_nombre TEXT NOT NULL,
    cliente_email VARCHAR(255) NOT NULL DEFAULT 'cliente@conciliarcuenta.com',
    plataforma_esperada VARCHAR(30) NOT NULL CHECK (plataforma_esperada IN ('CITIBANK', 'TD_BANK', 'BINANCE_PAY', 'BINANCE_P2P', 'BINANCE_ONCHAIN')),
    banco_destino VARCHAR(32) DEFAULT 'CITIBANK',
    moneda VARCHAR(10) NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'USDT', 'VES')),
    monto_esperado NUMERIC(12,2) NOT NULL CHECK (monto_esperado > 0),
    remitente_reportado TEXT NOT NULL,
    nombre_remitente_reportado TEXT,
    referencia_reportada VARCHAR(120) NOT NULL,
    comprobante_base64 TEXT NOT NULL DEFAULT '',
    comprobante_mime VARCHAR(60),
    datos_ocr_extraidos JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado VARCHAR(25) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONCILIADO', 'LIQUIDADO', 'EXPIRADO', 'CANCELADO')),
    transaccion_conciliada_id UUID,
    alerta_conciliada_id UUID,
    conciliado_por VARCHAR(64),
    score_similitud NUMERIC(5,4),
    notas_cliente TEXT,
    conciliado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente si `ordenes_pago_pendientes` existía de la versión anterior
ALTER TABLE ordenes_pago_pendientes DROP CONSTRAINT IF EXISTS ordenes_pago_pendientes_banco_destino_check;
ALTER TABLE ordenes_pago_pendientes DROP CONSTRAINT IF EXISTS ordenes_pago_pendientes_estado_check;
ALTER TABLE ordenes_pago_pendientes ADD CONSTRAINT ordenes_pago_pendientes_estado_check CHECK (estado IN ('PENDIENTE', 'CONCILIADO', 'LIQUIDADO', 'EXPIRADO', 'CANCELADO'));
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS fecha_transferencia VARCHAR(50);
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS plataforma_esperada VARCHAR(30) DEFAULT 'CITIBANK';
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS banco_destino VARCHAR(32) DEFAULT 'CITIBANK';
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS moneda VARCHAR(10) NOT NULL DEFAULT 'USD';
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS remitente_reportado TEXT;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS nombre_remitente_reportado TEXT;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS comprobante_base64 TEXT NOT NULL DEFAULT '';
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS comprobante_mime VARCHAR(60);
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS datos_ocr_extraidos JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS transaccion_conciliada_id UUID;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS notas_cliente TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ordenes_pago_pendientes' AND column_name = 'plataforma_esperada'
    ) THEN
        UPDATE ordenes_pago_pendientes
        SET plataforma_esperada = COALESCE(NULLIF(plataforma_esperada, ''), NULLIF(banco_destino, ''), 'CITIBANK')
        WHERE plataforma_esperada IS NULL OR plataforma_esperada = '';

        UPDATE ordenes_pago_pendientes
        SET remitente_reportado = COALESCE(NULLIF(remitente_reportado, ''), NULLIF(nombre_remitente_reportado, ''), cliente_nombre)
        WHERE remitente_reportado IS NULL;

        UPDATE ordenes_pago_pendientes
        SET referencia_reportada = COALESCE(referencia_reportada, 'SIN-REF')
        WHERE referencia_reportada IS NULL;
    END IF;
END $$;

-- 5. Tabla Unificada: Transacciones Financieras Multicanal (Zelle Email + Binance API/Email)
CREATE TABLE IF NOT EXISTS financial_transactions_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE,
    external_unique_id VARCHAR(180) UNIQUE NOT NULL,
    dedup_key VARCHAR(180) UNIQUE NOT NULL,
    plataforma VARCHAR(30) NOT NULL CHECK (plataforma IN ('CITIBANK', 'TD_BANK', 'BINANCE_PAY', 'BINANCE_P2P', 'BINANCE_ONCHAIN', 'OTRO')),
    moneda VARCHAR(10) NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'USDT', 'VES')),
    tipo_movimiento VARCHAR(15) NOT NULL CHECK (tipo_movimiento IN ('RECIBIDO', 'ENVIADO')),
    monto_bruto NUMERIC(12,2) NOT NULL CHECK (monto_bruto > 0),
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    monto_comision NUMERIC(12,2) GENERATED ALWAYS AS (
        ROUND(monto_bruto * (porcentaje_comision / 100.0), 2)
    ) STORED,
    monto_neto NUMERIC(12,2) GENERATED ALWAYS AS (
        monto_bruto - ROUND(monto_bruto * (porcentaje_comision / 100.0), 2)
    ) STORED,
    remitente_o_contraparte TEXT NOT NULL,
    referencia VARCHAR(120) NOT NULL,
    fecha_transaccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origen_deteccion VARCHAR(25) NOT NULL CHECK (origen_deteccion IN ('EMAIL_REGEX', 'EMAIL_AI', 'BINANCE_API')),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado VARCHAR(25) NOT NULL DEFAULT 'DETECTADO' CHECK (estado IN ('DETECTADO', 'CONCILIADO', 'REVISION_MANUAL', 'DESCARTADO')),
    cliente_id UUID REFERENCES clientes_titulares(id) ON DELETE SET NULL,
    cliente_asignado_nombre TEXT,
    orden_conciliada_id UUID REFERENCES ordenes_pago_pendientes(id) ON DELETE SET NULL,
    nota_auditoria TEXT,
    conciliado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;
ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS descartado_at TIMESTAMPTZ;
ALTER TABLE financial_transactions_reconciliation DROP CONSTRAINT IF EXISTS financial_transactions_reconciliation_estado_check;
ALTER TABLE financial_transactions_reconciliation ADD CONSTRAINT financial_transactions_reconciliation_estado_check
    CHECK (estado IN ('DETECTADO', 'CONCILIADO', 'REVISION_MANUAL', 'DESCARTADO'));

-- Migración automática desde la tabla heredada `bank_email_alerts` (si existe como tabla física)
DO $$
DECLARE
    v_relkind CHAR(1);
BEGIN
    SELECT c.relkind
    INTO v_relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'bank_email_alerts';

    IF v_relkind = 'r' THEN
        INSERT INTO financial_transactions_reconciliation (
            id,
            external_unique_id,
            dedup_key,
            plataforma,
            moneda,
            tipo_movimiento,
            monto_bruto,
            porcentaje_comision,
            remitente_o_contraparte,
            referencia,
            fecha_transaccion,
            origen_deteccion,
            raw_payload,
            estado,
            cliente_asignado_nombre,
            orden_conciliada_id,
            nota_auditoria,
            conciliado_at,
            created_at
        )
        SELECT
            b.id,
            LEFT(b.message_id, 180),
            LEFT(
                b.banco || ':' ||
                COALESCE(NULLIF(UPPER(REGEXP_REPLACE(COALESCE(b.referencia, ''), '[^A-Z0-9]', '', 'g')), ''), 'NOREF') ||
                ':' || TO_CHAR(b.monto_bruto, 'FM999999990.00'),
                180
            ),
            b.banco,
            'USD',
            b.tipo_movimiento,
            b.monto_bruto,
            b.porcentaje_comision,
            COALESCE(NULLIF(b.remitente_o_destinatario, ''), 'Desconocido'),
            COALESCE(NULLIF(b.referencia, ''), 'SIN-REF'),
            b.fecha_transaccion,
            CASE WHEN b.metodo_extraccion = 'AI_FALLBACK' THEN 'EMAIL_AI' ELSE 'EMAIL_REGEX' END,
            jsonb_build_object('raw_body', COALESCE(b.raw_body, ''), 'migrated_from', 'bank_email_alerts'),
            b.estado,
            b.cliente_asignado_nombre,
            b.orden_pago_id,
            b.notas_conciliacion,
            b.conciliado_at,
            b.created_at
        FROM bank_email_alerts b
        ON CONFLICT DO NOTHING;

        ALTER TABLE bank_email_alerts RENAME TO bank_email_alerts_legacy;
    END IF;
END $$;

-- Vista retrocompatible `bank_email_alerts` sobre la nueva tabla unificada
CREATE OR REPLACE VIEW bank_email_alerts AS
SELECT
    id,
    external_unique_id AS message_id,
    plataforma AS banco,
    moneda,
    tipo_movimiento,
    monto_bruto,
    porcentaje_comision,
    monto_comision,
    monto_neto,
    remitente_o_contraparte AS remitente_o_destinatario,
    referencia,
    fecha_transaccion,
    COALESCE(raw_payload->>'raw_body', raw_payload::text) AS raw_body,
    CASE
        WHEN origen_deteccion = 'EMAIL_AI' THEN 'AI_FALLBACK'
        WHEN origen_deteccion = 'BINANCE_API' THEN 'BINANCE_API'
        ELSE 'REGEX'
    END AS metodo_extraccion,
    estado,
    orden_conciliada_id AS orden_pago_id,
    cliente_id,
    cliente_asignado_nombre,
    nota_auditoria AS notas_conciliacion,
    conciliado_at,
    created_at
FROM financial_transactions_reconciliation;

-- 6. Índices de Alto Rendimiento e Idempotencia
CREATE UNIQUE INDEX IF NOT EXISTS idx_ftr_external_unique_id
    ON financial_transactions_reconciliation (external_unique_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ftr_dedup_key
    ON financial_transactions_reconciliation (dedup_key);

CREATE INDEX IF NOT EXISTS idx_ftr_estado_plataforma_fecha
    ON financial_transactions_reconciliation (estado, plataforma, moneda, tipo_movimiento, fecha_transaccion DESC);

CREATE INDEX IF NOT EXISTS idx_ftr_monto_referencia
    ON financial_transactions_reconciliation (monto_bruto, referencia);

CREATE INDEX IF NOT EXISTS idx_ftr_remitente_trgm
    ON financial_transactions_reconciliation USING GIN (remitente_o_contraparte gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ordenes_pendientes_matching
    ON ordenes_pago_pendientes (estado, plataforma_esperada, moneda, monto_esperado, referencia_reportada)
    WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS idx_ordenes_remitente_trgm
    ON ordenes_pago_pendientes USING GIN (remitente_reportado gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ordenes_cliente_trgm
    ON ordenes_pago_pendientes USING GIN (cliente_nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clientes_titulares_nombre_trgm
    ON clientes_titulares USING GIN (nombre_titular gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clientes_titulares_remitentes_trgm
    ON clientes_titulares USING GIN (remitentes_zelle_habituales gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ftr_negocio_id
    ON financial_transactions_reconciliation (negocio_id);
CREATE INDEX IF NOT EXISTS idx_ftr_negocio_fecha_created
    ON financial_transactions_reconciliation (negocio_id, fecha_transaccion DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ftr_cliente_id_estado
    ON financial_transactions_reconciliation (cliente_id, estado, moneda)
    WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente_id_created
    ON ordenes_pago_pendientes (cliente_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clientes_negocio_id
    ON clientes_titulares (negocio_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_negocio_id
    ON ordenes_pago_pendientes (negocio_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_negocio_estado_created
    ON ordenes_pago_pendientes (negocio_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_imap_negocio_id
    ON imap_monitored_accounts (negocio_id);

-- =============================================================================
-- 7. FUNCIONES PL/pgSQL DE COTEJO Y CONCILIACIÓN
--
-- REGLAS FINANCIERAS INQUEBRANTABLES:
--  1) Cero conciliaciones huérfanas: Un correo bancario NUNCA se concilia si ningún
--     cliente ha reportado una orden de pago en el portal.
--  2) El gatillo principal es la Orden del Cliente: Al reportar un pago en /portal,
--     el sistema busca en la base de correos bancarios almacenados (fn_conciliar_orden_cliente).
--  3) Coincidencia estricta de Referencia (incluye prefijos bancarios BAC, WFCT, etc.):
--     Si ambos tienen referencia real, DEBEN coincidir. Jamás se cruzan referencias incompatibles.
--  4) Coincidencia estricta de Remitente (similarity >= 0.60): Solo aplica si no hay
--     referencia (SIN-REF) y jamás cruza nombres distintos (ej. Roberto A no puede ser Richard Arias).
-- =============================================================================

DROP FUNCTION IF EXISTS fn_conciliar_orden_cliente(UUID);
CREATE OR REPLACE FUNCTION fn_conciliar_orden_cliente(p_orden_id UUID)
RETURNS TABLE (
    conciliado BOOLEAN,
    nuevo_estado VARCHAR(32),
    transaccion_id UUID,
    referencia_tx VARCHAR(128),
    cliente_id UUID,
    cliente_nombre TEXT,
    metodo_match VARCHAR(64),
    score_similitud NUMERIC(5,4),
    mensaje TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_orden ordenes_pago_pendientes%ROWTYPE;
    v_tx financial_transactions_reconciliation%ROWTYPE;
    v_cliente clientes_titulares%ROWTYPE;
    v_clean_order_ref VARCHAR(128);
    v_clean_order_sender TEXT;
    v_resolved_fee NUMERIC(5,2);
    v_is_order_ref_generic BOOLEAN := FALSE;
    v_is_order_ref_numeric_conf BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_orden FROM ordenes_pago_pendientes WHERE id = p_orden_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'NO_ENCONTRADA'::VARCHAR(32), NULL::UUID, NULL::VARCHAR(128), NULL::UUID, NULL::TEXT, 'ORDER_NOT_FOUND'::VARCHAR(64), 0.0000::NUMERIC(5,4), 'La orden de pago especificada no existe.'::TEXT;
        RETURN;
    END IF;

    IF v_orden.estado = 'CONCILIADO' THEN
        RETURN QUERY SELECT TRUE, 'CONCILIADO'::VARCHAR(32), v_orden.transaccion_conciliada_id, NULL::VARCHAR(128), v_orden.cliente_id, v_orden.cliente_nombre, 'ALREADY_RECONCILED'::VARCHAR(64), 1.0000::NUMERIC(5,4), 'La orden ya se encontraba conciliada.'::TEXT;
        RETURN;
    END IF;

    v_clean_order_ref := UPPER(REGEXP_REPLACE(COALESCE(v_orden.referencia_reportada, ''), '[^A-Z0-9]', '', 'g'));
    v_clean_order_sender := LOWER(unaccent(TRIM(COALESCE(v_orden.remitente_reportado, v_orden.nombre_remitente_reportado, ''))));

    v_is_order_ref_generic := (
        v_clean_order_ref IS NULL
        OR LENGTH(v_clean_order_ref) < 4
        OR v_clean_order_ref IN (
            'NOREF', 'SINREF', 'NA', 'NONE', 'NULL', 'CERO', 'ZERO',
            'BANKOFAMERICA', 'CHASE', 'CITIBANK', 'WELLSFARGO', 'TD', 'TDBANK',
            'PAGO', 'ZELLE', 'TRANSFERENCIA', 'DEPOSITO', 'COMPROBANTE', 'DEBITO'
        )
    );

    -- Códigos de confirmación de apps móviles (ej. Wells Fargo o Chase de 8 a 14 dígitos numéricos)
    -- Estos códigos no coinciden textualmente con la referencia de compensación que entrega Citibank (WFCT... / BAC...)
    v_is_order_ref_numeric_conf := (
        v_clean_order_ref ~ '^[0-9]{8,14}$'
    );

    -- -------------------------------------------------------------------------
    -- PASO 1: Cotejo por Referencia Bancaria Exacta o Substring Alfanumérico
    -- -------------------------------------------------------------------------
    IF NOT v_is_order_ref_generic THEN
        SELECT t.*
        INTO v_tx
        FROM financial_transactions_reconciliation t
        WHERE t.estado IN ('DETECTADO', 'REVISION_MANUAL')
          AND t.tipo_movimiento = 'RECIBIDO'
          AND t.moneda = v_orden.moneda
          AND t.monto_bruto = v_orden.monto_esperado
          AND (t.negocio_id IS NOT DISTINCT FROM v_orden.negocio_id OR t.negocio_id IS NULL OR v_orden.negocio_id IS NULL)
          AND (
              UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) = v_clean_order_ref
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_clean_order_ref || '%'
              OR v_clean_order_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) || '%'
              OR (
                  LENGTH(v_clean_order_ref) >= 6
                  AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g'))) >= 6
                  AND RIGHT(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')), 6) = RIGHT(v_clean_order_ref, 6)
              )
              OR (
                  LENGTH(v_clean_order_ref) >= 8
                  AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g'))) >= 8
                  AND RIGHT(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')), 8) = RIGHT(v_clean_order_ref, 8)
              )
          )
        ORDER BY t.fecha_transaccion ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            SELECT * INTO v_cliente FROM clientes_titulares WHERE id = v_orden.cliente_id;
            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, 4.00);
            END IF;

            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = v_tx.id,
                alerta_conciliada_id = v_tx.id,
                conciliado_por = 'CLIENT_ORDER_REF',
                score_similitud = 1.0000,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = v_orden.id;

            UPDATE financial_transactions_reconciliation
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_resolved_fee,
                cliente_id = v_orden.cliente_id,
                cliente_asignado_nombre = v_orden.cliente_nombre,
                orden_conciliada_id = v_orden.id,
                conciliado_at = NOW(),
                nota_auditoria = FORMAT('Cotejado y conciliado por referencia con orden %s del cliente %s (Ref: %s). Comisión: %s%%.', v_orden.codigo_orden, v_orden.cliente_nombre, v_tx.referencia, v_resolved_fee)
            WHERE id = v_tx.id;

            RETURN QUERY SELECT TRUE, 'CONCILIADO'::VARCHAR(32), v_tx.id, v_tx.referencia, v_orden.cliente_id, v_orden.cliente_nombre, 'MATCH_REF_EXACTA'::VARCHAR(64), 1.0000::NUMERIC(5,4), 'Pago cotejado con éxito por referencia bancaria.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PASO 2: Cotejo por Remitente Estricto y Tolerante a Variaciones Fonéticas (similarity >= 0.38)
    -- Aplica si la orden o banco no tienen ref (SIN-REF) o si la ref es código móvil app
    -- -------------------------------------------------------------------------
    IF LENGTH(v_clean_order_sender) >= 3 THEN
        SELECT t.*
        INTO v_tx
        FROM financial_transactions_reconciliation t
        WHERE t.estado IN ('DETECTADO', 'REVISION_MANUAL')
          AND t.tipo_movimiento = 'RECIBIDO'
          AND t.moneda = v_orden.moneda
          AND t.monto_bruto = v_orden.monto_esperado
          AND (t.negocio_id IS NOT DISTINCT FROM v_orden.negocio_id OR t.negocio_id IS NULL OR v_orden.negocio_id IS NULL)
          -- Compatibilidad estricta de referencias: si la orden reporta una referencia alfanumérica específica,
          -- jamás se permite cruzar por nombre con un correo que tenga una referencia bancaria diferente.
          AND (
              v_is_order_ref_generic
              OR v_is_order_ref_numeric_conf
              OR t.referencia IS NULL
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) IN ('SINREF', 'NOREF', 'NA', 'NONE', 'NULL')
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_clean_order_ref || '%'
              OR v_clean_order_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) || '%'
              OR (
                  LENGTH(v_clean_order_ref) >= 6
                  AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g'))) >= 6
                  AND RIGHT(UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')), 6) = RIGHT(v_clean_order_ref, 6)
              )
          )
          AND (
              similarity(LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, '')))), v_clean_order_sender) >= 0.38
              OR word_similarity(v_clean_order_sender, LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, ''))))) >= 0.50
              OR (
                  LENGTH(v_clean_order_sender) >= 4
                  AND (
                      LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, '')))) LIKE '%' || v_clean_order_sender || '%'
                      OR v_clean_order_sender LIKE '%' || LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, '')))) || '%'
                  )
              )
          )
        ORDER BY similarity(LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, '')))), v_clean_order_sender) DESC, t.fecha_transaccion ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            SELECT * INTO v_cliente FROM clientes_titulares WHERE id = v_orden.cliente_id;
            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, 4.00);
            END IF;

            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = v_tx.id,
                alerta_conciliada_id = v_tx.id,
                conciliado_por = 'CLIENT_ORDER_SENDER',
                score_similitud = 0.8500,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = v_orden.id;

            UPDATE financial_transactions_reconciliation
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_resolved_fee,
                cliente_id = v_orden.cliente_id,
                cliente_asignado_nombre = v_orden.cliente_nombre,
                orden_conciliada_id = v_orden.id,
                conciliado_at = NOW(),
                nota_auditoria = FORMAT('Cotejado y conciliado por remitente con orden %s del cliente %s. Comisión: %s%%.', v_orden.codigo_orden, v_orden.cliente_nombre, v_resolved_fee)
            WHERE id = v_tx.id;

            RETURN QUERY SELECT TRUE, 'CONCILIADO'::VARCHAR(32), v_tx.id, v_tx.referencia, v_orden.cliente_id, v_orden.cliente_nombre, 'MATCH_REMITENTE_STRICT'::VARCHAR(64), 0.8500::NUMERIC(5,4), 'Pago cotejado con éxito por remitente y monto.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Si no existe en la base de correos, la orden queda en PENDIENTE en espera de que llegue el correo del banco
    RETURN QUERY SELECT FALSE, 'PENDIENTE'::VARCHAR(32), NULL::UUID, NULL::VARCHAR(128), v_orden.cliente_id, v_orden.cliente_nombre, 'WAITING_BANK_EMAIL'::VARCHAR(64), 0.0000::NUMERIC(5,4), 'Orden en espera: Aún no existe correo bancario correspondiente en la base de datos.'::TEXT;
END;
$$;


-- =============================================================================
-- FUNCIÓN fn_auto_conciliar_transaccion (Llegada de Correo Bancario)
-- Cuando entra un correo, busca si ya existe una orden pendiente de un cliente.
-- Si ningún cliente lo ha reportado, QUEDA EN ESTADO 'DETECTADO' (cero conciliación huérfana).
-- =============================================================================
DROP FUNCTION IF EXISTS fn_auto_conciliar_transaccion(UUID);
CREATE OR REPLACE FUNCTION fn_auto_conciliar_transaccion(p_tx_id UUID)
RETURNS TABLE (
    conciliado BOOLEAN,
    nuevo_estado VARCHAR(32),
    orden_pago_id UUID,
    codigo_orden VARCHAR(64),
    cliente_id UUID,
    cliente_nombre TEXT,
    metodo_match VARCHAR(64),
    score_similitud NUMERIC(5,4),
    mensaje TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_tx financial_transactions_reconciliation%ROWTYPE;
    v_orden ordenes_pago_pendientes%ROWTYPE;
    v_cliente clientes_titulares%ROWTYPE;
    v_norm_ref VARCHAR(128);
    v_norm_sender TEXT;
    v_is_ref_generic BOOLEAN := FALSE;
    v_resolved_fee NUMERIC(5,2);
BEGIN
    SELECT * INTO v_tx FROM financial_transactions_reconciliation WHERE id = p_tx_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transacción financiera % no encontrada', p_tx_id;
    END IF;

    IF v_tx.estado = 'CONCILIADO' THEN
        RETURN QUERY SELECT TRUE, v_tx.estado::VARCHAR(32), v_tx.orden_conciliada_id, NULL::VARCHAR(64), v_tx.cliente_id, v_tx.cliente_asignado_nombre, 'ALREADY_RECONCILED'::VARCHAR(64), 1.0000::NUMERIC(5,4), 'La transacción ya se encontraba conciliada.'::TEXT;
        RETURN;
    END IF;

    IF v_tx.estado = 'DESCARTADO' THEN
        RETURN QUERY SELECT FALSE, v_tx.estado::VARCHAR(32), NULL::UUID, NULL::VARCHAR(64), NULL::UUID, NULL::TEXT, 'SKIPPED_DISCARDED'::VARCHAR(64), 0.0000::NUMERIC(5,4), 'Correo descartado/eliminado por el administrador; omitido de conciliación.'::TEXT;
        RETURN;
    END IF;

    -- Solo depósitos entrantes
    IF v_tx.tipo_movimiento <> 'RECIBIDO' THEN
        RETURN QUERY SELECT FALSE, v_tx.estado::VARCHAR(32), NULL::UUID, NULL::VARCHAR(64), NULL::UUID, NULL::TEXT, 'SKIPPED_OUTGOING'::VARCHAR(64), 0.0000::NUMERIC(5,4), 'Movimiento saliente (ENVIADO); no requiere conciliación de depósito.'::TEXT;
        RETURN;
    END IF;

    v_norm_ref := UPPER(REGEXP_REPLACE(COALESCE(v_tx.referencia, ''), '[^A-Z0-9]', '', 'g'));
    v_norm_sender := LOWER(unaccent(TRIM(COALESCE(v_tx.remitente_o_contraparte, ''))));

    v_is_ref_generic := (
        v_norm_ref IS NULL
        OR LENGTH(v_norm_ref) < 4
        OR v_norm_ref IN (
            'NOREF', 'SINREF', 'NA', 'NONE', 'NULL', 'CERO', 'ZERO',
            'BANKOFAMERICA', 'CHASE', 'CITIBANK', 'WELLSFARGO', 'TD', 'TDBANK',
            'PAGO', 'ZELLE', 'TRANSFERENCIA', 'DEPOSITO', 'COMPROBANTE', 'DEBITO'
        )
    );

    -- PASO 1: Buscar si un cliente ya reportó una orden con esta referencia
    IF NOT v_is_ref_generic THEN
        SELECT o.*
        INTO v_orden
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND o.moneda = v_tx.moneda
          AND o.monto_esperado = v_tx.monto_bruto
          AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          AND (
              UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) = v_norm_ref
              OR v_norm_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) || '%'
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_norm_ref || '%'
              OR (
                  LENGTH(v_norm_ref) >= 6
                  AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g'))) >= 6
                  AND RIGHT(v_norm_ref, 6) = RIGHT(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')), 6)
              )
          )
        ORDER BY o.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            SELECT * INTO v_cliente FROM clientes_titulares WHERE id = v_orden.cliente_id;
            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, 4.00);
            END IF;

            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = v_tx.id,
                alerta_conciliada_id = v_tx.id,
                conciliado_por = 'AUTO_EXACT_REF',
                score_similitud = 1.0000,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = v_orden.id;

            UPDATE financial_transactions_reconciliation
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_resolved_fee,
                cliente_id = v_orden.cliente_id,
                cliente_asignado_nombre = v_orden.cliente_nombre,
                orden_conciliada_id = v_orden.id,
                conciliado_at = NOW(),
                nota_auditoria = FORMAT('Cotejado y conciliado con orden %s de cliente %s (Ref: %s). Comisión: %s%%.', v_orden.codigo_orden, v_orden.cliente_nombre, v_tx.referencia, v_resolved_fee)
            WHERE id = v_tx.id;

            RETURN QUERY SELECT TRUE, 'CONCILIADO'::VARCHAR(32), v_orden.id, v_orden.codigo_orden, v_orden.cliente_id, v_orden.cliente_nombre, 'AUTO_EXACT_REF'::VARCHAR(64), 1.0000::NUMERIC(5,4), 'Conciliado con éxito por referencia con orden de cliente.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- PASO 2: Buscar si un cliente ya reportó una orden con este remitente (similarity >= 0.38)
    IF LENGTH(v_norm_sender) >= 3 THEN
        SELECT o.*
        INTO v_orden
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND o.moneda = v_tx.moneda
          AND o.monto_esperado = v_tx.monto_bruto
          AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          -- Sin referencias bancarias contradictorias: jamás cruzar por nombre si la orden tiene una referencia alfanumérica distinta
          AND (
              v_is_ref_generic
              OR o.referencia_reportada IS NULL
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) IN ('SINREF', 'NOREF', 'NA', 'NONE', 'NULL', 'BANKOFAMERICA', 'CHASE', 'CITIBANK', 'WELLSFARGO')
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) ~ '^[0-9]{8,14}$'
              OR v_norm_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) || '%'
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_norm_ref || '%'
              OR (
                  LENGTH(v_norm_ref) >= 6
                  AND LENGTH(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g'))) >= 6
                  AND RIGHT(v_norm_ref, 6) = RIGHT(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')), 6)
              )
          )
          AND (
              similarity(LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, '')))), v_norm_sender) >= 0.38
              OR word_similarity(v_norm_sender, LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, ''))))) >= 0.50
              OR (
                  LENGTH(v_norm_sender) >= 4
                  AND (
                      LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, '')))) LIKE '%' || v_norm_sender || '%'
                      OR v_norm_sender LIKE '%' || LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, '')))) || '%'
                  )
              )
          )
        ORDER BY similarity(LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, '')))), v_norm_sender) DESC, o.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            SELECT * INTO v_cliente FROM clientes_titulares WHERE id = v_orden.cliente_id;
            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, 4.00);
            END IF;

            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                transaccion_conciliada_id = v_tx.id,
                alerta_conciliada_id = v_tx.id,
                conciliado_por = 'AUTO_SENDER_NAME',
                score_similitud = 0.8500,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = v_orden.id;

            UPDATE financial_transactions_reconciliation
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_resolved_fee,
                cliente_id = v_orden.cliente_id,
                cliente_asignado_nombre = v_orden.cliente_nombre,
                orden_conciliada_id = v_orden.id,
                conciliado_at = NOW(),
                nota_auditoria = FORMAT('Cotejado y conciliado por remitente con orden %s de cliente %s. Comisión: %s%%.', v_orden.codigo_orden, v_orden.cliente_nombre, v_resolved_fee)
            WHERE id = v_tx.id;

            RETURN QUERY SELECT TRUE, 'CONCILIADO'::VARCHAR(32), v_orden.id, v_orden.codigo_orden, v_orden.cliente_id, v_orden.cliente_nombre, 'AUTO_SENDER_NAME'::VARCHAR(64), 0.8500::NUMERIC(5,4), 'Conciliado con éxito por coincidencia de remitente con orden de cliente.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- REGLA DE ORO: Si ningún cliente ha reportado una orden para este correo,
    -- el correo QUEDA EN DETECTADO en la base de datos de correos.
    -- NUNCA se asigna a ningún cliente por cuenta propia.
    RETURN QUERY SELECT FALSE, 'DETECTADO'::VARCHAR(32), NULL::UUID, NULL::VARCHAR(64), NULL::UUID, NULL::TEXT, 'NO_ORDER_WAITING_CLIENT'::VARCHAR(64), 0.0000::NUMERIC(5,4), 'Correo bancario registrado en estado DETECTADO en espera de reporte del cliente.'::TEXT;
END;
$$;


-- Función wrapper retrocompatible
DROP FUNCTION IF EXISTS fn_conciliar_pago_zelle(UUID);
CREATE OR REPLACE FUNCTION fn_conciliar_pago_zelle(p_alert_id UUID)
RETURNS TABLE (
    conciliado BOOLEAN,
    nuevo_estado VARCHAR(32),
    orden_pago_id UUID,
    codigo_orden VARCHAR(64),
    cliente_id UUID,
    cliente_nombre TEXT,
    metodo_match VARCHAR(64),
    score_similitud NUMERIC(5,4),
    mensaje TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY SELECT * FROM fn_auto_conciliar_transaccion(p_alert_id);
END;
$$;


-- =============================================================================
-- TABLA: liquidaciones_clientes
-- Registra las liquidaciones/pagos de fondos a clientes o a sus destinatarios
-- (ej. Ramoncito tiene $2,310 y se le liquidan $2,000 a equis persona,
-- quedando con saldo de $310 y cerrando el ciclo de capturas activas).
-- =============================================================================
CREATE TABLE IF NOT EXISTS liquidaciones_clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_liquidacion VARCHAR(64) UNIQUE NOT NULL,
    negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE,
    cliente_id UUID NOT NULL REFERENCES clientes_titulares(id) ON DELETE CASCADE,
    cliente_nombre TEXT NOT NULL,
    monto_liquidado NUMERIC(12,2) NOT NULL CHECK (monto_liquidado > 0),
    moneda VARCHAR(10) NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'USDT', 'VES')),
    destinatario_beneficiario TEXT NOT NULL,
    motivo_concepto TEXT NOT NULL,
    metodo_pago_salida VARCHAR(50) NOT NULL DEFAULT 'ZELLE' CHECK (metodo_pago_salida IN ('ZELLE', 'BINANCE_USDT', 'PAGO_MOVIL', 'TRANSFERENCIA_BANCARIA', 'EFECTIVO', 'OTRO')),
    referencia_salida VARCHAR(120),
    comprobante_salida_base64 TEXT,
    saldo_anterior NUMERIC(12,2) NOT NULL,
    saldo_restante NUMERIC(12,2) NOT NULL,
    liquidado_por VARCHAR(100) NOT NULL DEFAULT 'ADMINISTRADOR',
    notas_operador TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liq_cliente_fecha ON liquidaciones_clientes (cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_liq_negocio_fecha ON liquidaciones_clientes (negocio_id, created_at DESC);

-- Columnas de vinculación en órdenes y transacciones para archivar ciclos liquidados
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS liquidacion_id UUID REFERENCES liquidaciones_clientes(id) ON DELETE SET NULL;
ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS liquidado_at TIMESTAMPTZ;

ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS liquidacion_id UUID REFERENCES liquidaciones_clientes(id) ON DELETE SET NULL;
ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS liquidado_at TIMESTAMPTZ;

COMMIT;
