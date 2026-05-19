-- =====================================================================
-- Round 123 — Infraestructura para integración con Nubox (remuneraciones)
-- =====================================================================
-- INSTRUCCIONES PARA NICOLAS:
--   1. Supabase Studio → SQL Editor → New query
--   2. Pegá todo este archivo y RUN
-- Idempotente: re-correr no rompe nada.
-- =====================================================================

-- 1. Extender el CHECK de sistemas en empresa_credenciales (agregar 'nubox')
ALTER TABLE core.empresa_credenciales
    DROP CONSTRAINT IF EXISTS chk_sistema;
ALTER TABLE core.empresa_credenciales
    ADD CONSTRAINT chk_sistema CHECK (sistema IN ('sii', 'previred', 'nubox'));

-- 2. Registro de runs de Nubox
CREATE TABLE IF NOT EXISTS core.nubox_sync_runs (
    run_id              BIGSERIAL PRIMARY KEY,
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    tipo                TEXT NOT NULL,
    periodo             TEXT,
    status              TEXT NOT NULL DEFAULT 'STARTED',
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    documentos_count    INTEGER NOT NULL DEFAULT 0,
    error_message       TEXT,
    triggered_by        UUID,
    notas               TEXT,
    CONSTRAINT chk_nubox_tipo CHECK (tipo IN (
        'remuneraciones', 'liquidaciones', 'imposiciones',
        'centralizacion', 'test_login', 'import_excel'
    )),
    CONSTRAINT chk_nubox_status CHECK (status IN ('STARTED', 'OK', 'FAILED', 'PARTIAL'))
);
CREATE INDEX IF NOT EXISTS idx_nubox_runs_empresa
    ON core.nubox_sync_runs(empresa_codigo, started_at DESC);

-- 3. Remuneraciones mensuales (1 fila por trabajador por período)
CREATE TABLE IF NOT EXISTS core.nubox_remuneraciones (
    remuneracion_id     BIGSERIAL PRIMARY KEY,
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    periodo             TEXT NOT NULL,                  -- YYYY-MM
    trabajador_rut      TEXT NOT NULL,
    trabajador_nombre   TEXT,
    -- Haberes
    sueldo_base         BIGINT NOT NULL DEFAULT 0,
    gratificacion       BIGINT NOT NULL DEFAULT 0,
    horas_extras        BIGINT NOT NULL DEFAULT 0,
    bonos               BIGINT NOT NULL DEFAULT 0,
    colacion            BIGINT NOT NULL DEFAULT 0,
    movilizacion        BIGINT NOT NULL DEFAULT 0,
    otros_haberes       BIGINT NOT NULL DEFAULT 0,
    total_haberes       BIGINT NOT NULL DEFAULT 0,
    -- Descuentos previsionales
    afp_descuento       BIGINT NOT NULL DEFAULT 0,
    salud_descuento     BIGINT NOT NULL DEFAULT 0,      -- Fonasa / Isapre
    afc_descuento       BIGINT NOT NULL DEFAULT 0,      -- seguro cesantía
    -- Tributario
    impuesto_unico      BIGINT NOT NULL DEFAULT 0,
    -- Otros descuentos
    otros_descuentos    BIGINT NOT NULL DEFAULT 0,
    total_descuentos    BIGINT NOT NULL DEFAULT 0,
    -- Resultado
    sueldo_liquido      BIGINT NOT NULL DEFAULT 0,
    -- Aporte patronal (no descontado al trabajador pero costo empresa)
    sis_patronal        BIGINT NOT NULL DEFAULT 0,      -- seguro invalidez/sobrevivencia
    afc_patronal        BIGINT NOT NULL DEFAULT 0,
    mutual_patronal     BIGINT NOT NULL DEFAULT 0,
    -- Conciliación
    trabajador_id       BIGINT REFERENCES core.trabajadores(trabajador_id),
    voucher_id          BIGINT REFERENCES core.vouchers(voucher_id),
    run_id              BIGINT REFERENCES core.nubox_sync_runs(run_id),
    raw_data            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Dedupe: misma empresa + mismo trabajador + mismo período = mismo registro
    CONSTRAINT uq_nubox_rem UNIQUE (empresa_codigo, periodo, trabajador_rut)
);
CREATE INDEX IF NOT EXISTS idx_nubox_rem_empresa_periodo
    ON core.nubox_remuneraciones(empresa_codigo, periodo);
CREATE INDEX IF NOT EXISTS idx_nubox_rem_unconciled
    ON core.nubox_remuneraciones(empresa_codigo) WHERE voucher_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_nubox_rem_trabajador_rut
    ON core.nubox_remuneraciones(trabajador_rut);

-- Verificación
SELECT 'core.nubox_sync_runs' AS tabla,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'nubox_sync_runs') AS existe
UNION ALL
SELECT 'core.nubox_remuneraciones',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'nubox_remuneraciones')
UNION ALL
SELECT 'sistema=nubox permitido',
    EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_schema = 'core' AND constraint_name = 'chk_sistema'
          AND check_clause LIKE '%nubox%'
    );
