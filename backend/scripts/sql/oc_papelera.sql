-- ============================================================================
-- core.oc_eliminadas — el registro de las OC borradas
-- ============================================================================
-- Nicolás pidió que una OC se pueda borrar SIEMPRE, incluso firmada, "pero que
-- quede un registro de que se eliminó".
--
-- Hasta ahora el borrado estaba bloqueado con 409 cuando la OC tenía firmas o
-- vouchers con plata, y lo único que quedaba era una fila best-effort en
-- `audit.action_log` — escrita DESPUÉS del commit del DELETE y sin raisear si
-- falla. O sea: si ese insert fallaba, la OC desaparecía sin dejar rastro. Para
-- lo que se pide acá eso no alcanza.
--
-- Esta tabla es el reemplazo, con tres propiedades que el audit_log no tiene:
--
--   1. Se escribe en la MISMA TRANSACCIÓN que el DELETE, antes del commit. Si
--      el registro no se puede guardar, la OC NO se borra. No existe el camino
--      "se borró y no quedó constancia".
--   2. Guarda la OC ENTERA, no un diff: cabecera, ítems, cuotas (forma de
--      pago), firmas, adjuntos y los vouchers que colgaban de ella. El
--      snapshot del audit_log salía de `OrdenCompraRead`, que trae los ítems
--      pero NO las cuotas ni las firmas — justo las dos cosas que harían falta
--      para reconstruirla o para probar quién la había firmado.
--   3. Es INMUTABLE: un trigger bloquea UPDATE y DELETE. Un registro de
--      borrado que se puede borrar no sirve de nada.
--
-- El `snapshot` se arma con `to_jsonb(t)` sobre cada tabla hija, así que no
-- depende de una lista de columnas: si mañana se le agrega una columna a
-- `oc_cuotas`, entra sola.
--
-- La prueba de que el candado CIERRA (no de que existe) está en
-- `backend/tests/unit/test_oc_papelera.py` y en la verificación con ROLLBACK
-- que se corre contra producción al instalar: acá no se insertan filas de
-- prueba porque el propio trigger impediría borrarlas después.
--
-- Idempotente. Reporta OK/FAIL.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS core.oc_eliminadas (
    eliminacion_id      BIGSERIAL PRIMARY KEY,

    -- Identidad de la OC que se fue. SIN foreign key a propósito: la fila
    -- original ya no existe, una FK haría imposible guardar esto.
    oc_id               INTEGER     NOT NULL,
    numero_oc           TEXT        NOT NULL,
    empresa_codigo      TEXT        NOT NULL,
    estado_previo       TEXT        NOT NULL,

    -- Denormalizado para que el listado no tenga que abrir el JSON. Son los
    -- campos con los que uno busca: "la OC de GHR de agosto por 486 mil".
    proveedor_nombre    TEXT,
    proveedor_rut       TEXT,
    fecha_emision       DATE,
    moneda              TEXT,
    tipo_documento      TEXT,
    total               NUMERIC(18,2),
    total_a_pagar       NUMERIC(18,2),

    -- Qué tan grave era el borrado. Se guarda al momento del hecho porque
    -- después no hay forma de recalcularlo: las firmas se van con la OC.
    firmas_puestas      INTEGER     NOT NULL DEFAULT 0,
    firmantes           TEXT,
    vouchers_con_plata  INTEGER     NOT NULL DEFAULT 0,
    voucher_ids         INTEGER[]   NOT NULL DEFAULT '{}',

    -- Quién, cuándo y por qué.
    motivo              TEXT        NOT NULL,
    eliminado_por_email TEXT,
    eliminado_por_id    UUID,
    eliminado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip                  TEXT,
    user_agent          TEXT,

    -- La OC completa.
    snapshot            JSONB       NOT NULL,

    -- Un motivo en blanco convierte el registro en ruido. El endpoint también
    -- lo valida, pero el candado tiene que estar en la BD: es el único lugar
    -- por el que no se puede pasar de largo.
    CONSTRAINT oc_eliminadas_motivo_no_vacio
        CHECK (btrim(motivo) <> ''),
    CONSTRAINT oc_eliminadas_snapshot_no_vacio
        CHECK (snapshot <> '{}'::jsonb)
);

-- El listado se ordena por fecha dentro de una empresa (scope multi-tenant).
CREATE INDEX IF NOT EXISTS ix_oc_eliminadas_empresa_fecha
    ON core.oc_eliminadas (empresa_codigo, eliminado_el DESC);
-- Buscar "qué pasó con la OC0045".
CREATE INDEX IF NOT EXISTS ix_oc_eliminadas_numero
    ON core.oc_eliminadas (numero_oc);
-- Un voucher huérfano pregunta "¿de qué OC colgaba?".
CREATE INDEX IF NOT EXISTS ix_oc_eliminadas_oc_id
    ON core.oc_eliminadas (oc_id);

-- ---------------------------------------------------------------------------
-- Inmutabilidad
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.oc_eliminadas_solo_lectura()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
    RAISE EXCEPTION
        'core.oc_eliminadas es un registro inmutable: no admite %.', TG_OP
        USING HINT = 'Si de verdad hay que purgar una fila, hay que sacar el '
                     'trigger oc_eliminadas_inmutable a mano y dejar constancia.';
END;
$fn$;

DROP TRIGGER IF EXISTS oc_eliminadas_inmutable ON core.oc_eliminadas;
CREATE TRIGGER oc_eliminadas_inmutable
    BEFORE UPDATE OR DELETE ON core.oc_eliminadas
    FOR EACH ROW EXECUTE FUNCTION core.oc_eliminadas_solo_lectura();

-- ---------------------------------------------------------------------------
-- Verificación estructural
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_n INT;
BEGIN
    IF to_regclass('core.oc_eliminadas') IS NULL THEN
        RAISE EXCEPTION 'FAIL · la tabla no quedó creada';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_trigger
     WHERE tgrelid = 'core.oc_eliminadas'::regclass
       AND tgname = 'oc_eliminadas_inmutable'
       AND NOT tgisinternal;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FAIL · el trigger de inmutabilidad no quedó instalado';
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_constraint
     WHERE conrelid = 'core.oc_eliminadas'::regclass
       AND conname IN ('oc_eliminadas_motivo_no_vacio',
                       'oc_eliminadas_snapshot_no_vacio');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'FAIL · faltan CHECKs (encontrados: %)', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_indexes
     WHERE schemaname = 'core' AND tablename = 'oc_eliminadas'
       AND indexname LIKE 'ix_oc_eliminadas%';
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'FAIL · faltan índices (encontrados: %)', v_n;
    END IF;

    RAISE NOTICE 'OK · core.oc_eliminadas · trigger de inmutabilidad · 2 CHECKs · 3 índices';
END $$;

COMMIT;
