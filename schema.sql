-- =============================================================================
-- FINTECH BANK RECONCILIATION SCHEMA (CITIBANK & TD BANK ZELLE / TRANSFERS)
-- Motor: PostgreSQL 15+
-- =============================================================================

BEGIN;

-- 1. Extensiones requeridas para UUIDs, búsqueda difusa (trigramas) y normalización
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Tabla de Clientes / Titulares de Cuenta (Cuentas de Usuarios y Remitentes Zelle Autorizados)
CREATE TABLE IF NOT EXISTS clientes_titulares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_titular TEXT NOT NULL,
    email_contacto VARCHAR(255),
    telefono VARCHAR(64),
    remitentes_zelle_habituales TEXT,
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabla de Buzones de Correo IMAP Monitoreados (Citibank / TD Bank Alerts)
CREATE TABLE IF NOT EXISTS imap_monitored_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias VARCHAR(120) NOT NULL DEFAULT 'Bandeja Principal Zelle',
    email_address VARCHAR(255) UNIQUE NOT NULL,
    imap_host VARCHAR(255) NOT NULL DEFAULT 'imap.gmail.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    imap_secure BOOLEAN NOT NULL DEFAULT TRUE,
    imap_password TEXT NOT NULL,
    mailbox_folder VARCHAR(120) NOT NULL DEFAULT 'INBOX',
    bancos_monitoreados VARCHAR(64) NOT NULL DEFAULT 'CITIBANK_Y_TD_BANK',
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabla de Órdenes de Pago Pendientes (Reportes de pago creados por usuarios/clientes)
CREATE TABLE IF NOT EXISTS ordenes_pago_pendientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_orden VARCHAR(64) UNIQUE NOT NULL,
    cliente_id UUID NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_email VARCHAR(255) NOT NULL,
    nombre_remitente_reportado TEXT NOT NULL,
    banco_destino VARCHAR(32) DEFAULT 'CITIBANK' CHECK (banco_destino IN ('CITIBANK', 'TD_BANK', 'OTRO')),
    monto_esperado NUMERIC(12,2) NOT NULL CHECK (monto_esperado > 0),
    referencia_reportada VARCHAR(128),
    estado VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONCILIADO', 'EXPIRADO', 'CANCELADO')),
    alerta_conciliada_id UUID,
    conciliado_por VARCHAR(64),
    score_similitud NUMERIC(5,4),
    conciliado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Tabla Principal: Alertas de Correo Bancario (Idempotente por message_id)
CREATE TABLE IF NOT EXISTS bank_email_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(512) UNIQUE NOT NULL,
    banco VARCHAR(32) NOT NULL CHECK (banco IN ('CITIBANK', 'TD_BANK', 'OTRO')),
    tipo_movimiento VARCHAR(32) NOT NULL CHECK (tipo_movimiento IN ('RECIBIDO', 'ENVIADO')),
    monto_bruto NUMERIC(12,2) NOT NULL CHECK (monto_bruto > 0),
    porcentaje_comision NUMERIC(5,2) NOT NULL DEFAULT 4.00 CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100),
    monto_comision NUMERIC(12,2) GENERATED ALWAYS AS (
        ROUND(monto_bruto * (porcentaje_comision / 100.0), 2)
    ) STORED,
    monto_neto NUMERIC(12,2) GENERATED ALWAYS AS (
        monto_bruto - ROUND(monto_bruto * (porcentaje_comision / 100.0), 2)
    ) STORED,
    remitente_o_destinatario TEXT,
    referencia VARCHAR(128),
    fecha_transaccion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_body TEXT,
    metodo_extraccion VARCHAR(32) NOT NULL CHECK (metodo_extraccion IN ('REGEX', 'AI_FALLBACK')),
    estado VARCHAR(32) NOT NULL DEFAULT 'DETECTADO' CHECK (estado IN ('DETECTADO', 'CONCILIADO', 'REVISION_MANUAL')),
    orden_pago_id UUID REFERENCES ordenes_pago_pendientes(id) ON DELETE SET NULL,
    cliente_asignado_nombre TEXT,
    notas_conciliacion TEXT,
    conciliado_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Índices de Alto Rendimiento e Idempotencia
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_alerts_message_id
    ON bank_email_alerts (message_id);

CREATE INDEX IF NOT EXISTS idx_bank_alerts_estado_banco_fecha
    ON bank_email_alerts (estado, banco, tipo_movimiento, fecha_transaccion DESC);

CREATE INDEX IF NOT EXISTS idx_bank_alerts_monto_referencia
    ON bank_email_alerts (monto_bruto, referencia);

CREATE INDEX IF NOT EXISTS idx_bank_alerts_remitente_trgm
    ON bank_email_alerts USING GIN (remitente_o_destinatario gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ordenes_pendientes_matching
    ON ordenes_pago_pendientes (estado, monto_esperado, referencia_reportada)
    WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS idx_ordenes_remitente_trgm
    ON ordenes_pago_pendientes USING GIN (nombre_remitente_reportado gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ordenes_cliente_trgm
    ON ordenes_pago_pendientes USING GIN (cliente_nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clientes_titulares_nombre_trgm
    ON clientes_titulares USING GIN (nombre_titular gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_clientes_titulares_remitentes_trgm
    ON clientes_titulares USING GIN (remitentes_zelle_habituales gin_trgm_ops);

-- =============================================================================
-- 7. FUNCIÓN PL/pgSQL: fn_conciliar_pago_zelle
-- Intenta conciliar automáticamente una alerta bancaria entrante contra:
--  1) ordenes_pago_pendientes por monto_bruto exacto + referencia
--  2) ordenes_pago_pendientes por monto_bruto exacto + similitud pg_trgm
--  3) clientes_titulares por coincidencia directa de remitente Zelle registrado
-- =============================================================================
CREATE OR REPLACE FUNCTION fn_conciliar_pago_zelle(p_alert_id UUID)
RETURNS TABLE (
    conciliado BOOLEAN,
    nuevo_estado VARCHAR(32),
    orden_pago_id UUID,
    codigo_orden VARCHAR(64),
    cliente_nombre TEXT,
    metodo_match VARCHAR(64),
    score_similitud NUMERIC(5,4),
    mensaje TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_alert bank_email_alerts%ROWTYPE;
    v_orden ordenes_pago_pendientes%ROWTYPE;
    v_cliente clientes_titulares%ROWTYPE;
    v_candidate_count INTEGER := 0;
    v_best_score NUMERIC(5,4) := 0;
    v_norm_ref VARCHAR(128);
    v_norm_sender TEXT;
BEGIN
    -- Bloquear la alerta para evitar condiciones de carrera entre workers
    SELECT *
    INTO v_alert
    FROM bank_email_alerts
    WHERE id = p_alert_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alerta bancaria % no encontrada', p_alert_id;
    END IF;

    -- Si ya está conciliada, devolver estado actual de forma idempotente
    IF v_alert.estado = 'CONCILIADO' THEN
        RETURN QUERY SELECT
            TRUE,
            v_alert.estado,
            v_alert.orden_pago_id,
            NULL::VARCHAR(64),
            v_alert.cliente_asignado_nombre,
            'ALREADY_RECONCILED'::VARCHAR(64),
            1.0000::NUMERIC(5,4),
            'La alerta ya se encontraba conciliada previamente.'::TEXT;
        RETURN;
    END IF;

    -- Solo conciliamos automáticamente ingresos (RECIBIDO)
    IF v_alert.tipo_movimiento <> 'RECIBIDO' THEN
        RETURN QUERY SELECT
            FALSE,
            v_alert.estado,
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::TEXT,
            'SKIPPED_OUTGOING'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Movimiento saliente (ENVIADO); no requiere conciliación de depósito.'::TEXT;
        RETURN;
    END IF;

    v_norm_ref := UPPER(REGEXP_REPLACE(COALESCE(v_alert.referencia, ''), '[^A-Z0-9]', '', 'g'));
    v_norm_sender := UPPER(unaccent(TRIM(COALESCE(v_alert.remitente_o_destinatario, ''))));

    -- -------------------------------------------------------------------------
    -- PASO 1: Match determinístico por Monto Bruto Exacto + Referencia Bancaria
    -- -------------------------------------------------------------------------
    IF LENGTH(v_norm_ref) >= 4 THEN
        SELECT o.*
        INTO v_orden
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND o.monto_esperado = v_alert.monto_bruto
          AND (
              UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) = v_norm_ref
              OR (
                  LENGTH(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g'))) >= 6
                  AND RIGHT(v_norm_ref, 6) = RIGHT(UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')), 6)
              )
          )
        ORDER BY o.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;

        IF FOUND THEN
            UPDATE ordenes_pago_pendientes
            SET estado = 'CONCILIADO',
                alerta_conciliada_id = v_alert.id,
                conciliado_por = 'AUTO_EXACT_REF',
                score_similitud = 1.0000,
                conciliado_at = NOW(),
                updated_at = NOW()
            WHERE id = v_orden.id;

            UPDATE bank_email_alerts
            SET estado = 'CONCILIADO',
                orden_pago_id = v_orden.id,
                cliente_asignado_nombre = v_orden.cliente_nombre,
                notas_conciliacion = FORMAT('Conciliación automática exacta por monto ($%s) y referencia (%s) con orden %s.', v_alert.monto_bruto, v_alert.referencia, v_orden.codigo_orden),
                conciliado_at = NOW()
            WHERE id = v_alert.id;

            RETURN QUERY SELECT
                TRUE,
                'CONCILIADO'::VARCHAR(32),
                v_orden.id,
                v_orden.codigo_orden,
                v_orden.cliente_nombre,
                'AUTO_EXACT_REF'::VARCHAR(64),
                1.0000::NUMERIC(5,4),
                FORMAT('Conciliado por referencia exacta con orden %s', v_orden.codigo_orden)::TEXT;
            RETURN;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PASO 2: Match difuso por Monto Bruto Exacto + Similitud de Nombre (pg_trgm)
    -- -------------------------------------------------------------------------
    IF LENGTH(v_norm_sender) >= 3 THEN
        SELECT COUNT(*)
        INTO v_candidate_count
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND o.monto_esperado = v_alert.monto_bruto
          AND GREATEST(
              similarity(UPPER(unaccent(COALESCE(o.nombre_remitente_reportado, ''))), v_norm_sender),
              similarity(UPPER(unaccent(COALESCE(o.cliente_nombre, ''))), v_norm_sender)
          ) >= 0.45;

        IF v_candidate_count = 1 THEN
            SELECT o.*
            INTO v_orden
            FROM ordenes_pago_pendientes o
            WHERE o.estado = 'PENDIENTE'
              AND o.monto_esperado = v_alert.monto_bruto
              AND GREATEST(
                  similarity(UPPER(unaccent(COALESCE(o.nombre_remitente_reportado, ''))), v_norm_sender),
                  similarity(UPPER(unaccent(COALESCE(o.cliente_nombre, ''))), v_norm_sender)
              ) >= 0.45
            LIMIT 1
            FOR UPDATE SKIP LOCKED;

            IF FOUND THEN
                v_best_score := GREATEST(
                    similarity(UPPER(unaccent(COALESCE(v_orden.nombre_remitente_reportado, ''))), v_norm_sender),
                    similarity(UPPER(unaccent(COALESCE(v_orden.cliente_nombre, ''))), v_norm_sender)
                )::NUMERIC(5,4);

                UPDATE ordenes_pago_pendientes
                SET estado = 'CONCILIADO',
                    alerta_conciliada_id = v_alert.id,
                    conciliado_por = 'AUTO_TRGM_NAME',
                    score_similitud = v_best_score,
                    conciliado_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_orden.id;

                UPDATE bank_email_alerts
                SET estado = 'CONCILIADO',
                    orden_pago_id = v_orden.id,
                    cliente_asignado_nombre = v_orden.cliente_nombre,
                    notas_conciliacion = FORMAT(
                        'Conciliación automática por monto ($%s) y similitud de remitente (%s%%) con orden %s.',
                        v_alert.monto_bruto,
                        ROUND(v_best_score * 100, 1),
                        v_orden.codigo_orden
                    ),
                    conciliado_at = NOW()
                WHERE id = v_alert.id;

                RETURN QUERY SELECT
                    TRUE,
                    'CONCILIADO'::VARCHAR(32),
                    v_orden.id,
                    v_orden.codigo_orden,
                    v_orden.cliente_nombre,
                    'AUTO_TRGM_NAME'::VARCHAR(64),
                    v_best_score,
                    FORMAT('Conciliado por similitud de nombre (%s%%) con orden %s', ROUND(v_best_score * 100, 1), v_orden.codigo_orden)::TEXT;
                RETURN;
            END IF;
        ELSIF v_candidate_count > 1 THEN
            UPDATE bank_email_alerts
            SET estado = 'REVISION_MANUAL',
                notas_conciliacion = FORMAT(
                    'Ambigüedad detectada: existen %s órdenes pendientes por $%s con similitud de nombre. Requiere asignación manual.',
                    v_candidate_count,
                    v_alert.monto_bruto
                )
            WHERE id = v_alert.id;

            RETURN QUERY SELECT
                FALSE,
                'REVISION_MANUAL'::VARCHAR(32),
                NULL::UUID,
                NULL::VARCHAR(64),
                NULL::TEXT,
                'AMBIGUOUS_CANDIDATES'::VARCHAR(64),
                0.0000::NUMERIC(5,4),
                FORMAT('Múltiples candidatos (%s) para el monto $%s. Marcado para revisión manual.', v_candidate_count, v_alert.monto_bruto)::TEXT;
            RETURN;
        END IF;

        -- ---------------------------------------------------------------------
        -- PASO 2.5: Reconocimiento directo contra Directorio de Clientes (clientes_titulares)
        -- Si el remitente Zelle está registrado como titular o remitente autorizado de un cliente
        -- ---------------------------------------------------------------------
        SELECT c.*
        INTO v_cliente
        FROM clientes_titulares c
        WHERE c.activo = TRUE
          AND (
              similarity(UPPER(unaccent(c.nombre_titular)), v_norm_sender) >= 0.55
              OR UPPER(unaccent(COALESCE(c.remitentes_zelle_habituales, ''))) LIKE '%' || v_norm_sender || '%'
          )
        ORDER BY similarity(UPPER(unaccent(c.nombre_titular)), v_norm_sender) DESC
        LIMIT 1;

        IF FOUND THEN
            v_best_score := GREATEST(
                similarity(UPPER(unaccent(v_cliente.nombre_titular)), v_norm_sender),
                0.8500
            )::NUMERIC(5,4);

            UPDATE bank_email_alerts
            SET estado = 'CONCILIADO',
                porcentaje_comision = v_cliente.porcentaje_comision,
                cliente_asignado_nombre = v_cliente.nombre_titular,
                notas_conciliacion = FORMAT(
                    'Conciliado automáticamente por reconocimiento de remitente Zelle registrado a favor de %s (Comisión %s%%).',
                    v_cliente.nombre_titular,
                    v_cliente.porcentaje_comision
                ),
                conciliado_at = NOW()
            WHERE id = v_alert.id;

            RETURN QUERY SELECT
                TRUE,
                'CONCILIADO'::VARCHAR(32),
                NULL::UUID,
                NULL::VARCHAR(64),
                v_cliente.nombre_titular,
                'AUTO_CLIENT_DIRECTORY'::VARCHAR(64),
                v_best_score,
                FORMAT('Conciliado automáticamente con cuenta de cliente %s', v_cliente.nombre_titular)::TEXT;
            RETURN;
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PASO 3: Verificar si existe orden por el mismo monto pero de un tercero
    -- -------------------------------------------------------------------------
    SELECT COUNT(*)
    INTO v_candidate_count
    FROM ordenes_pago_pendientes o
    WHERE o.estado = 'PENDIENTE'
      AND o.monto_esperado = v_alert.monto_bruto;

    IF v_candidate_count > 0 THEN
        UPDATE bank_email_alerts
        SET estado = 'REVISION_MANUAL',
            notas_conciliacion = FORMAT(
                'Monto exacto ($%s) coincide con %s orden(es) pendiente(s), pero el remitente Zelle ("%s") no coincide con el titular ni referencia. Posible pago de tercero.',
                v_alert.monto_bruto,
                v_candidate_count,
                COALESCE(v_alert.remitente_o_destinatario, 'Desconocido')
            )
        WHERE id = v_alert.id;

        RETURN QUERY SELECT
            FALSE,
            'REVISION_MANUAL'::VARCHAR(32),
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::TEXT,
            'THIRD_PARTY_REVIEW'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Monto coincide con orden pendiente pero remitente difiere del titular. Requiere revisión manual.'::TEXT;
        RETURN;
    END IF;

    IF v_alert.metodo_extraccion = 'AI_FALLBACK' OR v_alert.remitente_o_destinatario IS NULL THEN
        UPDATE bank_email_alerts
        SET estado = 'REVISION_MANUAL',
            notas_conciliacion = 'Sin orden pendiente coincidente o extraído mediante AI Fallback. Pendiente de asignación manual.'
        WHERE id = v_alert.id;

        RETURN QUERY SELECT
            FALSE,
            'REVISION_MANUAL'::VARCHAR(32),
            NULL::UUID,
            NULL::VARCHAR(64),
            NULL::TEXT,
            'NO_MATCH_MANUAL_REVIEW'::VARCHAR(64),
            0.0000::NUMERIC(5,4),
            'Enviado a revisión manual.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        FALSE,
        v_alert.estado,
        NULL::UUID,
        NULL::VARCHAR(64),
        NULL::TEXT,
        'NO_MATCH_YET'::VARCHAR(64),
        0.0000::NUMERIC(5,4),
        'Alerta registrada en estado DETECTADO en espera de reporte de pago del cliente.'::TEXT;
END;
$$;

COMMIT;
