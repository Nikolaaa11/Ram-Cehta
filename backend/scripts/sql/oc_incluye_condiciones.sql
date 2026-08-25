-- ============================================================================
-- core.ordenes_compra.incluye_condiciones — condiciones generales opcionales
-- ============================================================================
-- Las "Condiciones generales" del PDF (las 4 cláusulas de arbitraje ante el
-- Centro de Arbitraje y Mediación de Santiago) están HARDCODEADAS en el
-- template y salen en TODAS las OC. Nicolás pidió poder incluirlas o sacarlas
-- por orden de compra.
--
-- Default TRUE, y a propósito: es una cláusula contractual: el silencio tiene
-- que dejar el documento como está hoy. Las 30 OC que ya existen quedan
-- exactamente igual, y sacar las condiciones pasa a ser un acto deliberado
-- del operador, no algo que ocurre por olvidarse de marcar una casilla.
--
-- NOT NULL: un tercer estado "no se sabe" sobre una cláusula de arbitraje no
-- significa nada. O está o no está.
--
-- Idempotente.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS incluye_condiciones BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN core.ordenes_compra.incluye_condiciones IS
    'Si el PDF imprime la sección "Condiciones generales" (cláusulas de '
    'arbitraje). Default TRUE: sacarlas es un acto deliberado.';

DO $$
DECLARE
    v_col   INT;
    v_null  INT;
    v_def   TEXT;
    v_false INT;
BEGIN
    SELECT count(*) INTO v_col
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'ordenes_compra'
       AND column_name = 'incluye_condiciones';
    IF v_col <> 1 THEN
        RAISE EXCEPTION 'FAIL · la columna no quedó creada';
    END IF;

    SELECT count(*) INTO v_null
      FROM core.ordenes_compra WHERE incluye_condiciones IS NULL;
    IF v_null > 0 THEN
        RAISE EXCEPTION 'FAIL · % filas con incluye_condiciones en NULL', v_null;
    END IF;

    SELECT column_default INTO v_def
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'ordenes_compra'
       AND column_name = 'incluye_condiciones';
    IF v_def IS NULL OR v_def NOT ILIKE '%true%' THEN
        RAISE EXCEPTION 'FAIL · el default no es TRUE (es %)', COALESCE(v_def, 'NULL');
    END IF;

    -- Ninguna OC existente puede haber quedado sin condiciones por el ALTER.
    SELECT count(*) INTO v_false
      FROM core.ordenes_compra WHERE incluye_condiciones = FALSE;
    IF v_false > 0 THEN
        RAISE EXCEPTION 'FAIL · % OC quedaron SIN condiciones tras el ALTER', v_false;
    END IF;

    RAISE NOTICE 'OK · incluye_condiciones BOOLEAN NOT NULL DEFAULT TRUE';
    RAISE NOTICE 'OK · las % OC existentes conservan sus condiciones generales',
                 (SELECT count(*) FROM core.ordenes_compra);
END $$;

COMMIT;
