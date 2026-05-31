-- =============================================================================
-- Round 152w — Rendiciones CORFO (REVTECH + TRONGKAI)
-- =============================================================================
-- Tabla de mapeo cuenta_contable_local -> Cuenta CORFO + Ítem CORFO.
-- Cuando el user mapea por primera vez, queda guardado para futuros períodos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS core.corfo_cuenta_mapping (
    mapping_id        BIGSERIAL PRIMARY KEY,
    empresa_codigo    TEXT NOT NULL REFERENCES core.empresas(codigo),
    -- Código del plan de cuentas local (ej. "5-01-01-001")
    cuenta_codigo     TEXT NOT NULL,
    -- Mapping CORFO:
    corfo_cuenta      TEXT NOT NULL,    -- "SUBCONTRATOS", "GASTOS DE OPERACIÓN", etc.
    corfo_item        TEXT,             -- "Análisis de laboratorio", "Servicos de Ingeniería", etc.
    -- Para RRHH puede ser cargo CORFO (ej. "DIRECTOR 1", "PROFESIONAL 2")
    corfo_cargo       TEXT,
    notas             TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, cuenta_codigo)
);

CREATE INDEX IF NOT EXISTS idx_corfo_mapping_empresa
    ON core.corfo_cuenta_mapping (empresa_codigo);

-- =============================================================================
-- Tabla maestra: catálogos oficiales CORFO (valores válidos para dropdowns)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.corfo_catalogos (
    catalogo_id   SERIAL PRIMARY KEY,
    catalogo      TEXT NOT NULL,  -- 'cuenta_gastos','cuenta_rrhh','item','tipo_doc','periodo'
    valor         TEXT NOT NULL,
    orden         INT DEFAULT 100,
    active        BOOLEAN DEFAULT TRUE,
    UNIQUE(catalogo, valor)
);
