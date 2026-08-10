-- MEGAPROMPT VOUCHER DESDE OC — CAPA DE DATOS
-- =====================================================================
-- Contrato: docs/MEGAPROMPT_VOUCHER_DESDE_OC.md (§1 y §3).
--
-- ⚠️ LEER ESTO ANTES DE CORRERLO: en producción este script es CASI UN
--   NO-OP, y eso es a propósito. Se verificó contra la BD viva (2026-08-10)
--   que `core.vouchers.oc_id` YA existe, YA tiene su FK
--   (`vouchers_oc_id_fkey`, ON DELETE SET NULL) y YA tiene su índice parcial
--   (`idx_vouchers_oc`): los aplicó la migración 0068_oc_firmas. Lo que
--   faltaba no era schema, era que el ORM y los schemas Pydantic conocieran
--   la columna — eso se arregla en el código, no acá.
--   Los pasos 1 a 3 van a reportar SKIP en producción. Están igual porque:
--     · `public.alembic_version` quedó en 'round152_dashboard_institucional',
--       o sea NO refleja que 0068 corrió (el deploy tiene el release_command
--       desactivado y las migraciones se aplican a mano). El puntero de
--       alembic no sirve como prueba de nada, así que el script verifica
--       contra el catálogo de Postgres y no contra alembic.
--     · Cualquier entorno que no sea esta base (una restaurada del respaldo,
--       una de pruebas) puede tener la columna sin el índice o sin la FK.
--   El ÚNICO paso que cambia algo en producción hoy es el 4 (COMMENT ON):
--   la columna no tenía comentario y está por dejar de ser un detalle
--   interno de oc_cuotas.py para pasar a ser plata trazable desde la API.
--
-- Lo que este script deliberadamente NO hace, y por qué:
--
--   · NO crea un índice nuevo. La consulta "¿esta OC ya tiene voucher?"
--     (WHERE oc_id = $1) la resuelve `idx_vouchers_oc`, que ya existe y es
--     parcial (WHERE oc_id IS NOT NULL) — con 3 vouchers y 1 con OC, el
--     índice está sobredimensionado, no falto. Agregar otro sería basura que
--     hay que mantener y que ralentiza cada INSERT de voucher.
--
--   · NO crea un UNIQUE sobre vouchers(oc_id), ni siquiera parcial. Sería
--     ACTIVAMENTE DAÑINO: una OC con hitos genera un voucher POR HITO
--     (oc_cuotas.generar-vouchers), así que varios vouchers comparten oc_id
--     legítimamente. Un UNIQUE ahí rompería el pago en cuotas, que es el
--     caso normal, para atajar un caso que ni siquiera atajaría.
--
--   · NO crea un UNIQUE sobre oc_cuotas(voucher_id). "Un hito no puede tener
--     dos vouchers" YA está garantizado por construcción: voucher_id es una
--     columna escalar, un hito apunta a un voucher y punto. Lo que un UNIQUE
--     ahí impediría es lo inverso (dos hitos compartiendo un voucher), que
--     no es el riesgo del contrato.
--
--     ⚠️ El agujero real de duplicados NO se tapa con una constraint, y lo
--     dejo dicho acá porque es plata: si un hito vuelve a PENDIENTE (voucher
--     anulado) y se regenera, `oc_cuotas.voucher_id` se pisa con el voucher
--     nuevo y el VIEJO queda con su oc_id puesto pero sin ningún hito
--     apuntándole. Si ese viejo no se anuló de verdad, quedan dos vouchers
--     vivos para el mismo hito y la BD no puede verlo — para la BD son dos
--     vouchers de la misma OC, que es un estado legítimo. El paso 6 los
--     cuenta para que se vean; taparlo es trabajo de la API.
--
-- ⚠️ El deploy NO corre migraciones (release_command desactivado). Esto se
--   aplica A MANO y probablemente más de una vez: todo el script es
--   idempotente y reporta OK / SKIP / FAIL por paso. Un FAIL no aborta el
--   resto (cada paso corre en su propia subtransacción), así se ve el cuadro
--   completo en una sola pasada.
--
-- ORDEN DE APLICACIÓN: indistinto. No hay ventana peligrosa como en
--   megaprompt_oc_honorarios_exenta.sql, porque acá no se agrega ninguna
--   columna NOT NULL ni se endurece nada: el código viejo no se entera y el
--   código nuevo sólo necesita una columna que ya está.
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
-- basura en la sesión del pooler.
CREATE TEMP TABLE _rep_voucher_oc (
    n       SERIAL PRIMARY KEY,
    paso    TEXT NOT NULL,
    estado  TEXT NOT NULL,
    detalle TEXT
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp._rep(
    p_paso TEXT, p_estado TEXT, p_detalle TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp._rep_voucher_oc (paso, estado, detalle)
    VALUES (p_paso, p_estado, p_detalle);
    RAISE NOTICE '[%] % — %', p_estado, p_paso, COALESCE(p_detalle, '');
END;
$fn$;

-- ---------------------------------------------------------------------
-- Paso 0 · Foto del estado previo
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_total   BIGINT;
    v_con_oc  BIGINT;
    v_ocs     BIGINT;
    v_err     TEXT;
BEGIN
    SELECT count(*), count(oc_id), count(DISTINCT oc_id)
      INTO v_total, v_con_oc, v_ocs
      FROM core.vouchers;

    PERFORM pg_temp._rep('0 · estado previo', 'OK',
        format('%s vouchers, %s con oc_id, sobre %s OC distintas',
               v_total, v_con_oc, v_ocs));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('0 · estado previo', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 1 · Columna core.vouchers.oc_id
-- ---------------------------------------------------------------------
-- Nullable y sin DEFAULT, y así se queda: la enorme mayoría de los vouchers
-- no nacen de una OC (sueldos, traspasos, cierres). Un DEFAULT acá sería
-- inventar una OC de origen.
DO $do$
DECLARE
    v_existia BOOLEAN;
    v_err     TEXT;
BEGIN
    v_existia := EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'core'
           AND table_name = 'vouchers'
           AND column_name = 'oc_id'
    );

    ALTER TABLE core.vouchers ADD COLUMN IF NOT EXISTS oc_id BIGINT;

    IF v_existia THEN
        PERFORM pg_temp._rep('1 · columna oc_id', 'SKIP',
                             'ya existía (0068_oc_firmas)');
    ELSE
        PERFORM pg_temp._rep('1 · columna oc_id', 'OK', 'BIGINT nullable creada');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('1 · columna oc_id', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 2 · FK vouchers_oc_id_fkey → core.ordenes_compra(oc_id)
-- ---------------------------------------------------------------------
-- Una FK sobre una columna CON DATOS falla si hay un solo huérfano, y falla
-- después de haber tomado el lock — por eso se cuenta primero y recién ahí
-- se decide. Con huérfanos NO se crea: se reporta el número para que alguien
-- mire esas filas. Limpiarlas automáticamente sería borrar el vínculo entre
-- un asiento y su orden de compra sin que nadie lo haya decidido.
--
-- ON DELETE SET NULL y no CASCADE: borrar una OC no puede llevarse puesto el
-- asiento contable que la respalda. Un voucher huérfano se re-vincula; uno
-- borrado deja un agujero en el correlativo y en el libro.
--
-- El nombre se fija explícitamente al que Postgres ya generó en producción
-- (vouchers_oc_id_fkey) para que la re-corrida lo reconozca y saltee.
DO $do$
DECLARE
    v_huerfanos BIGINT;
    v_err       TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'core.vouchers'::regclass
           AND contype = 'f'
           AND pg_get_constraintdef(oid) LIKE '%(oc_id)%REFERENCES core.ordenes_compra%'
    ) THEN
        PERFORM pg_temp._rep('2 · FK oc_id → ordenes_compra', 'SKIP',
                             'ya existía (0068_oc_firmas)');
    ELSE
        SELECT count(*) INTO v_huerfanos
          FROM core.vouchers v
         WHERE v.oc_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM core.ordenes_compra o
                            WHERE o.oc_id = v.oc_id);

        IF v_huerfanos > 0 THEN
            PERFORM pg_temp._rep('2 · FK oc_id → ordenes_compra', 'FAIL',
                format('%s voucher(s) apuntan a una OC inexistente — '
                       'revisarlos a mano antes de reintentar; la FK NO se '
                       'creó', v_huerfanos));
        ELSE
            ALTER TABLE core.vouchers
                ADD CONSTRAINT vouchers_oc_id_fkey
                FOREIGN KEY (oc_id) REFERENCES core.ordenes_compra(oc_id)
                ON DELETE SET NULL;
            PERFORM pg_temp._rep('2 · FK oc_id → ordenes_compra', 'OK',
                                 'creada con ON DELETE SET NULL');
        END IF;
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('2 · FK oc_id → ordenes_compra', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 3 · Índice idx_vouchers_oc
-- ---------------------------------------------------------------------
-- Parcial (WHERE oc_id IS NOT NULL) porque la enorme mayoría de los vouchers
-- tiene oc_id NULL y ninguna consulta busca "los que no tienen OC": indexar
-- esos NULL sería pagar espacio y escrituras por filas que nadie va a mirar.
-- Resuelve las dos consultas del flujo nuevo: "¿esta OC ya tiene voucher?" y
-- "traeme los vouchers de esta OC".
DO $do$
DECLARE
    v_existia BOOLEAN;
    v_err     TEXT;
BEGIN
    v_existia := EXISTS (
        SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'core' AND c.relname = 'idx_vouchers_oc'
    );

    CREATE INDEX IF NOT EXISTS idx_vouchers_oc
        ON core.vouchers (oc_id)
     WHERE oc_id IS NOT NULL;

    IF v_existia THEN
        PERFORM pg_temp._rep('3 · idx_vouchers_oc', 'SKIP',
                             'ya existía (0068_oc_firmas)');
    ELSE
        PERFORM pg_temp._rep('3 · idx_vouchers_oc', 'OK', 'índice parcial creado');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('3 · idx_vouchers_oc', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 4 · COMMENT ON — el único paso que hace algo en producción
-- ---------------------------------------------------------------------
-- La columna no tenía comentario (verificado: col_description = NULL). Hasta
-- hoy era un detalle interno de oc_cuotas.py; a partir de este megaprompt es
-- el vínculo que la API lee y escribe, y de él cuelga la pregunta "¿esta OC
-- ya se pagó?". El próximo que abra la tabla tiene que poder contestar solo
-- por qué la columna no es única.
DO $do$
DECLARE
    v_err TEXT;
BEGIN
    COMMENT ON COLUMN core.vouchers.oc_id IS
        'Orden de compra que origina este asiento. NULL = el voucher no viene '
        'de una OC (sueldos, traspasos, cierres, gastos sueltos): es el caso '
        'mayoritario, por eso la columna es nullable y sin DEFAULT. '
        'NO ES ÚNICA Y NO PUEDE SERLO: una OC con hitos de pago genera un '
        'voucher POR HITO (core.oc_cuotas), así que varios vouchers comparten '
        'oc_id legítimamente — un UNIQUE acá rompería el pago en cuotas. '
        'El vínculo con el HITO no vive en esta tabla: es '
        'core.oc_cuotas.voucher_id, y como es escalar, un hito no puede tener '
        'dos vouchers. Para saber de qué hito viene un voucher hay que ir por '
        'oc_cuotas, no hay columna cuota_id acá. '
        'FK ON DELETE SET NULL: borrar una OC deja el voucher huérfano, nunca '
        'lo borra — el asiento contable sobrevive a su respaldo. '
        'REGLA DE PLATA para todo consumidor nuevo: el voucher de un hito se '
        'arma sobre el LÍQUIDO (ordenes_compra.total_a_pagar prorrateado en '
        'oc_cuotas.monto), no sobre ordenes_compra.total, que en HONORARIOS '
        'es el BRUTO. Confundirlos gira de más el monto de la retención.';

    PERFORM pg_temp._rep('4 · COMMENT ON vouchers.oc_id', 'OK',
                         'documentada: por qué no es única y cuál es el monto correcto');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('4 · COMMENT ON vouchers.oc_id', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 5 · Verificación de integridad referencial
-- ---------------------------------------------------------------------
-- Redundante mientras la FK esté puesta, y por eso mismo vale: si algún día
-- alguien la dropea para hacer una carga masiva y se olvida de reponerla,
-- este paso lo canta.
DO $do$
DECLARE
    v_huerfanos BIGINT;
    v_con_oc    BIGINT;
    v_err       TEXT;
BEGIN
    SELECT count(*) FILTER (
               WHERE NOT EXISTS (SELECT 1 FROM core.ordenes_compra o
                                  WHERE o.oc_id = v.oc_id)
           ),
           count(*)
      INTO v_huerfanos, v_con_oc
      FROM core.vouchers v
     WHERE v.oc_id IS NOT NULL;

    IF v_huerfanos = 0 THEN
        PERFORM pg_temp._rep('5 · integridad voucher → OC', 'OK',
            format('%s voucher(s) con oc_id, todos apuntan a una OC real',
                   v_con_oc));
    ELSE
        PERFORM pg_temp._rep('5 · integridad voucher → OC', 'FAIL',
            format('%s de %s vouchers con oc_id apuntan a una OC inexistente',
                   v_huerfanos, v_con_oc));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('5 · integridad voucher → OC', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 6 · Diagnóstico de duplicados potenciales (NO corrige nada)
-- ---------------------------------------------------------------------
-- Dos números que la BD no puede juzgar sola, y que hay que mirar ANTES de
-- que el flujo nuevo empiece a crear vouchers desde OC:
--
--   (a) OC con más de un voucher vivo. Es LEGÍTIMO si la OC tiene hitos
--       (un voucher por cuota) y es un DUPLICADO si no los tiene. La BD no
--       distingue; el operador sí.
--   (b) Vouchers con oc_id vivo a los que NINGÚN hito apunta. Son o bien
--       "voucher directo de una OC sin cuotas" (legítimo), o bien el resto
--       de una regeneración: el hito volvió a PENDIENTE, se generó un
--       voucher nuevo, oc_cuotas.voucher_id se pisó y el viejo quedó vivo
--       sin que nadie lo apunte. Ese segundo caso es un pago duplicado
--       esperando y no hay constraint que lo atrape.
--
-- VOID y REJECTED quedan fuera del conteo: un voucher anulado no paga nada.
DO $do$
DECLARE
    v_ocs_multi  BIGINT;
    v_sin_hito   BIGINT;
    v_err        TEXT;
BEGIN
    SELECT count(*) INTO v_ocs_multi
      FROM (
        SELECT oc_id
          FROM core.vouchers
         WHERE oc_id IS NOT NULL
           AND status NOT IN ('VOID', 'REJECTED')
         GROUP BY oc_id
        HAVING count(*) > 1
      ) t;

    SELECT count(*) INTO v_sin_hito
      FROM core.vouchers v
     WHERE v.oc_id IS NOT NULL
       AND v.status NOT IN ('VOID', 'REJECTED')
       AND NOT EXISTS (SELECT 1 FROM core.oc_cuotas c
                        WHERE c.voucher_id = v.voucher_id);

    PERFORM pg_temp._rep('6 · diagnóstico duplicados', 'OK',
        format('%s OC con más de un voucher vivo (normal si tienen hitos); '
               '%s voucher(s) vivos con oc_id que ningún hito apunta '
               '(revisar: pueden ser restos de una regeneración)',
               v_ocs_multi, v_sin_hito));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('6 · diagnóstico duplicados', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- REPORTE (este es el result set que hay que mirar)
-- ---------------------------------------------------------------------
SELECT paso, estado, COALESCE(detalle, '') AS detalle
  FROM pg_temp._rep_voucher_oc
 ORDER BY n;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación manual (correr aparte, después del COMMIT)
-- ---------------------------------------------------------------------
-- -- La columna:
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'core' AND table_name = 'vouchers'
--    AND column_name = 'oc_id';
--
-- -- La FK y el índice:
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'core.vouchers'::regclass AND contype = 'f'
--    AND pg_get_constraintdef(oid) LIKE '%oc_id%';
--
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE schemaname = 'core' AND tablename = 'vouchers'
--    AND indexdef LIKE '%oc_id%';
--
-- -- El comentario (debe dejar de ser NULL):
-- SELECT col_description('core.vouchers'::regclass, attnum)
--   FROM pg_attribute
--  WHERE attrelid = 'core.vouchers'::regclass AND attname = 'oc_id';
--
-- -- El vínculo completo voucher ↔ OC ↔ hito, para mirarlo a ojo:
-- SELECT v.voucher_id, v.codigo, v.status, v.empresa_codigo,
--        v.oc_id, o.numero_oc, o.empresa_codigo AS oc_empresa,
--        o.tipo_documento, o.total, o.retencion_monto, o.total_a_pagar,
--        c.cuota_id, c.numero_cuota, c.monto AS hito_liquido, c.estado
--   FROM core.vouchers v
--   LEFT JOIN core.ordenes_compra o ON o.oc_id = v.oc_id
--   LEFT JOIN core.oc_cuotas c ON c.voucher_id = v.voucher_id
--  WHERE v.oc_id IS NOT NULL
--  ORDER BY v.voucher_id;
--
-- -- Fuga cross-tenant: un voucher y su OC TIENEN que ser de la misma
-- -- empresa. Debe dar 0 filas, siempre.
-- SELECT v.voucher_id, v.codigo, v.empresa_codigo AS voucher_empresa,
--        o.oc_id, o.numero_oc, o.empresa_codigo AS oc_empresa
--   FROM core.vouchers v
--   JOIN core.ordenes_compra o ON o.oc_id = v.oc_id
--  WHERE v.empresa_codigo IS DISTINCT FROM o.empresa_codigo;
