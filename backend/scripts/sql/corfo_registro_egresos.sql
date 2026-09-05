-- ============================================================================
-- REGISTRO DE EGRESOS CORFO (la sección de Claudia)
-- ============================================================================
-- Nicolás: "necesito agregarle estos datos a la sección de Claudia y crees
-- alguna manera de ingresar los datos como si fuera un excel pero al hacerle
-- click sale toda la información del monto, que es la misma información que
-- pide CORFO, y tiene la facultad de separar por porcentaje qué paga Cehta
-- y qué paga el P-tec ... que se puedan almacenar datos mes a mes y que
-- queden todos registrados".
--
-- Modelo:
--   core.corfo_registro_egresos      → UNA fila por documento (la fila del
--                                      Excel "Registro de Egresos" de Claudia,
--                                      más las columnas oficiales de la
--                                      planilla Carga_Gastos de CORFO).
--   core.corfo_registro_egresos_hist → cada INSERT/UPDATE/DELETE deja un
--                                      snapshot completo, inmutable. "Que
--                                      queden todos registrados" = esto.
--
-- Reparto ("SEPARACIÓN VALORES"): 4 montos en pesos. La regla todo-o-nada
-- (las 4 en NULL = sin clasificar, o las 4 con valor) está en un CHECK.
-- Que la suma cierre contra el total NO es un CHECK a propósito: las filas
-- importadas del Excel traen descuadres reales que hay que MOSTRAR para
-- corregir, no rechazar en silencio. La API sí exige cuadre en lo que se
-- crea/edita desde la pantalla.
--
-- `periodo` (YYYY-MM) lo deriva SIEMPRE el trigger desde `fecha`: nadie
-- puede guardar un gasto de agosto en el mes de julio.
--
-- Borrado: lógico (deleted_at). La API nunca hace DELETE físico; si alguien
-- lo hiciera a mano, el trigger igual deja el snapshot en el historial.
--
-- Idempotente. Reporta OK/FAIL. Incluye un SELF-TEST que inserta, edita y
-- borra dentro de un sub-bloque que se revierte (no deja datos).
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabla principal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.corfo_registro_egresos (
    egreso_id        BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
    periodo          TEXT NOT NULL,
    fecha            DATE NOT NULL,
    descripcion      TEXT NOT NULL,
    rut_emisor       TEXT,
    tipo_documento   TEXT NOT NULL,
    folio            TEXT,
    monto_neto       NUMERIC(18,2) NOT NULL DEFAULT 0,
    impuesto         NUMERIC(18,2) NOT NULL DEFAULT 0,
    total            NUMERIC(18,2) NOT NULL,
    tipo_egreso      TEXT,
    fuente           TEXT,
    proyecto         TEXT,
    estado_pago      TEXT NOT NULL DEFAULT 'PENDIENTE',
    fecha_pago       DATE,
    -- SEPARACIÓN VALORES (pesos). Las 4 NULL = sin clasificar.
    monto_subsidio   NUMERIC(18,2),
    monto_cehta_ptec NUMERIC(18,2),
    monto_cehta      NUMERIC(18,2),
    monto_trewaox    NUMERIC(18,2),
    -- Planilla oficial CORFO (Carga_Gastos)
    corfo_cuenta                TEXT,
    corfo_item                  TEXT,
    corfo_fuente_financiamiento TEXT,
    corfo_etapa                 TEXT,
    corfo_fecha_recepcion       DATE,
    corfo_monto_rendir          NUMERIC(18,2),
    corfo_monto_cancelado       NUMERIC(18,2),
    corfo_forma_pago            TEXT,
    corfo_glosa                 TEXT,
    corfo_receptor_rut          TEXT,
    corfo_receptor_nombre       TEXT,
    observaciones        TEXT,
    adjunto_dropbox_path TEXT,
    origen               TEXT NOT NULL DEFAULT 'UI',
    import_natural_key   TEXT,
    created_by   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ,
    deleted_by   TEXT,
    delete_motivo TEXT,

    CONSTRAINT ck_corfo_egresos_periodo
        CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT ck_corfo_egresos_descripcion
        CHECK (btrim(descripcion) <> ''),
    CONSTRAINT ck_corfo_egresos_tipo_documento
        CHECK (tipo_documento IN ('FACTURA','FACTURA_EXENTA','BOLETA',
                                  'BOLETA_HONORARIO','LIQUIDACION',
                                  'CO_EJECUTOR','INVOICE','OTRO')),
    CONSTRAINT ck_corfo_egresos_total CHECK (total >= 0),
    CONSTRAINT ck_corfo_egresos_estado_pago
        CHECK (estado_pago IN ('PAGADO','PARCIAL','PENDIENTE')),
    CONSTRAINT ck_corfo_egresos_origen
        CHECK (origen IN ('UI','PASTE','IMPORT_EXCEL')),
    -- Todo o nada: sin clasificar es UNA sola cosa (las cuatro en NULL).
    CONSTRAINT ck_corfo_egresos_reparto_todo_o_nada CHECK (
        (monto_subsidio IS NULL AND monto_cehta_ptec IS NULL
         AND monto_cehta IS NULL AND monto_trewaox IS NULL)
        OR
        (monto_subsidio IS NOT NULL AND monto_cehta_ptec IS NOT NULL
         AND monto_cehta IS NOT NULL AND monto_trewaox IS NOT NULL)
    ),
    CONSTRAINT ck_corfo_egresos_delete_con_motivo
        CHECK (deleted_at IS NULL OR delete_motivo IS NOT NULL)
);

COMMENT ON TABLE core.corfo_registro_egresos IS
    'Registro de egresos del subsidio CORFO (REVTECH/TRONGKAI). Una fila por documento, con el reparto por fuente y las columnas oficiales de Carga_Gastos. Sección de Claudia.';
COMMENT ON COLUMN core.corfo_registro_egresos.periodo IS
    'YYYY-MM derivado de fecha por trigger. Es el "mes a mes".';
COMMENT ON COLUMN core.corfo_registro_egresos.import_natural_key IS
    'Huella de la fila del Excel importada (idempotencia del import). NULL para filas creadas en la pantalla.';

-- Idempotencia del import: la misma fila del Excel no entra dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS ux_corfo_egresos_import_key
    ON core.corfo_registro_egresos (import_natural_key)
    WHERE import_natural_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_corfo_egresos_empresa_periodo
    ON core.corfo_registro_egresos (empresa_codigo, periodo)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_corfo_egresos_empresa_fecha
    ON core.corfo_registro_egresos (empresa_codigo, fecha DESC);
CREATE INDEX IF NOT EXISTS ix_corfo_egresos_rut
    ON core.corfo_registro_egresos (rut_emisor);

-- ---------------------------------------------------------------------------
-- 2. BEFORE: periodo desde fecha, RUT limpio, updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.corfo_egresos_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.periodo := to_char(NEW.fecha, 'YYYY-MM');
    IF NEW.rut_emisor IS NOT NULL THEN
        -- sin puntos ni espacios, dígito verificador en mayúscula
        NEW.rut_emisor := upper(regexp_replace(NEW.rut_emisor, '[^0-9kK-]', '', 'g'));
        IF NEW.rut_emisor = '' THEN NEW.rut_emisor := NULL; END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := now();
        NEW.created_at := OLD.created_at;   -- nunca se reescribe
        NEW.created_by := OLD.created_by;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_corfo_egresos_before ON core.corfo_registro_egresos;
CREATE TRIGGER trg_corfo_egresos_before
    BEFORE INSERT OR UPDATE ON core.corfo_registro_egresos
    FOR EACH ROW EXECUTE FUNCTION core.corfo_egresos_before();

-- ---------------------------------------------------------------------------
-- 3. Historial inmutable: snapshot completo por cada cambio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.corfo_registro_egresos_hist (
    hist_id    BIGSERIAL PRIMARY KEY,
    egreso_id  BIGINT NOT NULL,
    version    INT NOT NULL,
    accion     TEXT NOT NULL CHECK (accion IN ('INSERT','UPDATE','DELETE')),
    snapshot   JSONB NOT NULL,
    changed_by TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (egreso_id, version)
);
CREATE INDEX IF NOT EXISTS ix_corfo_egresos_hist_egreso
    ON core.corfo_registro_egresos_hist (egreso_id, version DESC);

CREATE OR REPLACE FUNCTION core.corfo_egresos_hist() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_fila  core.corfo_registro_egresos;
    v_quien TEXT;
    v_ver   INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_fila := OLD; v_quien := OLD.deleted_by;
    ELSE
        v_fila := NEW; v_quien := COALESCE(NEW.updated_by, NEW.created_by);
    END IF;
    -- serializa versiones por fila (dos ediciones simultáneas no chocan)
    PERFORM pg_advisory_xact_lock(hashtext('corfo_egresos_hist'), v_fila.egreso_id::int);
    SELECT COALESCE(max(version), 0) + 1 INTO v_ver
      FROM core.corfo_registro_egresos_hist WHERE egreso_id = v_fila.egreso_id;
    INSERT INTO core.corfo_registro_egresos_hist
        (egreso_id, version, accion, snapshot, changed_by)
    VALUES (v_fila.egreso_id, v_ver, TG_OP, to_jsonb(v_fila), v_quien);
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_corfo_egresos_hist ON core.corfo_registro_egresos;
CREATE TRIGGER trg_corfo_egresos_hist
    AFTER INSERT OR UPDATE OR DELETE ON core.corfo_registro_egresos
    FOR EACH ROW EXECUTE FUNCTION core.corfo_egresos_hist();

CREATE OR REPLACE FUNCTION core.corfo_egresos_hist_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'El historial del registro de egresos es inmutable (%)', TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS trg_corfo_egresos_hist_inmutable ON core.corfo_registro_egresos_hist;
CREATE TRIGGER trg_corfo_egresos_hist_inmutable
    BEFORE UPDATE OR DELETE ON core.corfo_registro_egresos_hist
    FOR EACH ROW EXECUTE FUNCTION core.corfo_egresos_hist_inmutable();

-- ---------------------------------------------------------------------------
-- 4. SELF-TEST (se revierte solo: no deja filas)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_id  BIGINT;
    v_n   INT;
    v_per TEXT;
    v_rut TEXT;
BEGIN
    BEGIN
        INSERT INTO core.corfo_registro_egresos
            (empresa_codigo, periodo, fecha, descripcion, rut_emisor, tipo_documento,
             folio, monto_neto, impuesto, total, estado_pago, created_by)
        VALUES ('REVTECH', '1999-01', DATE '2026-08-27', 'SELFTEST', '76.642.280-2',
                'FACTURA', '1', 100, 19, 119, 'PENDIENTE', 'selftest')
        RETURNING egreso_id, periodo, rut_emisor INTO v_id, v_per, v_rut;

        IF v_per <> '2026-08' THEN
            RAISE EXCEPTION 'FAIL · periodo no derivado de fecha (quedó %)', v_per;
        END IF;
        IF v_rut <> '76642280-2' THEN
            RAISE EXCEPTION 'FAIL · RUT no normalizado (quedó %)', v_rut;
        END IF;

        UPDATE core.corfo_registro_egresos
           SET monto_subsidio = 119, monto_cehta_ptec = 0, monto_cehta = 0,
               monto_trewaox = 0, updated_by = 'selftest2'
         WHERE egreso_id = v_id;

        -- todo-o-nada
        BEGIN
            UPDATE core.corfo_registro_egresos SET monto_cehta = NULL WHERE egreso_id = v_id;
            RAISE EXCEPTION 'FAIL · aceptó un reparto a medias';
        EXCEPTION WHEN check_violation THEN
            NULL; -- esperado
        END;

        -- borrado lógico exige motivo
        BEGIN
            UPDATE core.corfo_registro_egresos SET deleted_at = now() WHERE egreso_id = v_id;
            RAISE EXCEPTION 'FAIL · aceptó un borrado sin motivo';
        EXCEPTION WHEN check_violation THEN
            NULL;
        END;

        UPDATE core.corfo_registro_egresos
           SET deleted_at = now(), deleted_by = 'selftest3', delete_motivo = 'prueba'
         WHERE egreso_id = v_id;

        SELECT count(*) INTO v_n FROM core.corfo_registro_egresos_hist WHERE egreso_id = v_id;
        IF v_n <> 3 THEN
            RAISE EXCEPTION 'FAIL · esperaba 3 versiones en el historial, hay %', v_n;
        END IF;

        -- historial inmutable
        BEGIN
            DELETE FROM core.corfo_registro_egresos_hist WHERE egreso_id = v_id;
            RAISE EXCEPTION 'FAIL · el historial se dejó borrar';
        EXCEPTION WHEN restrict_violation THEN
            NULL;
        END;

        RAISE EXCEPTION 'SELFTEST_ROLLBACK';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'SELFTEST_ROLLBACK' THEN
            RAISE;
        END IF;
    END;
    RAISE NOTICE 'OK · self-test: periodo/RUT por trigger, todo-o-nada, motivo de borrado, 3 versiones, historial inmutable';
END $$;

-- ---------------------------------------------------------------------------
-- 5. Verificación final
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM pg_trigger
     WHERE tgrelid IN ('core.corfo_registro_egresos'::regclass,
                       'core.corfo_registro_egresos_hist'::regclass)
       AND NOT tgisinternal;
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'FAIL · esperaba 3 triggers, hay %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM core.corfo_registro_egresos WHERE descripcion = 'SELFTEST';
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FAIL · el self-test dejó % fila(s)', v_n;
    END IF;
    RAISE NOTICE 'OK · core.corfo_registro_egresos + _hist listos (3 triggers, sin residuos)';
END $$;

COMMIT;
