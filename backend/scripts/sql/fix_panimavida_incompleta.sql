-- PANIMAVIDA quedó a medio crear · descubierto 2026-08-17
-- =====================================================================
-- El alta de PANIMAVIDA (megaprompt_oc_panimavida_porcentajes.sql) copió
-- `empresa_equipo` y `user_company_roles` desde RHO, y NADA MÁS. Le faltan la
-- regla de aprobación y las áreas.
--
-- Consecuencia real, no teórica: `find_matching_rule` no encuentra regla y
-- `POST /vouchers/{id}/approve` responde 400 «No hay regla de aprobación
-- configurada para este voucher». O sea que un voucher de PANIMAVIDA **no se
-- puede aprobar**. Y ya hay movimiento cargado ahí: la OC de honorarios
-- OC0042-PANI001 y el voucher PANIMAVIDA-2026-COM-00001.
--
-- Sin áreas tampoco se puede completar la imputación triple
-- (cuenta × proyecto × área) de un gasto operativo.
--
-- Se copia de RHO, que es de donde salió PANIMAVIDA en su alta original.
-- Idempotente: se puede correr las veces que haga falta.

BEGIN;

CREATE TEMP TABLE _rep_pan (
    n SERIAL PRIMARY KEY, paso TEXT NOT NULL, estado TEXT NOT NULL, detalle TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._rep(p_paso TEXT, p_estado TEXT, p_detalle TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp._rep_pan (paso, estado, detalle) VALUES (p_paso, p_estado, p_detalle);
END;
$fn$;

-- Paso 0 · foto previa
DO $do$
DECLARE v_r INT; v_a INT; v_err TEXT;
BEGIN
    SELECT count(*) INTO v_r FROM core.approval_rules
     WHERE empresa_codigo='PANIMAVIDA' AND active;
    SELECT count(*) INTO v_a FROM core.area_empresa
     WHERE empresa_codigo='PANIMAVIDA' AND aplica;
    PERFORM pg_temp._rep('0 · estado previo', 'OK',
        format('reglas=%s areas=%s', v_r, v_a));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('0 · estado previo', 'FAIL', v_err);
END;
$do$;

-- Paso 1 · regla de aprobación, copiada de RHO
DO $do$
DECLARE v_n INT; v_err TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM core.approval_rules
                WHERE empresa_codigo='PANIMAVIDA' AND active) THEN
        PERFORM pg_temp._rep('1 · regla de aprobación', 'SKIP', 'ya tenía');
    ELSE
        INSERT INTO core.approval_rules
               (empresa_codigo, voucher_tipo, min_amount, max_amount,
                balance_treatment, required_roles, reinforced, priority,
                active, descripcion)
        SELECT 'PANIMAVIDA', voucher_tipo, min_amount, max_amount,
               balance_treatment, required_roles, reinforced, priority,
               active, descripcion
          FROM core.approval_rules WHERE empresa_codigo='RHO' AND active;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        PERFORM pg_temp._rep('1 · regla de aprobación', 'OK',
            format('%s regla(s) copiada(s) de RHO — 2 firmas GG+DIRECTOR', v_n));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('1 · regla de aprobación', 'FAIL', v_err);
END;
$do$;

-- Paso 2 · áreas, copiadas de RHO
DO $do$
DECLARE v_n INT; v_err TEXT;
BEGIN
    INSERT INTO core.area_empresa (empresa_codigo, area_codigo, aplica)
    SELECT 'PANIMAVIDA', area_codigo, aplica
      FROM core.area_empresa WHERE empresa_codigo='RHO'
    ON CONFLICT (empresa_codigo, area_codigo) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_temp._rep('2 · áreas', CASE WHEN v_n > 0 THEN 'OK' ELSE 'SKIP' END,
        format('%s área(s) insertada(s) desde RHO', v_n));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('2 · áreas', 'FAIL', v_err);
END;
$do$;

-- Paso 3 · verificación CON PISO (un EXCEPT entre vacíos también da 0)
DO $do$
DECLARE v_r INT; v_a INT; v_err TEXT;
BEGIN
    SELECT count(*) INTO v_r FROM core.approval_rules
     WHERE empresa_codigo='PANIMAVIDA' AND active;
    SELECT count(*) INTO v_a FROM core.area_empresa
     WHERE empresa_codigo='PANIMAVIDA' AND aplica;
    IF v_r > 0 AND v_a > 0 THEN
        PERFORM pg_temp._rep('3 · verificación', 'OK',
            format('PANIMAVIDA ya puede aprobar vouchers · reglas=%s areas=%s', v_r, v_a));
    ELSE
        PERFORM pg_temp._rep('3 · verificación', 'FAIL',
            format('SIGUE INCOMPLETA · reglas=%s areas=%s', v_r, v_a));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('3 · verificación', 'FAIL', v_err);
END;
$do$;

SELECT paso, estado, COALESCE(detalle, '') AS detalle FROM pg_temp._rep_pan ORDER BY n;

COMMIT;
