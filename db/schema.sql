-- =====================================================================
-- Cehta Capital — Esquema Postgres / Supabase
-- Versión: 0.1.0 (MVP ETL desde Excel madre)
-- Diseñado para: FIP CEHTA ESG + portfolio companies
-- =====================================================================

-- Extensiones útiles
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ---------------------------------------------------------------------
-- SCHEMAS
--   raw    : volcado tal cual desde Excel (para reproducibilidad)
--   stg    : datos limpiados y validados (post-transform)
--   core   : modelo normalizado que consume la app (fuente de verdad)
--   audit  : trazabilidad de cada corrida ETL
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS stg;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;

-- =====================================================================
-- AUDIT: corridas ETL
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit.etl_runs (
    run_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    source_file     TEXT NOT NULL,            -- ruta en Dropbox/Drive
    source_hash     TEXT,                     -- SHA256 del archivo
    rows_extracted  INT,
    rows_loaded     INT,
    rows_rejected   INT,
    status          TEXT CHECK (status IN ('running','success','failed','partial')),
    error_message   TEXT,
    triggered_by    TEXT DEFAULT 'scheduled'  -- 'scheduled'|'manual'|'webhook'
);

CREATE TABLE IF NOT EXISTS audit.rejected_rows (
    rejected_id     BIGSERIAL PRIMARY KEY,
    run_id          UUID REFERENCES audit.etl_runs(run_id) ON DELETE CASCADE,
    source_sheet    TEXT,
    source_row_num  INT,
    reason          TEXT,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rejected_run ON audit.rejected_rows(run_id);

-- =====================================================================
-- CORE: CATÁLOGOS (hoja "Parametros" + "DATOS_OC_EMPRESAS")
-- =====================================================================

-- Empresas del portfolio (incluye FIP CEHTA, AFIS, portfolio companies)
CREATE TABLE IF NOT EXISTS core.empresas (
    empresa_id      SERIAL PRIMARY KEY,
    codigo          TEXT UNIQUE NOT NULL,           -- 'TRONGKAI','CSL','EVOQUE','DTE','REVTECH','CENERGY','RHO','AFIS','FIP_CEHTA'
    razon_social    TEXT NOT NULL,
    rut             TEXT UNIQUE NOT NULL,           -- formato 12.345.678-9
    giro            TEXT,
    direccion       TEXT,
    ciudad          TEXT,
    telefono        TEXT,
    representante_legal TEXT,
    email_firmante  TEXT,
    oc_prefix       TEXT,                           -- 'EE','OC','011' etc.
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Proveedores (catálogo creciente)
CREATE TABLE IF NOT EXISTS core.proveedores (
    proveedor_id    SERIAL PRIMARY KEY,
    razon_social    TEXT NOT NULL,
    rut             TEXT UNIQUE,
    giro            TEXT,
    direccion       TEXT,
    ciudad          TEXT,
    contacto        TEXT,
    telefono        TEXT,
    email           TEXT,
    banco           TEXT,
    tipo_cuenta     TEXT,
    numero_cuenta   TEXT,
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_rut ON core.proveedores(rut);

-- Taxonomía de conceptos (de hoja Parametros)
CREATE TABLE IF NOT EXISTS core.concepto_general (
    concepto_general TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS core.concepto_detallado (
    concepto_detallado TEXT PRIMARY KEY,
    concepto_general   TEXT REFERENCES core.concepto_general(concepto_general)
);

CREATE TABLE IF NOT EXISTS core.tipo_egreso (
    tipo_egreso TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS core.fuente (
    fuente TEXT PRIMARY KEY                        -- 'Corporativo','CORFO','PTEC', etc.
);

CREATE TABLE IF NOT EXISTS core.proyecto (
    proyecto TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS core.banco (
    banco TEXT PRIMARY KEY
);

-- =====================================================================
-- CORE: MOVIMIENTOS (la tabla gorda — hoja "Resumen")
-- =====================================================================
CREATE TABLE IF NOT EXISTS core.movimientos (
    movimiento_id       BIGSERIAL PRIMARY KEY,
    -- Identidad/idempotencia: hash de (fecha, descripcion, monto, empresa, banco)
    natural_key         TEXT UNIQUE NOT NULL,

    fecha               DATE NOT NULL,
    descripcion         TEXT,

    abono               NUMERIC(18,2) DEFAULT 0,
    egreso              NUMERIC(18,2) DEFAULT 0,
    saldo_contable      NUMERIC(18,2),
    saldo_cehta         NUMERIC(18,2),
    saldo_corfo         NUMERIC(18,2),

    concepto_general    TEXT REFERENCES core.concepto_general(concepto_general),
    concepto_detallado  TEXT REFERENCES core.concepto_detallado(concepto_detallado),
    tipo_egreso         TEXT REFERENCES core.tipo_egreso(tipo_egreso),
    fuente              TEXT REFERENCES core.fuente(fuente),
    proyecto            TEXT REFERENCES core.proyecto(proyecto),
    banco               TEXT REFERENCES core.banco(banco),

    real_proyectado     TEXT CHECK (real_proyectado IN ('Real','Proyectado')),
    anio                INT NOT NULL,
    periodo             TEXT NOT NULL,              -- '11_25', '02_26'
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo),

    iva_credito_fiscal  NUMERIC(18,2) DEFAULT 0,
    iva_debito_fiscal   NUMERIC(18,2) DEFAULT 0,

    tipo_documento      TEXT,                       -- 'Factura','BoletaHonoraria','SinDocumentar'
    numero_documento    TEXT,                       -- '29','64', etc.
    hipervinculo        TEXT,                       -- link Drive/Dropbox al respaldo

    run_id              UUID REFERENCES audit.etl_runs(run_id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mov_fecha        ON core.movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_empresa      ON core.movimientos(empresa_codigo);
CREATE INDEX IF NOT EXISTS idx_mov_proyecto     ON core.movimientos(proyecto);
CREATE INDEX IF NOT EXISTS idx_mov_periodo      ON core.movimientos(anio, periodo);
CREATE INDEX IF NOT EXISTS idx_mov_real_proy    ON core.movimientos(real_proyectado);

-- =====================================================================
-- CORE: ÓRDENES DE COMPRA
-- =====================================================================
CREATE TABLE IF NOT EXISTS core.ordenes_compra (
    oc_id           BIGSERIAL PRIMARY KEY,
    numero_oc       TEXT NOT NULL,                  -- 'EE-001-2026', '011-2026', 'OC001'
    empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo),
    proveedor_id    INT REFERENCES core.proveedores(proveedor_id),
    fecha_emision   DATE NOT NULL,
    validez_dias    INT DEFAULT 30,
    moneda          TEXT DEFAULT 'CLP' CHECK (moneda IN ('CLP','UF','USD')),
    neto            NUMERIC(18,2) NOT NULL,
    iva             NUMERIC(18,2) NOT NULL,
    total           NUMERIC(18,2) NOT NULL,
    forma_pago      TEXT,
    plazo_pago      TEXT,
    observaciones   TEXT,
    estado          TEXT DEFAULT 'emitida'          -- 'emitida','pagada','anulada'
                    CHECK (estado IN ('emitida','pagada','anulada','parcial')),
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_codigo, numero_oc)
);

CREATE TABLE IF NOT EXISTS core.ordenes_compra_detalle (
    detalle_id      BIGSERIAL PRIMARY KEY,
    oc_id           BIGINT NOT NULL REFERENCES core.ordenes_compra(oc_id) ON DELETE CASCADE,
    item            INT NOT NULL,
    descripcion     TEXT NOT NULL,
    precio_unitario NUMERIC(18,2) NOT NULL,
    cantidad        NUMERIC(18,4) NOT NULL,
    total_linea     NUMERIC(18,2) GENERATED ALWAYS AS (precio_unitario * cantidad) STORED,
    UNIQUE (oc_id, item)
);

-- =====================================================================
-- CORE: F29 (obligación tributaria mensual)
-- =====================================================================
CREATE TABLE IF NOT EXISTS core.f29_obligaciones (
    f29_id          BIGSERIAL PRIMARY KEY,
    empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo),
    periodo_tributario TEXT NOT NULL,               -- '02_26' = febrero 2026
    fecha_vencimiento DATE NOT NULL,
    monto_a_pagar   NUMERIC(18,2),
    fecha_pago      DATE,
    estado          TEXT DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','pagado','vencido','exento')),
    comprobante_url TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_codigo, periodo_tributario)
);

-- =====================================================================
-- CORE: SUSCRIPCIÓN DE ACCIONES FIP CEHTA ESG
-- =====================================================================
CREATE TABLE IF NOT EXISTS core.suscripciones_acciones (
    suscripcion_id     BIGSERIAL PRIMARY KEY,
    empresa_codigo     TEXT NOT NULL REFERENCES core.empresas(codigo),  -- quien emite acciones
    fecha_recibo       DATE NOT NULL,
    acciones_pagadas   NUMERIC(18,4) NOT NULL,
    monto_uf           NUMERIC(18,4),
    monto_clp          NUMERIC(18,2) NOT NULL,
    contrato_ref       TEXT,                        -- referencia a contrato original
    recibo_url         TEXT,
    firmado            BOOLEAN DEFAULT FALSE,
    fecha_firma        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- RAW: landing tables (volcado directo, preserva columnas originales)
-- =====================================================================
CREATE TABLE IF NOT EXISTS raw.resumen_excel (
    raw_id          BIGSERIAL PRIMARY KEY,
    run_id          UUID REFERENCES audit.etl_runs(run_id),
    source_row_num  INT,
    hipervinculo    TEXT,
    fecha           TEXT,
    descripcion     TEXT,
    abonos          TEXT,
    egreso          TEXT,
    saldo_contable  TEXT,
    saldo_cehta     TEXT,
    saldo_corfo     TEXT,
    concepto_general TEXT,
    concepto_detallado TEXT,
    tipo_egreso     TEXT,
    fuentes         TEXT,
    proyecto        TEXT,
    banco           TEXT,
    real_proyectado TEXT,
    anio            TEXT,
    periodo         TEXT,
    empresa         TEXT,
    iva_credito     TEXT,
    iva_debito      TEXT,
    loaded_at       TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- TRIGGERS: mantener updated_at
-- =====================================================================
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'core.empresas','core.proveedores','core.movimientos',
        'core.ordenes_compra','core.f29_obligaciones'
    ])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_touch ON %s; '
            'CREATE TRIGGER trg_touch BEFORE UPDATE ON %s '
            'FOR EACH ROW EXECUTE FUNCTION touch_updated_at();',
            t, t
        );
    END LOOP;
END$$;

-- =====================================================================
-- SEED: empresas del portfolio (ajustar según DATOS_OC_EMPRESAS.xlsx)
-- =====================================================================
INSERT INTO core.empresas (codigo, razon_social, rut, direccion, representante_legal, email_firmante, oc_prefix) VALUES
    ('TRONGKAI', 'Agrotecnologías e Ingeniería SpA', '77.221.203-8', '1 Sur 690 OF 815, Talca', 'Jaime Echevarria', 'jaime@trongkai.com', 'OC'),
    ('REVTECH',  'Ingeniería e Innovación SpA',       '77.018.739-7', 'Victoria 1260, Concepción',  'Camilo Salazar',   'camilo@revtech.cl', 'OC'),
    ('EVOQUE',   'Evoque Energy SpA',                  '76.282.088-9', 'Av Américo Vespucio Sur 80, Of 31, Las Condes', 'Jorge Ignacio Prieto', 'jiprieto@evoquenergy.com', 'EE'),
    ('DTE',      'DTE Consulting & Development SpA',   '77.826.369-6', 'Américo Vespucio Sur 1307 Of 813, Las Condes',  'Carmen Gloria Zúñiga', 'czuniga@dteconsulting.cl', '011'),
    ('CSL',      'Climate Smart Leasing SpA',          '77.868.887-5', 'Carriel Oriente 5865 Casa 59, Talcahuano',      'Juan Pablo González',  NULL, 'OC'),
    ('RHO',      'Rho Generación SpA',                 '77.931.386-7', 'General del Canto 50 Of 301, Providencia',      'Javier Álvarez Abarca', NULL, 'OC'),
    ('AFIS',     'Administradora de Fondos de la Industria Sostenible S.A.', '77.423.556-6', 'Américo Vespucio 80 Of 31, Las Condes', 'Guido Rietta', 'grietta@cenergy.cl', NULL),
    ('FIP_CEHTA','Fondo de Inversión Privado Cehta ESG','77.751.766-K', 'Américo Vespucio 80 Of 31, Las Condes', 'Guido Rietta', 'grietta@cenergy.cl', NULL),
    ('CENERGY',  'Consulting and Energy Ltda.',        NULL,           'Américo Vespucio 80 Of 31, Las Condes',  'Guido Rietta', 'grietta@cenergy.cl', NULL)
ON CONFLICT (codigo) DO UPDATE SET
    razon_social = EXCLUDED.razon_social,
    direccion    = EXCLUDED.direccion,
    updated_at   = now();

-- Los catálogos de conceptos/proyectos/bancos se auto-pueblan en el ETL
-- desde la hoja "Parametros" del Excel madre.

