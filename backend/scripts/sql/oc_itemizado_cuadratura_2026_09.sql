-- ============================================================================
-- Cuadratura del itemizado, parte 2 (2026-09-22)
-- ============================================================================
-- Complemento de oc_total_linea_2026_09.sql, después de la revisión
-- adversarial del arreglo:
--
--   1. La red de seguridad (trigger) redondeaba SIEMPRE a 2 decimales, sin
--      mirar la moneda. En pesos no existe el centavo: una línea que
--      entrara por ahí quedaba con centavos y volvía a descuadrar la
--      columna. Ahora respeta la moneda de la OC, igual que la app.
--
--   2. La OC 37 (OC0041-PAN001-Comercializadora los Canelos jv) es la única
--      cuyo neto NO es la suma de sus líneas: 544.873,99 contra 544.873.
--      Venía de sumar en crudo con centavos en una OC en pesos. Hasta ahora
--      el PDF truncaba y el papel cuadraba por casualidad; con el PDF
--      redondeando (que es lo correcto) el neto impreso subiría a $544.874
--      contra una columna de $544.873.
--      Se corrige a 544.873 / IVA 103.526 / total 648.399, que es
--      EXACTAMENTE lo que ya dice el PDF que recibió el proveedor
--      ($544.873 / $103.526 / $648.399): el documento no cambia, se
--      corrige la fila. Su cuota se alinea al mismo total. El voucher
--      asociado (126) está en DRAFT, sin líneas ni aprobaciones: no hay
--      plata girada ni asiento contable que mover.
--
-- Idempotente: si la OC 37 ya está cuadrada, no hace nada.
-- ============================================================================

-- (sin \set: este archivo también lo corre apply_pending_migrations.py,
--  que ejecuta SQL plano y no entiende los meta-comandos de psql.)

BEGIN;

-- 1. Trigger consciente de la moneda -----------------------------------------
CREATE OR REPLACE FUNCTION core.oc_detalle_completar_total_linea()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_moneda TEXT;
BEGIN
    IF NEW.total_linea IS NULL THEN
        SELECT upper(COALESCE(o.moneda, 'CLP')) INTO v_moneda
          FROM core.ordenes_compra o WHERE o.oc_id = NEW.oc_id;
        NEW.total_linea := CASE
            WHEN COALESCE(v_moneda, 'CLP') = 'CLP'
                THEN round(COALESCE(NEW.cantidad, 1) * COALESCE(NEW.precio_unitario, 0))
            ELSE round(COALESCE(NEW.cantidad, 1) * COALESCE(NEW.precio_unitario, 0), 2)
        END;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. La OC 37 al peso --------------------------------------------------------
DO $$
DECLARE
    v_neto NUMERIC;
    v_columna NUMERIC;
    v_estado TEXT;
BEGIN
    SELECT o.neto, o.estado, (SELECT sum(d.total_linea)
                                FROM core.ordenes_compra_detalle d
                               WHERE d.oc_id = o.oc_id)
      INTO v_neto, v_estado, v_columna
      FROM core.ordenes_compra o WHERE o.oc_id = 37;

    IF v_neto IS NULL THEN
        RAISE NOTICE 'OK · la OC 37 no existe en esta base, nada que hacer';
    ELSIF v_neto = v_columna THEN
        RAISE NOTICE 'OK · la OC 37 ya cuadra (%)', v_neto;
    ELSE
        -- Guard: sólo si la diferencia es de centavos y no hay plata girada.
        IF abs(v_neto - v_columna) >= 1 THEN
            RAISE EXCEPTION 'FAIL · la OC 37 difiere en % (más de un peso): revisar a mano',
                v_neto - v_columna;
        END IF;
        IF EXISTS (SELECT 1 FROM core.vouchers v
                    WHERE v.oc_id = 37
                      AND v.status IN ('APPROVED','EXECUTED','SYNCED','RECONCILED')) THEN
            RAISE EXCEPTION 'FAIL · la OC 37 tiene vouchers con plata: no se toca';
        END IF;

        UPDATE core.ordenes_compra
           SET neto = v_columna,
               iva = round(v_columna * iva_porcentaje / 100),
               total = v_columna + round(v_columna * iva_porcentaje / 100),
               total_a_pagar = v_columna + round(v_columna * iva_porcentaje / 100)
                               - COALESCE(retencion_monto, 0)
         WHERE oc_id = 37;

        UPDATE core.oc_cuotas c
           SET monto = round(o.total_a_pagar * COALESCE(c.porcentaje, 100) / 100),
               updated_at = now()
          FROM core.ordenes_compra o
         WHERE o.oc_id = 37 AND c.oc_id = 37;

        RAISE NOTICE 'OK · OC 37 cuadrada: neto % -> %', v_neto, v_columna;
    END IF;
END $$;

-- 3. Verificación ------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_mal INT := 0;
BEGIN
    FOR r IN
        SELECT o.oc_id, o.numero_oc, o.neto, sum(d.total_linea) AS columna
          FROM core.ordenes_compra o
          JOIN core.ordenes_compra_detalle d ON d.oc_id = o.oc_id
         GROUP BY o.oc_id
        HAVING sum(d.total_linea) <> o.neto
    LOOP
        v_mal := v_mal + 1;
        RAISE WARNING 'OC % (%): columna % vs neto %',
            r.oc_id, r.numero_oc, r.columna, r.neto;
    END LOOP;
    IF v_mal > 0 THEN
        RAISE EXCEPTION 'FAIL · % OC con la columna descuadrada contra el neto', v_mal;
    END IF;
    RAISE NOTICE 'OK · todas las OC: la columna suma exactamente el neto';

    FOR r IN
        SELECT oc_id, numero_oc, neto, total, total_a_pagar
          FROM core.ordenes_compra
         WHERE upper(COALESCE(moneda, 'CLP')) = 'CLP'
           AND (neto <> round(neto) OR total <> round(total)
                OR total_a_pagar <> round(total_a_pagar))
    LOOP
        RAISE EXCEPTION 'FAIL · OC % (%) en pesos con centavos: % / % / %',
            r.oc_id, r.numero_oc, r.neto, r.total, r.total_a_pagar;
    END LOOP;
    RAISE NOTICE 'OK · ninguna OC en pesos quedó con centavos';
END $$;

COMMIT;
