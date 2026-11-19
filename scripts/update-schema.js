const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '..', 'schema.sql');
let content = fs.readFileSync(schemaPath, 'utf8');

const marker = '-- 7. FUNCIÓN PL/pgSQL BIDIRECCIONAL: fn_auto_conciliar_transaccion';
const endMarker = '-- Función wrapper retrocompatible';

const startIdx = content.indexOf(marker);
const endIdx = content.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found', { startIdx, endIdx });
  process.exit(1);
}

const newSql = `-- 7. FUNCIONES PL/pgSQL DE COTEJO Y CONCILIACIÓN
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

    -- -------------------------------------------------------------------------
    -- PASO 1: Cotejo por Referencia Bancaria Exacta o Substring Alfanumérico
    -- -------------------------------------------------------------------------
    IF NOT v_is_order_ref_generic THEN
        SELECT t.*
        INTO v_tx
        FROM financial_transactions_reconciliation t
        WHERE t.estado <> 'CONCILIADO'
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
    -- PASO 2: Cotejo por Remitente Estricto (similarity >= 0.60)
    -- Solo si la orden o el banco no tienen referencia (SIN-REF) y sin contradecirse
    -- -------------------------------------------------------------------------
    IF LENGTH(v_clean_order_sender) >= 3 THEN
        SELECT t.*
        INTO v_tx
        FROM financial_transactions_reconciliation t
        WHERE t.estado <> 'CONCILIADO'
          AND t.tipo_movimiento = 'RECIBIDO'
          AND t.moneda = v_orden.moneda
          AND t.monto_bruto = v_orden.monto_esperado
          AND (t.negocio_id IS NOT DISTINCT FROM v_orden.negocio_id OR t.negocio_id IS NULL OR v_orden.negocio_id IS NULL)
          -- REGLA CRUCIAL: No emparejar si ambos tienen referencias incompatibles reales
          AND (
              v_is_order_ref_generic
              OR t.referencia IS NULL
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) IN ('SINREF', 'NOREF', 'NA', 'NONE', 'NULL')
              OR UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_clean_order_ref || '%'
              OR v_clean_order_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(t.referencia, ''), '[^A-Z0-9]', '', 'g')) || '%'
          )
          AND (
              similarity(LOWER(unaccent(TRIM(COALESCE(t.remitente_o_contraparte, '')))), v_clean_order_sender) >= 0.60
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

    -- PASO 2: Buscar si un cliente ya reportó una orden con este remitente (similarity >= 0.60)
    IF LENGTH(v_norm_sender) >= 3 THEN
        SELECT o.*
        INTO v_orden
        FROM ordenes_pago_pendientes o
        WHERE o.estado = 'PENDIENTE'
          AND o.moneda = v_tx.moneda
          AND o.monto_esperado = v_tx.monto_bruto
          AND (o.negocio_id IS NOT DISTINCT FROM v_tx.negocio_id OR o.negocio_id IS NULL OR v_tx.negocio_id IS NULL)
          -- Sin referencias contradictorias
          AND (
              v_is_ref_generic
              OR o.referencia_reportada IS NULL
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) IN ('SINREF', 'NOREF', 'NA', 'NONE', 'NULL')
              OR v_norm_ref LIKE '%' || UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) || '%'
              OR UPPER(REGEXP_REPLACE(COALESCE(o.referencia_reportada, ''), '[^A-Z0-9]', '', 'g')) LIKE '%' || v_norm_ref || '%'
          )
          AND (
              similarity(LOWER(unaccent(TRIM(COALESCE(o.remitente_reportado, o.nombre_remitente_reportado, '')))), v_norm_sender) >= 0.60
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
`;

content = content.slice(0, startIdx) + newSql + '\n\n' + content.slice(endIdx);
fs.writeFileSync(schemaPath, content, 'utf8');
console.log('Successfully updated schema.sql');
