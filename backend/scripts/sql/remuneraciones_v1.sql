-- ============================================================================
-- REMUNERACIONES v1 — parámetros por período + liquidaciones calculadas
-- ============================================================================
-- La sección calcula liquidaciones chilenas y las CONCILIA contra los libros
-- del contador (core.libro_remuneraciones_lineas, que ya existen).
--
-- Principio: el motor nunca adivina. `uf` y `utm` son NULLABLES a propósito:
-- NULL significa "todavía no se cargó el indicador del mes" y el motor se
-- NIEGA a calcular hasta que alguien lo cargue. Un default inventado acá
-- sería un error disfrazado de dato.
--
-- Seeds: los valores confirmados por el libro real de MCG (AFIS, abril 2026):
-- IMM 539.000 · UTM abril 69.889 (derivada del impuesto único al centavo) ·
-- SIS 1,62 % · reforma 0,1+0,9 % · jornada 42 h (ley 21.561, vigente desde
-- abril 2026). Las comisiones AFP van sembradas con los últimos valores
-- conocidos y MARCADAS para verificar en Previred — cambian por licitación.
--
-- Idempotente. Reporta OK/FAIL.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Parámetros del período
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.remun_parametros (
    periodo             TEXT PRIMARY KEY,           -- 'YYYY-MM'
    uf                  NUMERIC(12,2),              -- NULL = falta cargar
    utm                 NUMERIC(12,2),              -- NULL = falta cargar
    ingreso_minimo      NUMERIC(12,2) NOT NULL,
    tope_imponible_uf   NUMERIC(6,2)  NOT NULL DEFAULT 87.8,
    tope_afc_uf         NUMERIC(6,2)  NOT NULL DEFAULT 131.9,
    jornada_horas       NUMERIC(4,1)  NOT NULL DEFAULT 42,
    cotizacion_afp_pct  NUMERIC(6,3)  NOT NULL DEFAULT 10,
    salud_legal_pct     NUMERIC(6,3)  NOT NULL DEFAULT 7,
    afc_trab_indefinido_pct NUMERIC(6,3) NOT NULL DEFAULT 0.6,
    afc_emp_indefinido_pct  NUMERIC(6,3) NOT NULL DEFAULT 2.4,
    afc_emp_plazo_fijo_pct  NUMERIC(6,3) NOT NULL DEFAULT 3.0,
    sis_pct             NUMERIC(6,3)  NOT NULL DEFAULT 1.62,
    mutual_pct          NUMERIC(6,3)  NOT NULL DEFAULT 0.93,
    reforma_cuenta_individual_pct NUMERIC(6,3) NOT NULL DEFAULT 0.1,
    reforma_seguro_social_pct     NUMERIC(6,3) NOT NULL DEFAULT 0.9,
    apv_tope_uf         NUMERIC(6,2)  NOT NULL DEFAULT 50,
    notas               TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          TEXT,
    CONSTRAINT remun_parametros_periodo_valido
        CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    -- Un indicador cargado en 0 es peor que NULL: pasa los checks de
    -- presencia y produce divisiones absurdas. O es positivo o es NULL.
    CONSTRAINT remun_parametros_uf_positiva  CHECK (uf  IS NULL OR uf  > 0),
    CONSTRAINT remun_parametros_utm_positiva CHECK (utm IS NULL OR utm > 0),
    CONSTRAINT remun_parametros_imm_positivo CHECK (ingreso_minimo > 0)
);

-- Comisión por AFP por período. Cambia por licitación: editable, versionada.
CREATE TABLE IF NOT EXISTS core.remun_afp_comisiones (
    periodo      TEXT NOT NULL REFERENCES core.remun_parametros(periodo)
                 ON DELETE CASCADE,
    afp          TEXT NOT NULL,
    comision_pct NUMERIC(6,3) NOT NULL CHECK (comision_pct >= 0),
    PRIMARY KEY (periodo, afp)
);

-- Tramos de asignación familiar por período. `hasta` NULL = tramo final ($0).
CREATE TABLE IF NOT EXISTS core.remun_asignacion_familiar (
    periodo  TEXT NOT NULL REFERENCES core.remun_parametros(periodo)
             ON DELETE CASCADE,
    orden    INT  NOT NULL,
    hasta    NUMERIC(12,2),
    monto    NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
    PRIMARY KEY (periodo, orden)
);

-- ---------------------------------------------------------------------------
-- 2. Liquidaciones calculadas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.remun_liquidaciones (
    liquidacion_id  BIGSERIAL PRIMARY KEY,
    empresa_codigo  TEXT NOT NULL,
    empleado_rut    TEXT NOT NULL,
    empleado_nombre TEXT NOT NULL,
    periodo         TEXT NOT NULL,
    -- BORRADOR se recalcula libremente; CONFIRMADA queda quieta.
    estado          TEXT NOT NULL DEFAULT 'BORRADOR'
                    CHECK (estado IN ('BORRADOR', 'CONFIRMADA')),
    -- La entrada COMPLETA y el desglose COMPLETO del motor. JSONB porque el
    -- desglose tiene ~35 cifras y lo que se consulta suelto va en columnas.
    entrada         JSONB NOT NULL,
    resultado       JSONB NOT NULL,
    -- Denormalizado para listar y sumar sin abrir el JSON.
    total_haberes   NUMERIC(14,2) NOT NULL,
    total_descuentos NUMERIC(14,2) NOT NULL,
    liquido         NUMERIC(14,2) NOT NULL,
    costo_empresa   NUMERIC(14,2) NOT NULL,
    calculada_por   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT remun_liq_periodo_valido
        CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    -- La identidad contable, defendida también en BD: si alguien edita el
    -- JSON a mano y descuadra los totales, el UPDATE no pasa.
    CONSTRAINT remun_liq_identidad
        CHECK (liquido = total_haberes - total_descuentos),
    -- Un empleado, una liquidación por mes y empresa.
    CONSTRAINT remun_liq_unica UNIQUE (empresa_codigo, empleado_rut, periodo)
);

CREATE INDEX IF NOT EXISTS ix_remun_liq_empresa_periodo
    ON core.remun_liquidaciones (empresa_codigo, periodo);

-- ---------------------------------------------------------------------------
-- 3. Seeds — abril 2026 (calibrado con el libro) y agosto 2026 (a completar)
-- ---------------------------------------------------------------------------
INSERT INTO core.remun_parametros (periodo, uf, utm, ingreso_minimo, notas)
VALUES
    ('2026-04', 39000, 69889, 539000,
     'UTM derivada del libro MCG (impuesto único al centavo). UF aproximada: '
     'VERIFICAR en sii.cl si se recalculan liquidaciones con isapre o tope.'),
    ('2026-08', NULL, NULL, 539000,
     'UF y UTM pendientes de carga (sii.cl). IMM vigente desde el reajuste '
     'de 2026: verificar si hubo nuevo reajuste legal.')
ON CONFLICT (periodo) DO NOTHING;

-- Comisiones AFP (últimos valores conocidos — VERIFICAR EN PREVIRED, cambian
-- por licitación). Se siembran para los dos períodos.
INSERT INTO core.remun_afp_comisiones (periodo, afp, comision_pct)
SELECT p.periodo, a.afp, a.pct
  FROM (VALUES ('CAPITAL', 1.44), ('CUPRUM', 1.44), ('HABITAT', 1.27),
               ('MODELO', 0.58), ('PLANVITAL', 1.16), ('PROVIDA', 1.45),
               ('UNO', 0.49)) AS a(afp, pct)
 CROSS JOIN (VALUES ('2026-04'), ('2026-08')) AS p(periodo)
ON CONFLICT (periodo, afp) DO NOTHING;

-- Asignación familiar (tramos vigentes conocidos — VERIFICAR, se reajustan
-- con el IMM). Tramo final NULL = $0.
INSERT INTO core.remun_asignacion_familiar (periodo, orden, hasta, monto)
SELECT p.periodo, t.orden, t.hasta, t.monto
  FROM (VALUES (1, 620251::numeric, 22007::numeric),
               (2, 905941, 13505),
               (3, 1412957, 4267),
               (4, NULL, 0)) AS t(orden, hasta, monto)
 CROSS JOIN (VALUES ('2026-04'), ('2026-08')) AS p(periodo)
ON CONFLICT (periodo, orden) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Verificación
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_n INT;
BEGIN
    IF to_regclass('core.remun_parametros') IS NULL
       OR to_regclass('core.remun_afp_comisiones') IS NULL
       OR to_regclass('core.remun_asignacion_familiar') IS NULL
       OR to_regclass('core.remun_liquidaciones') IS NULL THEN
        RAISE EXCEPTION 'FAIL · falta alguna tabla';
    END IF;

    SELECT count(*) INTO v_n FROM core.remun_parametros;
    IF v_n < 2 THEN
        RAISE EXCEPTION 'FAIL · seeds de parámetros incompletos (%)', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM core.remun_afp_comisiones WHERE periodo = '2026-08';
    IF v_n < 7 THEN
        RAISE EXCEPTION 'FAIL · faltan comisiones AFP (%)', v_n;
    END IF;

    -- La UTM de abril tiene que ser LA del libro: es la calibración.
    SELECT count(*) INTO v_n FROM core.remun_parametros
     WHERE periodo = '2026-04' AND utm = 69889;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FAIL · la UTM de abril no es la calibrada';
    END IF;

    -- Agosto DEBE quedar sin UF/UTM: el motor tiene que pedirlas.
    SELECT count(*) INTO v_n FROM core.remun_parametros
     WHERE periodo = '2026-08' AND uf IS NULL AND utm IS NULL;
    IF v_n <> 1 THEN
        RAISE NOTICE 'AVISO · agosto ya tiene UF/UTM cargadas (alguien las puso: bien)';
    END IF;

    RAISE NOTICE 'OK · 4 tablas · parámetros 2026-04 (calibrado) y 2026-08 · 7 AFP · 4 tramos';
END $$;

COMMIT;
