-- ============================================================================
-- El itemizado de la OC tiene que sumar (2026-09-22)
-- ============================================================================
-- Nicolás: "hay OC que no se están sumando bien, en especial la
-- OC0059-PAN001-Comercializadora los Canelos".
--
-- Lo que pasaba:
--   1. `total_linea` NUNCA se escribía desde la pantalla (sólo el alta por
--      correo lo hacía). Las 39 OC de producción tenían la columna en NULL:
--      la ficha imprimía "$0" en cada línea y el total correcto abajo.
--   2. El PDF truncaba los importes en vez de redondearlos, así que la
--      columna impresa sumaba menos que el neto impreso (10 pesos en la
--      OC 96, 1 peso en las OC 52 y 74).
--
-- El código ya quedó arreglado (domain/value_objects/itemizado.py: la línea
-- se redondea al paso de la moneda y el neto es la SUMA de las líneas). Este
-- script arregla los datos que ya estaban:
--   · rellena `total_linea` de todas las líneas existentes;
--   · deja un trigger para que nunca más quede en NULL, aunque el que
--     inserte se olvide (la app igual manda el valor correcto por moneda).
--
-- NO toca montos de cabecera: la única OC cuyo neto no cuadra con la suma de
-- sus líneas es la 37 (99 centavos), y tiene una cuota con voucher generado
-- por $648.399,99 — mover eso es plata comprometida y se decide aparte.
--
-- Idempotente. Verifica y reporta al final.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. Relleno. En CLP no existe el centavo: la línea es un importe en pesos.
--    round() de Postgres redondea "half away from zero", igual que el
--    ROUND_HALF_UP del motor contable.
UPDATE core.ordenes_compra_detalle d
   SET total_linea = CASE
           WHEN upper(COALESCE(o.moneda, 'CLP')) = 'CLP'
               THEN round(d.cantidad * d.precio_unitario)
           ELSE round(d.cantidad * d.precio_unitario, 2)
       END
  FROM core.ordenes_compra o
 WHERE o.oc_id = d.oc_id
   AND d.total_linea IS NULL;

-- 2. Red de seguridad: si alguien inserta una línea sin importe, se calcula.
--    La app manda el valor ya redondeado por moneda (itemizado.py); esto
--    sólo cubre al que se olvide, para que la ficha nunca vuelva a mostrar
--    "$0" en una línea.
CREATE OR REPLACE FUNCTION core.oc_detalle_completar_total_linea()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.total_linea IS NULL THEN
        NEW.total_linea := round(
            COALESCE(NEW.cantidad, 1) * COALESCE(NEW.precio_unitario, 0), 2
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oc_detalle_total_linea ON core.ordenes_compra_detalle;
CREATE TRIGGER trg_oc_detalle_total_linea
    BEFORE INSERT OR UPDATE ON core.ordenes_compra_detalle
    FOR EACH ROW
    EXECUTE FUNCTION core.oc_detalle_completar_total_linea();

-- 3. Verificación
DO $$
DECLARE
    v_nulos INT;
    v_descuadre INT;
    r RECORD;
BEGIN
    SELECT count(*) INTO v_nulos
      FROM core.ordenes_compra_detalle WHERE total_linea IS NULL;
    IF v_nulos > 0 THEN
        RAISE EXCEPTION 'FAIL · quedaron % líneas sin total_linea', v_nulos;
    END IF;
    RAISE NOTICE 'OK · ninguna línea quedó sin importe';

    v_descuadre := 0;
    FOR r IN
        SELECT o.oc_id, o.numero_oc, o.estado, o.neto,
               sum(d.total_linea) AS columna
          FROM core.ordenes_compra o
          JOIN core.ordenes_compra_detalle d ON d.oc_id = o.oc_id
         GROUP BY o.oc_id
        HAVING sum(d.total_linea) <> o.neto
    LOOP
        v_descuadre := v_descuadre + 1;
        RAISE NOTICE 'OJO · OC % (%) %: columna % vs neto % (dif %)',
            r.oc_id, r.numero_oc, r.estado, r.columna, r.neto, r.neto - r.columna;
    END LOOP;
    RAISE NOTICE 'OK · % OC con la columna descuadrada contra el neto', v_descuadre;
END $$;

COMMIT;
