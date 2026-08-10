-- HALLAZGO CRÍTICO · Los triggers contables NUNCA se crearon en producción
-- =====================================================================
-- Encontrado 2026-08-10 por la verificación adversarial del megaprompt
-- "voucher desde OC". NO es un defecto de esa ronda: es un agujero que
-- estaba vivo desde siempre y que nadie había mirado.
--
-- Qué pasa hoy:
--   · Las FUNCIONES core.enforce_partida_doble, core.enforce_cuenta_imputable,
--     core.prevent_voucher_in_closed_period y su hermana de líneas EXISTEN.
--   · Los TRIGGERS que las disparan NO. Quedaron sólo en
--     alembic/versions/0035_vouchers_core.py, que nunca corrió contra esta BD
--     (alembic_version está en round152_dashboard_institucional y el
--     release_command del deploy está desactivado).
--   · Verificado: 0 filas en pg_trigger para esas funciones. En todo el
--     schema core hay 4 triggers no internos y ninguno es contable.
--
-- Por qué importa:
--   `submit_voucher` (app/api/v1/vouchers.py) documenta textualmente
--   "Líneas cuadran (Σ debit == Σ credit) — el trigger DB lo valida" y NO
--   hace la validación en Python. O sea: un voucher descuadrado podía pasar
--   DRAFT → PENDING → 2 firmas → APPROVED sin que ninguna capa lo notara.
--   Eso es el invariante 1 del SUPER_PROMPT_MAESTRO —la partida doble— sin
--   red de ningún tipo.
--
-- Este script instala los 4 triggers usando las funciones que ya están, y
-- ANTES de cada uno verifica que los datos existentes no lo violen (si lo
-- violaran, el CREATE no falla —los triggers no validan hacia atrás— pero el
-- próximo UPDATE de esa fila sí, y es mejor enterarse ahora).
--
-- Idempotente: DROP TRIGGER IF EXISTS + CREATE. Se puede correr N veces.
-- Aplicar en Supabase Studio → SQL editor → pegar entero → Run.

BEGIN;

CREATE TEMP TABLE _rep_trg (
    n SERIAL PRIMARY KEY, paso TEXT NOT NULL, estado TEXT NOT NULL, detalle TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._rep(p_paso TEXT, p_estado TEXT, p_detalle TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp._rep_trg (paso, estado, detalle) VALUES (p_paso, p_estado, p_detalle);
END;
$fn$;

-- ---------------------------------------------------------------------
-- Paso 0 · Foto previa
-- ---------------------------------------------------------------------
DO $do$
DECLARE v_n INT; v_err TEXT;
BEGIN
    SELECT count(*) INTO v_n
      FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE NOT tg.tgisinternal
       AND p.proname IN ('enforce_partida_doble', 'enforce_cuenta_imputable',
                         'prevent_voucher_in_closed_period',
                         'prevent_voucher_lines_in_closed_period');
    PERFORM pg_temp._rep('0 · triggers contables presentes ANTES', 'OK', v_n::TEXT);
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('0 · foto previa', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 1 · Pre-chequeo: ¿hay datos que violarían los triggers?
-- ---------------------------------------------------------------------
-- Los triggers son BEFORE INSERT/UPDATE: no validan las filas que ya están.
-- Pero una fila que hoy los violaría queda "congelada" (el próximo UPDATE
-- falla), así que conviene saberlo antes de instalarlos y no descubrirlo
-- cuando alguien intente aprobar un voucher.
DO $do$
DECLARE
    v_descuadrados BIGINT;
    v_no_imputables BIGINT;
    v_detalle TEXT;
    v_err TEXT;
BEGIN
    SELECT count(*) INTO v_descuadrados
      FROM core.vouchers v
     WHERE v.status <> 'DRAFT'
       AND COALESCE((SELECT SUM(l.debit)  FROM core.voucher_lines l WHERE l.voucher_id = v.voucher_id), 0)
        <> COALESCE((SELECT SUM(l.credit) FROM core.voucher_lines l WHERE l.voucher_id = v.voucher_id), 0);

    SELECT count(*) INTO v_no_imputables
      FROM core.voucher_lines l
      LEFT JOIN core.plan_cuentas pc ON pc.codigo = l.cuenta_codigo
     WHERE pc.codigo IS NULL OR NOT pc.imputable;

    v_detalle := format('vouchers no-DRAFT descuadrados=%s · líneas con cuenta inexistente o no imputable=%s',
                        v_descuadrados, v_no_imputables);

    IF v_descuadrados > 0 OR v_no_imputables > 0 THEN
        PERFORM pg_temp._rep('1 · pre-chequeo de datos', 'ATENCION', v_detalle ||
            ' — los triggers igual se instalan (no validan hacia atrás), pero estas filas van a fallar en su próximo UPDATE');
    ELSE
        PERFORM pg_temp._rep('1 · pre-chequeo de datos', 'OK', v_detalle);
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('1 · pre-chequeo de datos', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 2 · Cuenta imputable (líneas)
-- ---------------------------------------------------------------------
-- Impide que una línea apunte a una cuenta que no existe o que es de
-- agrupación (sólo nivel 4 acepta imputación).
DO $do$
DECLARE v_err TEXT;
BEGIN
    DROP TRIGGER IF EXISTS trg_voucher_lines_cuenta_imputable ON core.voucher_lines;
    CREATE TRIGGER trg_voucher_lines_cuenta_imputable
        BEFORE INSERT OR UPDATE ON core.voucher_lines
        FOR EACH ROW EXECUTE FUNCTION core.enforce_cuenta_imputable();
    PERFORM pg_temp._rep('2 · trg_voucher_lines_cuenta_imputable', 'OK', 'instalado');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('2 · trg_voucher_lines_cuenta_imputable', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 3 · Partida doble  ← EL IMPORTANTE
-- ---------------------------------------------------------------------
-- Permite descuadre en DRAFT (mientras se editan las líneas) y lo bloquea
-- al salir de DRAFT. Además sincroniza total_debit/total_credit del header,
-- que hoy los escribe Python y nadie recalcula.
DO $do$
DECLARE v_err TEXT;
BEGIN
    DROP TRIGGER IF EXISTS trg_voucher_partida_doble ON core.vouchers;
    CREATE TRIGGER trg_voucher_partida_doble
        BEFORE UPDATE ON core.vouchers
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status
              OR OLD.total_debit IS DISTINCT FROM NEW.total_debit
              OR OLD.total_credit IS DISTINCT FROM NEW.total_credit)
        EXECUTE FUNCTION core.enforce_partida_doble();
    PERFORM pg_temp._rep('3 · trg_voucher_partida_doble', 'OK',
                         'instalado — invariante 1 vuelve a tener red en BD');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('3 · trg_voucher_partida_doble', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 4 · Bloqueo de período cerrado (vouchers y líneas)
-- ---------------------------------------------------------------------
-- Inocuos mientras `empresas.locked_period_end_date` sea NULL: la función
-- devuelve OK y no molesta. Se instalan igual para que el día que se cierre
-- un período la protección ya esté puesta y no haya que acordarse.
DO $do$
DECLARE v_cerradas BIGINT; v_err TEXT;
BEGIN
    SELECT count(*) INTO v_cerradas
      FROM core.empresas WHERE locked_period_end_date IS NOT NULL;

    DROP TRIGGER IF EXISTS trg_voucher_period_lock ON core.vouchers;
    CREATE TRIGGER trg_voucher_period_lock
        BEFORE UPDATE OR DELETE ON core.vouchers
        FOR EACH ROW EXECUTE FUNCTION core.prevent_voucher_in_closed_period();

    PERFORM pg_temp._rep('4 · trg_voucher_period_lock', 'OK',
        format('instalado · empresas con período cerrado hoy: %s', v_cerradas));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('4 · trg_voucher_period_lock', 'FAIL', v_err);
END;
$do$;

DO $do$
DECLARE v_err TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core' AND p.proname = 'prevent_voucher_lines_in_closed_period'
    ) THEN
        PERFORM pg_temp._rep('5 · trg_voucher_lines_period_lock', 'SKIP',
                             'la función no existe en esta BD');
    ELSE
        DROP TRIGGER IF EXISTS trg_voucher_lines_period_lock ON core.voucher_lines;
        CREATE TRIGGER trg_voucher_lines_period_lock
            BEFORE INSERT OR UPDATE OR DELETE ON core.voucher_lines
            FOR EACH ROW EXECUTE FUNCTION core.prevent_voucher_lines_in_closed_period();
        PERFORM pg_temp._rep('5 · trg_voucher_lines_period_lock', 'OK', 'instalado');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('5 · trg_voucher_lines_period_lock', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 6 · Foto posterior
-- ---------------------------------------------------------------------
DO $do$
DECLARE v_lista TEXT; v_err TEXT;
BEGIN
    SELECT string_agg(tg.tgname, ', ' ORDER BY tg.tgname) INTO v_lista
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT tg.tgisinternal AND n.nspname = 'core'
       AND c.relname IN ('vouchers', 'voucher_lines');
    PERFORM pg_temp._rep('6 · triggers en vouchers/voucher_lines DESPUÉS', 'OK',
                         COALESCE(v_lista, 'ninguno'));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('6 · foto posterior', 'FAIL', v_err);
END;
$do$;

SELECT paso, estado, detalle FROM pg_temp._rep_trg ORDER BY n;

COMMIT;
