-- MEGAPROMPT OC · Boleta de honorarios y factura exenta — CAPA DE DATOS
-- =====================================================================
-- Contrato: docs/MEGAPROMPT_OC_HONORARIOS_EXENTA.md (§4.1).
--
-- Qué hace:
--   1. Amplía ck_oc_tipo_documento de FACTURA|BOLETA a los 4 tokens del
--      catálogo SII que ya usa core.vouchers.doc_tributario_tipo
--      (FACTURA | FACTURA_EXENTA | BOLETA | HONORARIOS). El mapeo
--      OC → voucher tiene que ser la IDENTIDAD: toda tabla de traducción
--      entre dos catálogos termina divergiendo.
--   2. Agrega retencion_porcentaje / retencion_monto / total_a_pagar a
--      core.ordenes_compra, backfillea total_a_pagar y lo pone NOT NULL.
--   3. Crea core.tax_config con vigencia POR FECHA y siembra la escala del
--      Art. 74 N°2 LIR (Ley 21.133) 2024→2028 más el IVA general.
--   4. Pone el CHECK de coherencia tributaria como red para los INSERT que
--      NO pasan por la API.
--
-- ⚠️ ORDEN DE APLICACIÓN: **ESTE SQL PRIMERO, EL DEPLOY DESPUÉS.**
--   Y ese orden es seguro sólo por el trigger del Paso 4b — sin él no hay
--   NINGÚN orden seguro, que es exactamente el agujero que encontró la
--   verificación adversarial de este cambio:
--     · deploy antes que SQL → el ORM mapea 3 columnas que la BD no tiene y
--       TODA lectura de OC muere con UndefinedColumn: listado, detalle, PDF,
--       firmas, cuotas, búsqueda. No es degradación, es el módulo caído.
--     · SQL antes que deploy → total_a_pagar NOT NULL sin default hace que
--       el repo viejo (y el INSERT crudo del inbox, que enumera columnas a
--       mano) tire NotNullViolation en toda alta de OC.
--   El trigger llena total_a_pagar cuando viene NULL, así el código viejo
--   sigue insertando sin saber que la columna existe. Es la única forma de
--   que la ventana entre el SQL y el deploy no rompa nada en ninguna de las
--   dos direcciones.
--   No se usa DEFAULT 0 porque un 0 por omisión es un monto silenciosamente
--   equivocado; el trigger deriva el valor CORRECTO (total − retención).
--
-- ⚠️ El deploy NO corre migraciones (release_command desactivado). Esto se
--   aplica A MANO y probablemente más de una vez: todo el script es
--   idempotente y reporta OK / SKIP / FAIL por paso. Un FAIL no aborta el
--   resto (cada paso corre en su propia subtransacción), así se ve el
--   cuadro completo en una sola pasada en vez de descubrir los problemas
--   de a uno.
--
-- Cómo correrlo:
--   Supabase Studio → SQL editor → pegar el archivo entero → Run.
--   El resultado es la tabla de reporte del final.

BEGIN;

-- ---------------------------------------------------------------------
-- Reporte OK/SKIP/FAIL
-- ---------------------------------------------------------------------
-- Tabla temporal en vez de sólo RAISE NOTICE porque el SQL editor de
-- Supabase no muestra los NOTICE: el reporte tiene que llegar como result
-- set o el operador no se entera de un SKIP. ON COMMIT DROP para no dejar
-- basura en la sesión del pooler — y por eso tampoco hace falta borrarla
-- antes: si una corrida anterior abortó, su CREATE se fue con el rollback.
CREATE TEMP TABLE _rep_oc_hon (
    n       SERIAL PRIMARY KEY,
    paso    TEXT NOT NULL,
    estado  TEXT NOT NULL,
    detalle TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._rep(
    p_paso TEXT, p_estado TEXT, p_detalle TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp._rep_oc_hon (paso, estado, detalle)
    VALUES (p_paso, p_estado, p_detalle);
    RAISE NOTICE '[%] % — %', p_estado, p_paso, COALESCE(p_detalle, '');
END;
$fn$;

-- ---------------------------------------------------------------------
-- Paso 0 · Foto del estado previo (para poder comparar después)
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_detalle TEXT;
    v_err     TEXT;
BEGIN
    SELECT COALESCE(string_agg(t.tipo || '=' || t.n, ', ' ORDER BY t.tipo),
                    'sin OCs')
      INTO v_detalle
      FROM (
        SELECT COALESCE(tipo_documento, '(null)') AS tipo, count(*)::TEXT AS n
          FROM core.ordenes_compra
         GROUP BY 1
      ) t;
    PERFORM pg_temp._rep('0 · estado previo', 'OK', v_detalle);
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('0 · estado previo', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 1 · ck_oc_tipo_documento → 4 tokens
-- ---------------------------------------------------------------------
-- Pre-chequeo antes de tocar el CHECK: si hubiera una fila con un token
-- fuera del catálogo, un DROP+ADD la dejaría sin constraint (el ADD falla
-- después del DROP). Se verifica primero y recién ahí se reemplaza.
DO $do$
DECLARE
    v_def TEXT;
    v_mal BIGINT;
    v_err TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conname = 'ck_oc_tipo_documento'
       AND conrelid = 'core.ordenes_compra'::regclass;

    IF v_def IS NOT NULL
       AND v_def LIKE '%HONORARIOS%'
       AND v_def LIKE '%FACTURA_EXENTA%' THEN
        PERFORM pg_temp._rep('1 · ck_oc_tipo_documento', 'SKIP',
                             'ya acepta los 4 tokens');
    ELSE
        SELECT count(*) INTO v_mal
          FROM core.ordenes_compra
         WHERE tipo_documento IS NULL
            OR tipo_documento NOT IN
               ('FACTURA', 'FACTURA_EXENTA', 'BOLETA', 'HONORARIOS');

        IF v_mal > 0 THEN
            PERFORM pg_temp._rep('1 · ck_oc_tipo_documento', 'FAIL',
                format('%s OC con tipo_documento fuera del catálogo — '
                       'normalizarlas antes de reintentar', v_mal));
        ELSE
            ALTER TABLE core.ordenes_compra
                DROP CONSTRAINT IF EXISTS ck_oc_tipo_documento;
            ALTER TABLE core.ordenes_compra
                ADD CONSTRAINT ck_oc_tipo_documento
                CHECK (tipo_documento IN
                       ('FACTURA', 'FACTURA_EXENTA', 'BOLETA', 'HONORARIOS'));
            PERFORM pg_temp._rep('1 · ck_oc_tipo_documento', 'OK',
                                 'ampliado desde FACTURA|BOLETA');
        END IF;
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('1 · ck_oc_tipo_documento', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 2 · Columnas nuevas en core.ordenes_compra
-- ---------------------------------------------------------------------
-- total_a_pagar nace NULLABLE a propósito: se backfillea en el paso 4 y se
-- endurece en el 5. Ponerla NOT NULL DEFAULT 0 de entrada dejaría las OC
-- existentes con "a pagar $0" hasta el UPDATE — un monto falso es peor que
-- un NULL, porque el NULL revienta y el 0 se muestra.
DO $do$
DECLARE
    v_esperadas TEXT[] := ARRAY['retencion_porcentaje',
                                'retencion_monto',
                                'total_a_pagar'];
    v_nuevas    TEXT[] := ARRAY[]::TEXT[];
    v_col       TEXT;
    v_err       TEXT;
BEGIN
    FOREACH v_col IN ARRAY v_esperadas LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'core'
               AND table_name = 'ordenes_compra'
               AND column_name = v_col
        ) THEN
            v_nuevas := v_nuevas || v_col;
        END IF;
    END LOOP;

    ALTER TABLE core.ordenes_compra
        ADD COLUMN IF NOT EXISTS retencion_porcentaje NUMERIC(5, 2)
            NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS retencion_monto NUMERIC(18, 2)
            NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_a_pagar NUMERIC(18, 2);

    IF array_length(v_nuevas, 1) IS NULL THEN
        PERFORM pg_temp._rep('2 · columnas retención/total_a_pagar', 'SKIP',
                             'las 3 columnas ya existían');
    ELSE
        PERFORM pg_temp._rep('2 · columnas retención/total_a_pagar', 'OK',
                             array_to_string(v_nuevas, ', '));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('2 · columnas retención/total_a_pagar', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 3 · CHECKs de rango de las columnas nuevas
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_hechos TEXT[] := ARRAY[]::TEXT[];
    v_err    TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_oc_retencion_porcentaje'
           AND conrelid = 'core.ordenes_compra'::regclass
    ) THEN
        ALTER TABLE core.ordenes_compra
            ADD CONSTRAINT ck_oc_retencion_porcentaje
            CHECK (retencion_porcentaje >= 0 AND retencion_porcentaje <= 100);
        v_hechos := v_hechos || 'ck_oc_retencion_porcentaje';
    END IF;

    -- Una retención negativa no existe: sería devolverle impuesto al
    -- prestador. Barato de chequear y atrapa un signo invertido en el
    -- cálculo antes de que llegue al voucher.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_oc_retencion_monto'
           AND conrelid = 'core.ordenes_compra'::regclass
    ) THEN
        ALTER TABLE core.ordenes_compra
            ADD CONSTRAINT ck_oc_retencion_monto
            CHECK (retencion_monto >= 0);
        v_hechos := v_hechos || 'ck_oc_retencion_monto';
    END IF;

    IF array_length(v_hechos, 1) IS NULL THEN
        PERFORM pg_temp._rep('3 · CHECKs de rango', 'SKIP', 'ya existían');
    ELSE
        PERFORM pg_temp._rep('3 · CHECKs de rango', 'OK',
                             array_to_string(v_hechos, ', '));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('3 · CHECKs de rango', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 4 · Backfill de total_a_pagar
-- ---------------------------------------------------------------------
-- Se backfillea con `total - retencion_monto` y no con `total` a secas:
-- es la identidad de la §3.3 del contrato, así que una re-corrida no puede
-- producir un valor incoherente aunque para el estado actual (retención 0
-- en todas las OC existentes) dé exactamente lo mismo.
DO $do$
DECLARE
    v_n   BIGINT;
    v_err TEXT;
BEGIN
    UPDATE core.ordenes_compra
       SET total_a_pagar = total - retencion_monto
     WHERE total_a_pagar IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        PERFORM pg_temp._rep('4 · backfill total_a_pagar', 'SKIP',
                             'no había filas con total_a_pagar NULL');
    ELSE
        PERFORM pg_temp._rep('4 · backfill total_a_pagar', 'OK',
                             format('%s OC backfilleadas', v_n));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('4 · backfill total_a_pagar', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 4b · Trigger que rellena total_a_pagar
-- ---------------------------------------------------------------------
-- Va ANTES del NOT NULL del paso 5, no después: si el NOT NULL entra sin
-- el trigger, hay una ventana —la que dure el deploy— en la que toda alta
-- de OC del código viejo falla.
--
-- Qué resuelve, además de la ventana de deploy: hay DOS creadores de OC en
-- el código y sólo uno pasa por el ORM. El otro es un INSERT crudo en
-- backend/app/services/auto_create_oc_from_inbox.py que enumera las
-- columnas a mano. Con el trigger, ese INSERT (y cualquier script, import
-- o SQL a mano futuro) no necesita enterarse de la columna nueva.
--
-- La derivación es la identidad de la §3.3 del contrato aplicada por
-- construcción: se resta, no se vuelve a redondear, así
-- total_a_pagar + retencion_monto = total cierra exacto siempre.
--
-- El trigger NO pisa un valor explícito: si quien inserta ya calculó
-- total_a_pagar (que es lo que hace la API), ese valor manda. Sólo actúa
-- cuando viene NULL.
DO $do$
DECLARE
    v_err TEXT;
BEGIN
    CREATE OR REPLACE FUNCTION core.oc_completar_total_a_pagar()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
        IF NEW.total_a_pagar IS NULL THEN
            NEW.total_a_pagar := COALESCE(NEW.total, 0)
                               - COALESCE(NEW.retencion_monto, 0);
        END IF;
        RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_oc_completar_total_a_pagar
        ON core.ordenes_compra;
    CREATE TRIGGER trg_oc_completar_total_a_pagar
        BEFORE INSERT OR UPDATE ON core.ordenes_compra
        FOR EACH ROW
        EXECUTE FUNCTION core.oc_completar_total_a_pagar();

    PERFORM pg_temp._rep('4b · trigger total_a_pagar', 'OK',
                         'rellena por resta cuando viene NULL; no pisa valor explícito');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('4b · trigger total_a_pagar', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 5 · total_a_pagar NOT NULL
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_notnull BOOLEAN;
    v_err     TEXT;
BEGIN
    SELECT a.attnotnull INTO v_notnull
      FROM pg_attribute a
     WHERE a.attrelid = 'core.ordenes_compra'::regclass
       AND a.attname = 'total_a_pagar'
       AND NOT a.attisdropped;

    IF v_notnull THEN
        PERFORM pg_temp._rep('5 · total_a_pagar NOT NULL', 'SKIP',
                             'ya era NOT NULL');
    ELSE
        ALTER TABLE core.ordenes_compra
            ALTER COLUMN total_a_pagar SET NOT NULL;
        PERFORM pg_temp._rep('5 · total_a_pagar NOT NULL', 'OK',
                             'sin DEFAULT — lo llena el trigger del paso 4b');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('5 · total_a_pagar NOT NULL', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 6 · CHECK de coherencia tributaria
-- ---------------------------------------------------------------------
-- La regla también vive en la API, pero acá es la red que atrapa los
-- INSERT/UPDATE que no pasan por la API (scripts, importadores, SQL a
-- mano). Se escribe como dos implicaciones independientes en vez de un
-- CASE con ELSE para no imponerle nada implícito a un quinto token que
-- aparezca mañana.
DO $do$
DECLARE
    v_mal BIGINT;
    v_err TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ck_oc_coherencia_tributaria'
           AND conrelid = 'core.ordenes_compra'::regclass
    ) THEN
        PERFORM pg_temp._rep('6 · ck_oc_coherencia_tributaria', 'SKIP',
                             'ya existía');
    ELSE
        SELECT count(*) INTO v_mal
          FROM core.ordenes_compra
         WHERE (tipo_documento IN ('HONORARIOS', 'FACTURA_EXENTA')
                AND iva_porcentaje <> 0)
            OR (tipo_documento <> 'HONORARIOS'
                AND retencion_porcentaje <> 0)
            OR total_a_pagar IS DISTINCT FROM total - retencion_monto;

        IF v_mal > 0 THEN
            PERFORM pg_temp._rep('6 · ck_oc_coherencia_tributaria', 'FAIL',
                format('%s OC incoherentes (exenta/honorarios con IVA, o '
                       'factura/boleta con retención) — corregirlas antes '
                       'de reintentar', v_mal));
        ELSE
            ALTER TABLE core.ordenes_compra
                ADD CONSTRAINT ck_oc_coherencia_tributaria CHECK (
                    -- exenta y honorarios no llevan IVA: el 19 viejo que
                    -- quedó pegado en el formulario no puede persistirse
                    (tipo_documento NOT IN ('HONORARIOS', 'FACTURA_EXENTA')
                     OR iva_porcentaje = 0)
                    -- sólo la boleta de honorarios retiene: una factura
                    -- SÓLO la boleta de honorarios retiene. Se escribe por
                    -- lista blanca (= 'HONORARIOS') y no por lista negra
                    -- (NOT IN ('FACTURA','BOLETA')): con lista negra,
                    -- FACTURA_EXENTA con retención pasaba el CHECK, y
                    -- cualquier token nuevo también pasaría. La lista negra
                    -- deja entrar todo lo que nadie enumeró.
                    AND (tipo_documento = 'HONORARIOS'
                         OR retencion_porcentaje = 0)
                    -- La identidad de la §3.3, en la BD. Es el ÚNICO CHECK
                    -- de este bloque que protege plata: los otros dos
                    -- protegen coherencia de metadatos, pero si esta se
                    -- rompe, lo que se gira no coincide con lo que se
                    -- comprometió. Va acá porque la red tiene que atrapar
                    -- también a los INSERT que no pasan por la API.
                    AND total_a_pagar = total - retencion_monto
                );
            PERFORM pg_temp._rep('6 · ck_oc_coherencia_tributaria', 'OK',
                                 'creado');
        END IF;
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('6 · ck_oc_coherencia_tributaria', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 7 · core.tax_config
-- ---------------------------------------------------------------------
-- Vigencia POR FECHA, no una fila por año con columna `anio`: la escala del
-- Art. 74 N°2 cambia el 1 de enero, y una tabla indexada por año obliga a
-- que alguien se acuerde de tocar la BD cada enero. Con rangos, el seed de
-- hoy ya responde bien en 2028.
DO $do$
DECLARE
    v_creada BOOLEAN := FALSE;
    v_err    TEXT;
BEGIN
    IF to_regclass('core.tax_config') IS NULL THEN
        v_creada := TRUE;
    END IF;

    CREATE TABLE IF NOT EXISTS core.tax_config (
        tax_config_id  SERIAL PRIMARY KEY,
        clave          TEXT NOT NULL,
        valor          NUMERIC(7, 4) NOT NULL,
        vigencia_desde DATE NOT NULL,
        vigencia_hasta DATE,
        descripcion    TEXT,
        fuente_legal   TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ck_tax_config_valor
            CHECK (valor >= 0 AND valor <= 100),
        CONSTRAINT ck_tax_config_vigencia
            CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
    );

    -- Índice ÚNICO sobre (clave, vigencia_desde). Hace dos trabajos y por
    -- eso no hay un segundo índice al lado: (a) impide dos tramos que
    -- arranquen el mismo día para la misma clave, que es el error de carga
    -- probable; (b) resuelve la consulta "tasa vigente al día X"
    -- (WHERE clave = $1 AND vigencia_desde <= $2 ORDER BY vigencia_desde
    -- DESC LIMIT 1) con un scan hacia atrás, sin índice adicional.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_config_clave_desde
        ON core.tax_config (clave, vigencia_desde);

    IF v_creada THEN
        PERFORM pg_temp._rep('7 · core.tax_config', 'OK', 'tabla + índice creados');
    ELSE
        PERFORM pg_temp._rep('7 · core.tax_config', 'SKIP', 'ya existía');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('7 · core.tax_config', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 8 · Seed de tasas
-- ---------------------------------------------------------------------
-- ON CONFLICT DO UPDATE y no DO NOTHING: estas tasas las fija la ley, no
-- el operador. Si alguien las editó a mano, la re-corrida del script las
-- devuelve al valor legal en vez de dejar el error sentado.
--
-- El tramo 2028 va con vigencia_hasta NULL a propósito: la escala de la
-- Ley 21.133 termina en 17% y ahí queda hasta que otra ley diga lo
-- contrario. Si cerráramos el rango el 31/12/2028, una OC de 2029 no
-- encontraría tasa.
--
-- No se siembran tramos anteriores a 2024 (el contrato pide 2024→2028):
-- una OC con fecha_emision < 2024-01-01 no va a encontrar tasa y la API
-- tiene que decidir qué hacer con eso — mejor que inventarle un número.
DO $do$
DECLARE
    v_antes  BIGINT;
    v_despues BIGINT;
    v_err    TEXT;
BEGIN
    SELECT count(*) INTO v_antes FROM core.tax_config;

    INSERT INTO core.tax_config
        (clave, valor, vigencia_desde, vigencia_hasta, descripcion, fuente_legal)
    VALUES
        ('RETENCION_HONORARIOS', 13.75, DATE '2024-01-01', DATE '2024-12-31',
         'Retención de segunda categoría sobre boletas de honorarios · 2024',
         'Art. 74 N°2 LIR · escala transitoria Ley 21.133'),
        ('RETENCION_HONORARIOS', 14.50, DATE '2025-01-01', DATE '2025-12-31',
         'Retención de segunda categoría sobre boletas de honorarios · 2025',
         'Art. 74 N°2 LIR · escala transitoria Ley 21.133'),
        ('RETENCION_HONORARIOS', 15.25, DATE '2026-01-01', DATE '2026-12-31',
         'Retención de segunda categoría sobre boletas de honorarios · 2026',
         'Art. 74 N°2 LIR · escala transitoria Ley 21.133'),
        ('RETENCION_HONORARIOS', 16.00, DATE '2027-01-01', DATE '2027-12-31',
         'Retención de segunda categoría sobre boletas de honorarios · 2027',
         'Art. 74 N°2 LIR · escala transitoria Ley 21.133'),
        ('RETENCION_HONORARIOS', 17.00, DATE '2028-01-01', NULL,
         'Retención de segunda categoría · 2028 en adelante (tasa final de '
         'la escala, sin fecha de término)',
         'Art. 74 N°2 LIR · escala transitoria Ley 21.133'),
        ('IVA_GENERAL', 19.00, DATE '2003-10-01', NULL,
         'IVA general vigente (19% desde octubre 2003)',
         'Art. 14 DL 825')
    ON CONFLICT (clave, vigencia_desde) DO UPDATE SET
        valor          = EXCLUDED.valor,
        vigencia_hasta = EXCLUDED.vigencia_hasta,
        descripcion    = EXCLUDED.descripcion,
        fuente_legal   = EXCLUDED.fuente_legal,
        updated_at     = now();

    SELECT count(*) INTO v_despues FROM core.tax_config;

    IF v_despues > v_antes THEN
        PERFORM pg_temp._rep('8 · seed de tasas', 'OK',
            format('%s filas nuevas (%s en total)', v_despues - v_antes, v_despues));
    ELSE
        PERFORM pg_temp._rep('8 · seed de tasas', 'SKIP',
            format('ya sembrado; %s filas reafirmadas al valor legal', v_despues));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('8 · seed de tasas', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 9 · COMMENT ON
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_err TEXT;
BEGIN
    -- tipo_documento no tenía comentario y ahora carga cuatro semánticas
    -- distintas: sin esto, el próximo que lea la tabla no tiene cómo saber
    -- que FACTURA_EXENTA no es "FACTURA con 0%".
    COMMENT ON COLUMN core.ordenes_compra.tipo_documento IS
        'Documento tributario que respalda la compra: FACTURA | '
        'FACTURA_EXENTA | BOLETA | HONORARIOS. El catálogo es IDÉNTICO al de '
        'core.vouchers.doc_tributario_tipo a propósito — el mapeo OC→voucher '
        'es la identidad, porque toda tabla de traducción entre dos catálogos '
        'termina divergiendo. Las etiquetas en castellano ("Boleta de '
        'honorarios", "Factura exenta") son PRESENTACIÓN: viven en el '
        'frontend y en el PDF, nunca en esta columna. FACTURA_EXENTA no es '
        'una FACTURA con iva_porcentaje=0: la exenta no genera crédito '
        'fiscal y se declara en otra línea del F29 y del RCV, así que si se '
        'guardaran iguales no habría forma de separarlas al conciliar contra '
        'el SII.';

    COMMENT ON COLUMN core.ordenes_compra.retencion_porcentaje IS
        'Tasa de retención de segunda categoría efectivamente aplicada a '
        'esta OC (Art. 74 N°2 LIR, escala Ley 21.133: 15,25% en 2026). Sólo '
        'HONORARIOS retiene — ck_oc_coherencia_tributaria impide cargarla en '
        'una factura o boleta afecta. Es un SNAPSHOT: se guarda la tasa '
        'aplicada y NO se re-deriva de core.tax_config, porque si el SII '
        'sube la tasa en 2027 las OC de 2026 tienen que seguir mostrando '
        '15,25%. OJO: 0 es un valor legítimo, nunca usar `or`/COALESCE para '
        'darle un default — Python trata 0 como falso y ese bug ya se '
        'cometió en esta misma tabla con iva_porcentaje.';

    COMMENT ON COLUMN core.ordenes_compra.retencion_monto IS
        'Plata retenida, en pesos: round(neto × retencion_porcentaje/100) '
        'con ROUND_HALF_UP. Es lo que el mandante NO le gira al profesional '
        'porque lo entera al SII por cuenta de él (contrapartida contable '
        '2105-04 RETENCIÓN PROFESIONALES). Se redondea ESTE monto y el '
        'líquido sale por resta: si se redondearan los dos por separado, la '
        'identidad total_a_pagar + retencion_monto = total no cerraría y el '
        'voucher no podría salir nunca de DRAFT (trigger de partida doble).';

    COMMENT ON COLUMN core.ordenes_compra.total_a_pagar IS
        'PLATA QUE SALE = total − retencion_monto. Es lo que tesorería gira '
        'y contra lo que tienen que cuadrar los hitos de core.oc_cuotas. En '
        'FACTURA, BOLETA y FACTURA_EXENTA coincide con total; sólo difiere '
        'en HONORARIOS. Regla de clasificación para cualquier consumidor '
        'nuevo: plata que sale (hitos, voucher de pago, flujo de caja, '
        '"cuánto le debo") → total_a_pagar; valor del contrato (umbral de '
        'aprobación, monto contratado, reportes de compromiso) → total. '
        'NOT NULL sin DEFAULT a propósito: un 0 por omisión sería un monto '
        'silenciosamente equivocado, y prefiere reventar el INSERT.';

    -- `total` no es columna nueva, pero este cambio le cambia el vecindario
    -- y la lectura ingenua ("total = lo que hay que pagar") pasa a ser un
    -- error de plata en honorarios. El comentario va donde se lo va a leer.
    COMMENT ON COLUMN core.ordenes_compra.total IS
        'VALOR DEL CONTRATO = neto + iva. Conserva su semántica histórica a '
        'propósito: NO es el líquido a girar. En una OC de HONORARIOS este '
        'número es el BRUTO y el profesional cobra total_a_pagar. '
        'Redefinirlo como líquido habría cambiado el significado de golpe en '
        'hitos, vouchers, flujo de caja, búsqueda global, exports, webhooks '
        'y PDF; por eso se agregó total_a_pagar y cada consumidor elige '
        'explícitamente cuál de los dos números quiere.';

    COMMENT ON TABLE core.tax_config IS
        'Tasas tributarias con vigencia POR FECHA (invariante 10: la tasa no '
        'vive hardcodeada ni en prosa). Consulta canónica de "tasa vigente '
        'al día X": SELECT valor FROM core.tax_config WHERE clave = $1 AND '
        'vigencia_desde <= $2 AND (vigencia_hasta IS NULL OR vigencia_hasta '
        '>= $2) ORDER BY vigencia_desde DESC LIMIT 1. El ORDER BY … LIMIT 1 '
        'deja la respuesta determinística incluso si alguien cargara dos '
        'tramos solapados (el índice único sólo impide que dos tramos '
        'arranquen el mismo día). Claves sembradas: RETENCION_HONORARIOS, '
        'IVA_GENERAL.';

    COMMENT ON COLUMN core.tax_config.clave IS
        'Identificador estable de la tasa (RETENCION_HONORARIOS, '
        'IVA_GENERAL). Texto y no enum: agregar una tasa nueva no debe '
        'requerir una migración de tipo.';
    COMMENT ON COLUMN core.tax_config.valor IS
        'La tasa EN PORCENTAJE (15.25, no 0.1525) — misma unidad que '
        'ordenes_compra.retencion_porcentaje e iva_porcentaje, para que '
        'copiar el valor a la OC no requiera convertir. La conversión a '
        'tasa la hace porcentaje_a_tasa() en el dominio.';
    COMMENT ON COLUMN core.tax_config.vigencia_desde IS
        'Primer día en que rige esta tasa, inclusive. Se compara contra la '
        'fecha de emisión de la OC, no contra now(): una OC cargada hoy con '
        'fecha del año pasado tiene que traer la tasa del año pasado.';
    COMMENT ON COLUMN core.tax_config.vigencia_hasta IS
        'Último día en que rige, inclusive. NULL = sin fecha de término '
        '(tramo abierto). El último tramo de una escala SIEMPRE debe quedar '
        'abierto, si no las fechas posteriores se quedan sin tasa.';
    COMMENT ON COLUMN core.tax_config.fuente_legal IS
        'Norma que fija la tasa. No es decorativo: cuando el contador '
        'pregunte por qué el sistema retuvo 15,25% y no 13,75%, la respuesta '
        'tiene que salir de la BD y no de la memoria de alguien.';

    PERFORM pg_temp._rep('9 · COMMENT ON', 'OK',
                         '5 columnas de ordenes_compra + tax_config');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('9 · COMMENT ON', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 10 · Verificación de la identidad de la §3.3
-- ---------------------------------------------------------------------
-- Cubre el punto del DoD "las OC existentes intactas y con
-- total_a_pagar = total": si esto no da 0, algo quedó descuadrado y hay
-- que arreglarlo antes de emitir la primera OC de honorarios.
DO $do$
DECLARE
    v_mal   BIGINT;
    v_total BIGINT;
    v_err   TEXT;
BEGIN
    SELECT count(*) FILTER (
               WHERE total_a_pagar IS DISTINCT FROM (total - retencion_monto)
           ),
           count(*)
      INTO v_mal, v_total
      FROM core.ordenes_compra;

    IF v_mal = 0 THEN
        PERFORM pg_temp._rep('10 · identidad total_a_pagar + retención', 'OK',
            format('%s OC cuadran', v_total));
    ELSE
        PERFORM pg_temp._rep('10 · identidad total_a_pagar + retención', 'FAIL',
            format('%s de %s OC descuadradas', v_mal, v_total));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('10 · identidad total_a_pagar + retención', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- REPORTE (este es el result set que hay que mirar)
-- ---------------------------------------------------------------------
SELECT paso, estado, COALESCE(detalle, '') AS detalle
  FROM pg_temp._rep_oc_hon
 ORDER BY n;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación manual (correr aparte, después del COMMIT)
-- ---------------------------------------------------------------------
-- -- Columnas y constraints:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'core' AND table_name = 'ordenes_compra'
--    AND column_name IN ('tipo_documento','iva_porcentaje',
--                        'retencion_porcentaje','retencion_monto',
--                        'total_a_pagar','total')
--  ORDER BY column_name;
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'core.ordenes_compra'::regclass AND contype = 'c'
--  ORDER BY conname;
--
-- -- Las OC existentes, intactas:
-- SELECT oc_id, numero_oc, tipo_documento, neto, iva, total,
--        retencion_porcentaje, retencion_monto, total_a_pagar
--   FROM core.ordenes_compra ORDER BY oc_id;
--
-- -- Tasa vigente hoy (la consulta canónica; debe dar 15.25 en 2026):
-- SELECT valor FROM core.tax_config
--  WHERE clave = 'RETENCION_HONORARIOS'
--    AND vigencia_desde <= CURRENT_DATE
--    AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
--  ORDER BY vigencia_desde DESC LIMIT 1;
--
-- -- La escala completa:
-- SELECT clave, valor, vigencia_desde, vigencia_hasta
--   FROM core.tax_config ORDER BY clave, vigencia_desde;
