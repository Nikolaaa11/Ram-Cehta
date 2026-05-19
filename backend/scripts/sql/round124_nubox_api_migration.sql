-- =====================================================================
-- Round 124 — API REST Oficial de Nubox (Factura y Administración)
-- =====================================================================
-- INSTRUCCIONES PARA NICOLAS:
--   1. Supabase Studio → SQL Editor → New query
--   2. Pegá todo y RUN
-- =====================================================================

-- 1. Extender el CHECK 'sistema' para soportar 'nubox_api'
ALTER TABLE core.empresa_credenciales
    DROP CONSTRAINT IF EXISTS chk_sistema;
ALTER TABLE core.empresa_credenciales
    ADD CONSTRAINT chk_sistema CHECK (sistema IN ('sii', 'previred', 'nubox', 'nubox_api'));

-- 2. Tabla de credenciales API Nubox (separada porque tiene 2 tokens, no 1 password)
CREATE TABLE IF NOT EXISTS core.nubox_api_credenciales (
    credencial_id           BIGSERIAL PRIMARY KEY,
    empresa_codigo          TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    -- Bearer token del partner integrador (Cehta como cliente Nubox)
    -- Este es el MISMO para todas las empresas del fondo
    partner_token_encrypted TEXT NOT NULL,
    -- X-Api-Key específica de cada empresa cliente
    company_api_key_encrypted TEXT NOT NULL,
    -- 'uat' o 'prod' — la base_url se infiere
    environment             TEXT NOT NULL DEFAULT 'uat',
    base_url                TEXT NOT NULL,
    -- Estado de validación
    ultima_validacion_at    TIMESTAMPTZ,
    ultima_validacion_ok    BOOLEAN,
    ultima_validacion_msg   TEXT,
    notas                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_env CHECK (environment IN ('uat', 'prod')),
    CONSTRAINT uq_empresa_env UNIQUE (empresa_codigo, environment)
);
CREATE INDEX IF NOT EXISTS idx_nubox_api_cred_empresa
    ON core.nubox_api_credenciales(empresa_codigo, environment);

-- 3. Registro de cada operación contra la API Nubox
CREATE TABLE IF NOT EXISTS core.nubox_api_runs (
    run_id              BIGSERIAL PRIMARY KEY,
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    tipo                TEXT NOT NULL,
    environment         TEXT NOT NULL,
    -- UUID que mandamos como X-Idempotence-Id (para no duplicar emisiones)
    idempotence_id      UUID,
    status              TEXT NOT NULL DEFAULT 'STARTED',
    http_status         INTEGER,
    request_body        JSONB,
    response_body       JSONB,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ,
    error_message       TEXT,
    triggered_by        UUID,
    CONSTRAINT chk_nubox_api_tipo CHECK (tipo IN (
        'emit_from_voucher', 'list_sales', 'get_sale',
        'get_pdf', 'get_xml', 'test_credentials'
    )),
    CONSTRAINT chk_nubox_api_status CHECK (status IN ('STARTED', 'OK', 'FAILED', 'PARTIAL'))
);
CREATE INDEX IF NOT EXISTS idx_nubox_api_runs_empresa
    ON core.nubox_api_runs(empresa_codigo, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_nubox_api_runs_idempotence
    ON core.nubox_api_runs(idempotence_id) WHERE idempotence_id IS NOT NULL;

-- 4. Ventas emitidas vía Nubox API (cada DTE oficial)
CREATE TABLE IF NOT EXISTS core.nubox_ventas (
    venta_id            BIGSERIAL PRIMARY KEY,
    empresa_codigo      TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    -- ID interno de Nubox (devuelto en la respuesta)
    nubox_document_id   BIGINT NOT NULL,
    -- Folio asignado por Nubox/SII
    folio               TEXT,
    tipo_dte            INTEGER NOT NULL,
    -- Periodo tributario YYYY-MM
    periodo             TEXT NOT NULL,
    fecha_emision       TIMESTAMPTZ,
    -- Cliente receptor
    cliente_rut         TEXT NOT NULL,
    cliente_razon_social TEXT,
    -- Montos
    monto_neto          BIGINT NOT NULL DEFAULT 0,
    monto_exento        BIGINT NOT NULL DEFAULT 0,
    monto_iva           BIGINT NOT NULL DEFAULT 0,
    monto_total         BIGINT NOT NULL DEFAULT 0,
    -- Estado emisión: 1=Emitido, 2=Borrador, 3=Anulado, 4=Espera SII, 5=Rechazado, etc.
    estado_emision_id   INTEGER,
    estado_emision_name TEXT,
    -- Track ID para consulta de estado SII
    sii_track_id        BIGINT,
    -- Si fue creado desde un voucher local
    voucher_id          BIGINT REFERENCES core.vouchers(voucher_id),
    -- Idempotence ID con que se emitió (X-Idempotence-Id)
    idempotence_id      UUID,
    -- Raw response para auditoría
    raw_data            JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_nubox_venta UNIQUE (empresa_codigo, nubox_document_id)
);
CREATE INDEX IF NOT EXISTS idx_nubox_ventas_empresa_periodo
    ON core.nubox_ventas(empresa_codigo, periodo);
CREATE INDEX IF NOT EXISTS idx_nubox_ventas_voucher
    ON core.nubox_ventas(voucher_id) WHERE voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nubox_ventas_folio
    ON core.nubox_ventas(empresa_codigo, tipo_dte, folio);

-- Verificación
SELECT 'core.nubox_api_credenciales' AS tabla,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'nubox_api_credenciales') AS existe
UNION ALL
SELECT 'core.nubox_api_runs',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'nubox_api_runs')
UNION ALL
SELECT 'core.nubox_ventas',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'nubox_ventas');
