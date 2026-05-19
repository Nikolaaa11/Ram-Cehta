-- =====================================================================
-- Round 117 — Infraestructura para descargar data del SII
-- =====================================================================
-- INSTRUCCIONES PARA NICOLAS:
--   Igual que round115_migration.sql:
--   1. Supabase Studio → SQL Editor → New query
--   2. Pegá todo este archivo y RUN
-- =====================================================================

-- 1. Registro de runs (cada vez que se gatilla un sync)
CREATE TABLE IF NOT EXISTS core.sii_sync_runs (
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
    CONSTRAINT chk_sii_tipo CHECK (tipo IN ('rcv_compras', 'rcv_ventas', 'f29', 'f22', 'test_login')),
    CONSTRAINT chk_sii_status CHECK (status IN ('STARTED', 'OK', 'FAILED', 'PARTIAL'))
);
CREATE INDEX IF NOT EXISTS idx_sii_runs_empresa
    ON core.sii_sync_runs(empresa_codigo, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sii_runs_status
    ON core.sii_sync_runs(status) WHERE status != 'OK';

-- 2. Documentos del SII (cada fila = una linea del RCV)
CREATE TABLE IF NOT EXISTS core.sii_documentos (
    sii_doc_id          BIGSERIAL PRIMARY KEY,
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    -- 'compra' o 'venta' segun el tipo de RCV
    flujo               TEXT NOT NULL,
    -- Tipo DTE segun la nomenclatura del SII (33=factura, 39=boleta, 61=nota credito, etc.)
    tipo_dte            INTEGER NOT NULL,
    -- Folio del documento (numero correlativo asignado por el emisor)
    folio               TEXT NOT NULL,
    -- Periodo tributario (YYYY-MM)
    periodo             TEXT NOT NULL,
    -- RUT del contribuyente "otro" (proveedor si compra, cliente si venta)
    rut_contraparte     TEXT NOT NULL,
    razon_social_contraparte TEXT,
    fecha_emision       DATE,
    fecha_recepcion     DATE,
    monto_exento        BIGINT NOT NULL DEFAULT 0,
    monto_neto          BIGINT NOT NULL DEFAULT 0,
    monto_iva           BIGINT NOT NULL DEFAULT 0,
    monto_total         BIGINT NOT NULL DEFAULT 0,
    -- 'REGISTRADO', 'NO_AFECTA', 'PENDIENTE', 'RECLAMADO' segun SII
    estado_sii          TEXT,
    -- Indica si ya se concilio con un voucher de la plataforma
    voucher_id          BIGINT REFERENCES core.vouchers(voucher_id),
    -- Run que descargo este registro
    run_id              BIGINT REFERENCES core.sii_sync_runs(run_id),
    raw_data            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sii_flujo CHECK (flujo IN ('compra', 'venta')),
    -- Dedupe: misma empresa + flujo + tipo + folio + RUT contraparte = mismo doc
    CONSTRAINT uq_sii_doc UNIQUE (empresa_codigo, flujo, tipo_dte, folio, rut_contraparte)
);
CREATE INDEX IF NOT EXISTS idx_sii_doc_empresa_periodo
    ON core.sii_documentos(empresa_codigo, periodo);
CREATE INDEX IF NOT EXISTS idx_sii_doc_unconciled
    ON core.sii_documentos(empresa_codigo, flujo) WHERE voucher_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_sii_doc_rut_contraparte
    ON core.sii_documentos(rut_contraparte);

-- Verificación
SELECT 'core.sii_sync_runs' AS tabla,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'sii_sync_runs') AS existe
UNION ALL
SELECT 'core.sii_documentos',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'sii_documentos');
