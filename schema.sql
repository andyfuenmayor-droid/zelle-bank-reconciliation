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
    estado VARCHAR(25) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONCILIADO', 'EXPIRADO', 'CANCELADO')),
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
    estado VARCHAR(25) NOT NULL DEFAULT 'DETECTADO' CHECK (estado IN ('DETECTADO', 'CONCILIADO', 'REVISION_MANUAL')),
    cliente_id UUID REFERENCES clientes_titulares(id) ON DELETE SET NULL,
    cliente_asignado_nombre TEXT,
    orden_conciliada_id UUID REFERENCES ordenes_pago_pendientes(id) ON DELETE SET NULL,
    nota_auditoria TEXT,
    conciliado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;

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
CREATE INDEX IF NOT EXISTS idx_clientes_negocio_id
    ON clientes_titulares (negocio_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_negocio_id
    ON ordenes_pago_pendientes (negocio_id);
CREATE INDEX IF NOT EXISTS idx_imap_negocio_id
    ON imap_monitored_accounts (negocio_id);

-- =============================================================================
-- 7. FUNCIÓN PL/pgSQL BIDIRECCIONAL: fn_auto_conciliar_transaccion
-- Concilia una transacción de financial_transactions_reconciliation contra:
--  1) ordenes_pago_pendientes por moneda + monto_bruto + referencia exacta/últimos 6
--  2) ordenes_pago_pendientes por plataforma + monto_bruto + similitud pg_trgm (>= 0.45)
--  2.5) clientes_titulares por remitentes_autorizados / nombre_titular
--  3) Detección de pago de tercero / referencia mal escrita -> REVISION_MANUAL
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
    v_candidate_count INTEGER := 0;
    v_best_score NUMERIC(5,4) := 0;
    v_norm_ref VARCHAR(128);
    v_norm_sender TEXT;
    v_resolved_fee NUMERIC(5,2);
    v_resolved_client_name TEXT;
    v_resolved_client_id UUID;
BEGIN
    SELECT *
    INTO v_tx
    FROM financial_transactions_reconciliation
    WHERE id = p_tx_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transacción financiera % no encontrada', p_tx_id;
    END IF;

    -- Idempotencia si ya está conciliada
    IF v_tx.estado = 'CONCILIADO' THEN
        RETURN QUERY SELECT
            TRUE,
            v_tx.estado::VARCHAR(32),
            v_tx.orden_conciliada_id,
            NULL::VARCHAR(64),
            v_tx.cliente_id,
            v_tx.cliente_asignado_nombre,
            'ALREADY_RECONCILED'::VARCHAR(64),
            1.0000::NUMERIC(5,4),
            'La transacción ya se encontraba conciliada previamente.'::TEXT;
        RETURN;
    END IF;

    -- Solo conciliamos ingresos (RECIBIDO)
    IF v_tx.tipo_movimiento <> 'RECIBIDO' THEN
        RETURN QUERY SELECT
            FALSE,
            v_tx.estado::VARCHAR(32),
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::UUID,
            NULL::TEXT,
            'SKIPPED_OUTGOING'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Movimiento saliente (ENVIADO); no requiere conciliación de depósito.'::TEXT;
        RETURN;
    END IF;

    v_norm_ref := UPPER(REGEXP_REPLACE(COALESCE(v_tx.referencia, ''), '[^A-Z0-9]', '', 'g'));
    v_norm_sender := LOWER(unaccent(TRIM(COALESCE(v_tx.remitente_o_contraparte, ''))));

    -- -------------------------------------------------------------------------
    -- PASO 1: Match exacto por Moneda + Monto Exacto + Referencia (completa o últimos 6 dígitos)
    -- -------------------------------------------------------------------------
    IF LENGTH(v_norm_ref) >= 4 AND v_norm_ref NOT IN ('NOREF', 'SINREF') THEN
        SELECT o.*
        INTO v_orden
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          AND o.moneda = v_tx.moneda
          AND o.monto_esperado = v_tx.monto_bruto
          AND (
              UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) = v_norm_ref
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
            v_resolved_client_id := COALESCE(v_cliente.id, v_orden.cliente_id);
            v_resolved_client_name := COALESCE(v_cliente.nombre_titular, v_orden.cliente_nombre);

            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, v_tx.porcentaje_comision, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, v_tx.porcentaje_comision, 4.00);
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
                cliente_id = v_resolved_client_id,
                cliente_asignado_nombre = v_resolved_client_name,
                orden_conciliada_id = v_orden.id,
                nota_auditoria = FORMAT(
                    'Conciliación automática exacta por %s (%s %s) y referencia (%s) con orden %s. Comisión aplicada: %s%%.',
                    v_tx.plataforma,
                    v_tx.monto_bruto,
                    v_tx.moneda,
                    v_tx.referencia,
                    v_orden.codigo_orden,
                    v_resolved_fee
                ),
                conciliado_at = NOW()
            WHERE id = v_tx.id;

            RETURN QUERY SELECT
                TRUE,
                'CONCILIADO'::VARCHAR(32),
                v_orden.id,
                v_orden.codigo_orden,
                v_resolved_client_id,
                v_resolved_client_name,
                'AUTO_EXACT_REF'::VARCHAR(64),
                1.0000::NUMERIC(5,4),
                FORMAT('Conciliado por referencia exacta con orden %s', v_orden.codigo_orden)::TEXT;
            RETURN;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PASO 2: Match difuso por Plataforma + Monto Exacto + Similitud de Nombre (pg_trgm >= 0.45)
    -- -------------------------------------------------------------------------
    IF LENGTH(v_norm_sender) >= 3
       AND v_norm_sender NOT IN ('desconocido', 'unknown', 'sin remitente', 'no especificado', 'anonymous') THEN
        SELECT COUNT(*)
        INTO v_candidate_count
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          AND (o.plataforma_esperada = v_tx.plataforma OR v_tx.plataforma = 'OTRO')
          AND o.moneda = v_tx.moneda
          AND o.monto_esperado = v_tx.monto_bruto
          AND GREATEST(
              similarity(LOWER(unaccent(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, ''))), v_norm_sender),
              similarity(LOWER(unaccent(COALESCE(o.cliente_nombre, ''))), v_norm_sender)
          ) >= 0.45;

        IF v_candidate_count = 1 THEN
            SELECT o.*
            INTO v_orden
            FROM ordenes_pago_pendientes o
            WHERE o.estado = 'PENDIENTE'
              AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
              AND (o.plataforma_esperada = v_tx.plataforma OR v_tx.plataforma = 'OTRO')
              AND o.moneda = v_tx.moneda
              AND o.monto_esperado = v_tx.monto_bruto
              AND GREATEST(
                  similarity(LOWER(unaccent(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, ''))), v_norm_sender),
                  similarity(LOWER(unaccent(COALESCE(o.cliente_nombre, ''))), v_norm_sender)
              ) >= 0.45
            LIMIT 1
            FOR UPDATE SKIP LOCKED;

            IF FOUND THEN
                v_best_score := GREATEST(
                    similarity(LOWER(unaccent(COALESCE(v_orden.remitente_reportado, v_orden.nombre_remitente_reportado, ''))), v_norm_sender),
                    similarity(LOWER(unaccent(COALESCE(v_orden.cliente_nombre, ''))), v_norm_sender)
                )::NUMERIC(5,4);

                SELECT * INTO v_cliente FROM clientes_titulares WHERE id = v_orden.cliente_id;
                v_resolved_client_id := COALESCE(v_cliente.id, v_orden.cliente_id);
                v_resolved_client_name := COALESCE(v_cliente.nombre_titular, v_orden.cliente_nombre);

                IF v_tx.plataforma LIKE 'BINANCE%' THEN
                    v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, v_tx.porcentaje_comision, 1.50);
                ELSE
                    v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, v_tx.porcentaje_comision, 4.00);
                END IF;

                UPDATE ordenes_pago_pendientes
                SET estado = 'CONCILIADO',
                    transaccion_conciliada_id = v_tx.id,
                    alerta_conciliada_id = v_tx.id,
                    conciliado_por = 'AUTO_TRGM_NAME',
                    score_similitud = v_best_score,
                    conciliado_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_orden.id;

                UPDATE financial_transactions_reconciliation
                SET estado = 'CONCILIADO',
                    porcentaje_comision = v_resolved_fee,
                    cliente_id = v_resolved_client_id,
                    cliente_asignado_nombre = v_resolved_client_name,
                    orden_conciliada_id = v_orden.id,
                    nota_auditoria = FORMAT(
                        'Conciliación automática por %s (%s %s) y similitud de contraparte (%s%%) con orden %s.',
                        v_tx.plataforma,
                        v_tx.monto_bruto,
                        v_tx.moneda,
                        ROUND(v_best_score * 100, 1),
                        v_orden.codigo_orden
                    ),
                    conciliado_at = NOW()
                WHERE id = v_tx.id;

                RETURN QUERY SELECT
                    TRUE,
                    'CONCILIADO'::VARCHAR(32),
                    v_orden.id,
                    v_orden.codigo_orden,
                    v_resolved_client_id,
                    v_resolved_client_name,
                    'AUTO_TRGM_NAME'::VARCHAR(64),
                    v_best_score,
                    FORMAT('Conciliado por similitud de nombre (%s%%) con orden %s', ROUND(v_best_score * 100, 1), v_orden.codigo_orden)::TEXT;
                RETURN;
            END IF;
        ELSIF v_candidate_count > 1 THEN
            UPDATE financial_transactions_reconciliation
            SET estado = 'REVISION_MANUAL',
                nota_auditoria = FORMAT(
                    'Ambigüedad detectada: existen %s órdenes pendientes en %s por %s %s con similitud de nombre. Requiere asignación manual.',
                    v_candidate_count,
                    v_tx.plataforma,
                    v_tx.monto_bruto,
                    v_tx.moneda
                )
            WHERE id = v_tx.id;

            RETURN QUERY SELECT
                FALSE,
                'REVISION_MANUAL'::VARCHAR(32),
                NULL::UUID,
                NULL::VARCHAR(64),
                NULL::UUID,
                NULL::TEXT,
                'AMBIGUOUS_CANDIDATES'::VARCHAR(64),
                0.0000::NUMERIC(5,4),
                FORMAT('Múltiples candidatos (%s) para %s %s. Marcado para revisión manual.', v_candidate_count, v_tx.monto_bruto, v_tx.moneda)::TEXT;
            RETURN;
        END IF;

        -- ---------------------------------------------------------------------
        -- PASO 2.5: Reconocimiento directo contra `clientes_titulares.remitentes_autorizados`
        -- ---------------------------------------------------------------------
        SELECT c.*
        INTO v_cliente
        FROM clientes_titulares c
        WHERE c.activo = TRUE
          AND (c.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR c.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          AND (
              similarity(LOWER(unaccent(c.nombre_titular)), v_norm_sender) >= 0.55
              OR LOWER(unaccent(COALESCE(c.remitentes_zelle_habituales, ''))) LIKE '%' || v_norm_sender || '%'
              OR EXISTS (
                  SELECT 1
                  FROM UNNEST(COALESCE(c.remitentes_autorizados, ARRAY[]::TEXT[])) AS auth_sender
                  WHERE LENGTH(TRIM(auth_sender)) >= 3
                    AND (
                        LOWER(unaccent(TRIM(auth_sender))) = v_norm_sender
                        OR similarity(LOWER(unaccent(TRIM(auth_sender))), v_norm_sender) >= 0.55
                    )
              )
          )
        ORDER BY similarity(LOWER(unaccent(c.nombre_titular)), v_norm_sender) DESC
        LIMIT 1;

        IF FOUND THEN
            v_best_score := GREATEST(
                similarity(LOWER(unaccent(v_cliente.nombre_titular)), v_norm_sender),
                0.8500
            )::NUMERIC(5,4);

            IF v_tx.plataforma LIKE 'BINANCE%' THEN
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_binance, 1.50);
            ELSE
                v_resolved_fee := COALESCE(v_cliente.porcentaje_comision_zelle, v_cliente.porcentaje_comision, 4.00);
            END IF;

            UPDATE financial_transactions_reconciliation
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_resolved_fee,
                cliente_id = v_cliente.id,
                cliente_asignado_nombre = v_cliente.nombre_titular,
                nota_auditoria = FORMAT(
                    'Conciliado automáticamente por reconocimiento de remitente autorizado en %s a favor de %s (Comisión %s%%).',
                    v_tx.plataforma,
                    v_cliente.nombre_titular,
                    v_resolved_fee
                ),
                conciliado_at = NOW()
            WHERE id = v_tx.id;

            RETURN QUERY SELECT
                TRUE,
                'CONCILIADO'::VARCHAR(32),
                NULL::UUID,
                NULL::VARCHAR(64),
                v_cliente.id,
                v_cliente.nombre_titular,
                'AUTO_CLIENT_DIRECTORY'::VARCHAR(64),
                v_best_score,
                FORMAT('Conciliado automáticamente con cuenta de cliente %s', v_cliente.nombre_titular)::TEXT;
            RETURN;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PASO 3: Verificar si existe orden pendiente con mismo monto y plataforma (posible pago de tercero o ref errónea)
    -- -------------------------------------------------------------------------
    SELECT COUNT(*)
    INTO v_candidate_count
    FROM ordenes_pago_pendientes o
    WHERE o.estado = 'PENDIENTE'
      AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
      AND (o.plataforma_esperada = v_tx.plataforma OR v_tx.plataforma = 'OTRO')
      AND o.moneda = v_tx.moneda
      AND o.monto_esperado = v_tx.monto_bruto;

    IF v_candidate_count > 0 THEN
        UPDATE financial_transactions_reconciliation
        SET estado = 'REVISION_MANUAL',
            nota_auditoria = FORMAT(
                'Posible pago de tercero o referencia mal escrita: monto exacto (%s %s) en %s coincide con %s orden(es) pendiente(s), pero remitente ("%s") y referencia ("%s") no coinciden.',
                v_tx.monto_bruto,
                v_tx.moneda,
                v_tx.plataforma,
                v_candidate_count,
                COALESCE(v_tx.remitente_o_contraparte, 'Desconocido'),
                COALESCE(v_tx.referencia, 'SIN-REF')
            )
        WHERE id = v_tx.id;

        RETURN QUERY SELECT
            FALSE,
            'REVISION_MANUAL'::VARCHAR(32),
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::UUID,
            NULL::TEXT,
            'THIRD_PARTY_REVIEW'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Posible pago de tercero o referencia mal escrita. Marcado para revisión manual.'::TEXT;
        RETURN;
    END IF;

    IF v_tx.origen_deteccion = 'EMAIL_AI'
       OR v_norm_sender IN ('', 'desconocido', 'unknown', 'sin remitente', 'no especificado') THEN
        UPDATE financial_transactions_reconciliation
        SET estado = 'REVISION_MANUAL',
            nota_auditoria = 'Sin orden pendiente coincidente o extraído mediante AI Fallback. Pendiente de asignación manual.'
        WHERE id = v_tx.id;

        RETURN QUERY SELECT
            FALSE,
            'REVISION_MANUAL'::VARCHAR(32),
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::UUID,
            NULL::TEXT,
            'NO_MATCH_MANUAL_REVIEW'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Enviado a revisión manual.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        FALSE,
        v_tx.estado::VARCHAR(32),
        NULL::UUID,
        NULL::VARCHAR(64),
        NULL::UUID,
        NULL::TEXT,
        'NO_MATCH_YET'::VARCHAR(64),
        0.0000::NUMERIC(5,4),
        'Transacción registrada en estado DETECTADO en espera de reporte de pago del cliente.'::TEXT;
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

COMMIT;
