-- ============================================================================
-- PANIMAVIDA — dirección actualizada a "Lote 3 LT 1"
-- ============================================================================
-- Nicolás pidió que las OC salgan con «Panimávida PC 3 Lote 3 LT 1, Colbún».
--
-- Contrastado contra el e-RUT del SII que adjuntó (serie 202608753143,
-- emitido 02-09-2026), que declara la casa matriz como:
--
--     PP PANIMAVIDA PC 3 LOTE 3 LT 1 NULL COLBUN
--
-- O sea: el "LT 1" es real y venía faltando. La dirección que se IMPRIME usa
-- la redacción que pidió Nicolás (sin el prefijo "PP" del padrón, que en el
-- bloque Mandante de una OC no aporta); el literal del SII queda aparte en
-- `direccion_sii`, que existe justamente para conservar el texto del padrón
-- sin ensuciar el documento.
--
-- El template arma la línea como `direccion, ciudad`, así que con
-- direccion='Panimávida PC 3 Lote 3 LT 1' y ciudad='Colbún' el PDF imprime
-- exactamente la frase pedida.
--
-- ⚠️ TECMAVIDA NO se toca. Comparte predio pero su propio e-RUT
-- (202608636254) dice «PANIMAVIDA PC 3 LOTE 3» SIN el "LT 1": son
-- direcciones distintas ante el SII y copiar una sobre la otra sería
-- inventar el domicilio de un contribuyente.
--
-- Idempotente. Reporta OK/FAIL.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_antes TEXT;
    v_n     INT;
BEGIN
    SELECT direccion INTO v_antes FROM core.empresas WHERE codigo = 'PANIMAVIDA';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL · no existe la empresa PANIMAVIDA';
    END IF;
    RAISE NOTICE 'ANTES · %', v_antes;

    UPDATE core.empresas
       SET direccion     = 'Panimávida PC 3 Lote 3 LT 1',
           ciudad        = 'Colbún',
           -- Literal del padrón, para trazar contra el e-RUT sin imprimirlo.
           direccion_sii = 'PP PANIMAVIDA PC 3 LOTE 3 LT 1, COLBUN',
           updated_at    = now()
     WHERE codigo = 'PANIMAVIDA';

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FAIL · el UPDATE tocó % filas, esperaba 1', v_n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verificación: la línea que va a imprimir el PDF, y que TECMAVIDA quedó igual
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    e   RECORD;
    v_t TEXT;
BEGIN
    SELECT direccion, ciudad, direccion_sii INTO e
      FROM core.empresas WHERE codigo = 'PANIMAVIDA';

    IF e.direccion || ', ' || e.ciudad <> 'Panimávida PC 3 Lote 3 LT 1, Colbún' THEN
        RAISE EXCEPTION 'FAIL · el PDF imprimiría «%»', e.direccion || ', ' || e.ciudad;
    END IF;

    SELECT direccion INTO v_t FROM core.empresas WHERE codigo = 'TECMAVIDA';
    IF v_t <> 'Panimávida PC 3 Lote 3' THEN
        RAISE EXCEPTION 'FAIL · se tocó la dirección de TECMAVIDA (quedó «%»)', v_t;
    END IF;

    RAISE NOTICE 'OK · el PDF de PANIMAVIDA imprime: %', e.direccion || ', ' || e.ciudad;
    RAISE NOTICE 'OK · direccion_sii (padrón): %', e.direccion_sii;
    RAISE NOTICE 'OK · TECMAVIDA intacta: %', v_t;
END $$;

COMMIT;
