-- ============================================================================
-- core.ordenes_compra.mostrar_decimales — el precio unitario, con o sin
-- decimales (2026-09-24)
-- ============================================================================
-- Nicolás: "coloca un botón en las OC para elegir que salgan con decimales o
-- sin decimales".
--
-- Contexto: desde el 2026-09-22 el PDF imprime el precio unitario con sus
-- decimales ($67.142,86 en vez de $67.143) para que cantidad x precio dé
-- exactamente el importe de la línea. Es lo correcto para que el documento
-- cuadre solo, pero hay OC donde se prefiere la columna limpia.
--
-- Esta columna es SÓLO PRESENTACIÓN y sólo en pesos:
--   · no toca `precio_unitario` ni `total_linea` ni el neto/IVA/total;
--   · en UF y USD no aplica (ahí los centésimos son plata y se muestran
--     siempre).
-- Con FALSE el precio se imprime redondeado a peso, así que cantidad x precio
-- puede no dar el importe de la línea: es la decisión de quien emite.
--
-- Default TRUE: el silencio deja el documento como está hoy. Aditiva y
-- nullable-free (NOT NULL con default), el código viejo no la conoce y sigue
-- funcionando. Aplicar ANTES de desplegar el backend que la mapea en el ORM.
-- ============================================================================

BEGIN;

ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS mostrar_decimales BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN core.ordenes_compra.mostrar_decimales IS
    'Sólo presentación: si el PDF/ficha imprime el precio unitario con sus decimales (TRUE, default) o redondeado a peso (FALSE). No afecta montos: el importe de la línea y los totales no cambian. En UF/USD se ignora.';

DO $$
DECLARE
    v_tipo TEXT;
    v_nulos INT;
    v_default TEXT;
BEGIN
    SELECT data_type, column_default INTO v_tipo, v_default
      FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'ordenes_compra'
       AND column_name = 'mostrar_decimales';

    IF v_tipo IS NULL THEN
        RAISE EXCEPTION 'FAIL · falta core.ordenes_compra.mostrar_decimales';
    END IF;
    IF v_tipo <> 'boolean' THEN
        RAISE EXCEPTION 'FAIL · mostrar_decimales es % y debería ser boolean', v_tipo;
    END IF;
    IF v_default IS NULL OR v_default NOT ILIKE '%true%' THEN
        RAISE EXCEPTION 'FAIL · mostrar_decimales sin DEFAULT TRUE (default: %)', v_default;
    END IF;

    SELECT count(*) INTO v_nulos
      FROM core.ordenes_compra WHERE mostrar_decimales IS NULL;
    IF v_nulos > 0 THEN
        RAISE EXCEPTION 'FAIL · % OC con mostrar_decimales en NULL', v_nulos;
    END IF;

    RAISE NOTICE 'OK · mostrar_decimales BOOLEAN NOT NULL DEFAULT TRUE (% OC en TRUE)',
        (SELECT count(*) FROM core.ordenes_compra WHERE mostrar_decimales);
END $$;

COMMIT;
