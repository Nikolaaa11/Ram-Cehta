-- ============================================================================
-- Round 152 — Dashboard Institucional CEHTA Capital
-- ============================================================================
-- Modelo de datos para vistas /dashboard/directorio + /dashboard/inversionistas
-- Estandar ILPA v2.0 + IRIS+ v5.3 + OPIM + ICMA GBP + B Corp + Impact Frontiers
--
-- Tablas creadas:
--   funds                       - fondo de inversion (FIP CEHTA ESG)
--   limited_partners            - aportantes (CORFO + privados + institucionales)
--   portfolio_companies_meta    - metadata adicional de portfolio companies
--                                 (REUSAMOS core.empresas existente + JOIN)
--   company_valuations          - timeseries valuaciones (FV, MOIC, IRR)
--   fund_cashflows              - capital calls + distributions + fees
--   company_operational_kpis    - revenue, EBITDA, runway por compania/mes
--   impact_metrics              - IRIS+ v5.3 (tCO2e, MWh, jobs, etc.)
--   company_sdg_alignment       - SDGs 1-17 por compania
--   company_impact_dimensions   - Impact Frontiers 5-dim (what/who/howmuch/...)
--   compliance_checks_institutional - OPIM, ICMA GBP, ILPA framework status
--   lp_documents                - documentos por LP (visibility-aware)
--
-- Roles institucionales agregados a core.user_company_roles:
--   LP_CORFO, LP_PRIVADO, AUDITOR_EXTERNO (sumar a los 6 existentes)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS core;

-- ============================================================================
-- 1. FUNDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.funds (
    fund_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo           TEXT UNIQUE NOT NULL,
    nombre           TEXT NOT NULL,
    vintage_year     INT NOT NULL,
    fund_size_committed_usd NUMERIC(18, 2) NOT NULL,
    inception_date   DATE NOT NULL,
    end_of_investment_period DATE,
    end_of_fund      DATE,
    base_currency    CHAR(3) DEFAULT 'USD',
    reporting_standard TEXT DEFAULT 'ILPA_v2.0',
    aum_current_usd  NUMERIC(18, 2),
    descripcion      TEXT,
    administradora   TEXT,
    regulador        TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE core.funds IS 'Fondos de inversion administrados (e.g. FIP CEHTA ESG).';

-- ============================================================================
-- 2. LIMITED PARTNERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.limited_partners (
    lp_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id          UUID NOT NULL REFERENCES core.funds(fund_id) ON DELETE CASCADE,
    legal_name       TEXT NOT NULL,
    lp_type          TEXT NOT NULL CHECK (lp_type IN ('publico_corfo', 'privado', 'institucional')),
    rut              TEXT,
    domicile         TEXT DEFAULT 'CL',
    commitment_usd   NUMERIC(18, 2) NOT NULL CHECK (commitment_usd >= 0),
    paid_in_usd      NUMERIC(18, 2) DEFAULT 0,
    distributed_usd  NUMERIC(18, 2) DEFAULT 0,
    ownership_pct    NUMERIC(7, 4),
    side_letter_url  TEXT,
    contact_email    TEXT,
    contact_name     TEXT,
    user_id          UUID,  -- FK soft a auth.users.id (para mapear acceso del LP a su data)
    notas            TEXT,
    active           BOOLEAN DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lp_fund ON core.limited_partners(fund_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_lp_user ON core.limited_partners(user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE core.limited_partners IS 'Aportantes del fondo (CORFO + privados).';
COMMENT ON COLUMN core.limited_partners.user_id IS 'Soft FK a auth.users — mapea LP <-> usuario logueado para RLS.';

-- ============================================================================
-- 3. PORTFOLIO COMPANIES META
--    (reusa core.empresas + agrega campos de fund management)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.portfolio_companies_meta (
    empresa_codigo   TEXT PRIMARY KEY REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    fund_id          UUID NOT NULL REFERENCES core.funds(fund_id),
    is_portfolio     BOOLEAN DEFAULT FALSE,  -- TRUE solo para las 6 portfolio companies (no holding)
    ticker           TEXT,
    sector           TEXT,
    stage            TEXT CHECK (stage IN ('seed', 'early', 'growth', 'mature')),
    thesis           TEXT,
    invested_at      DATE,
    ownership_pct    NUMERIC(7, 4),
    b_corp_certified BOOLEAN DEFAULT FALSE,
    b_corp_score     NUMERIC(5, 1),
    is_public_disclosure BOOLEAN DEFAULT TRUE,  -- si LP ve nombre/data del company
    geo_lat          NUMERIC(9, 6),
    geo_lng          NUMERIC(9, 6),
    geo_region       TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE core.portfolio_companies_meta IS
  'Metadata fund-management de cada empresa (no reemplaza core.empresas; la complementa).';

-- ============================================================================
-- 4. COMPANY VALUATIONS (timeseries)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.company_valuations (
    valuation_id     BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
    as_of_date       DATE NOT NULL,
    invested_amount_usd NUMERIC(18, 2),
    realized_value_usd  NUMERIC(18, 2) DEFAULT 0,
    unrealized_fv_usd   NUMERIC(18, 2),
    moic_gross       NUMERIC(7, 3),
    moic_net         NUMERIC(7, 3),
    irr_gross        NUMERIC(7, 4),
    irr_net          NUMERIC(7, 4),
    valuation_method TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_val_company_date ON core.company_valuations(empresa_codigo, as_of_date DESC);

-- ============================================================================
-- 5. FUND CASHFLOWS (capital calls + distributions + fees)
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE core.cashflow_type AS ENUM (
        'capital_call',
        'distribution',
        'management_fee',
        'expense',
        'carried_interest',
        'subscription_line_draw'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS core.fund_cashflows (
    cashflow_id      BIGSERIAL PRIMARY KEY,
    fund_id          UUID NOT NULL REFERENCES core.funds(fund_id),
    lp_id            UUID REFERENCES core.limited_partners(lp_id),  -- NULL = fund-level
    cashflow_type    core.cashflow_type NOT NULL,
    amount_usd       NUMERIC(18, 2) NOT NULL,
    effective_date   DATE NOT NULL,
    notice_date      DATE,
    descripcion      TEXT,
    ilpa_category    TEXT,
    recallable       BOOLEAN DEFAULT FALSE,
    voucher_id       BIGINT,  -- soft link a core.vouchers si el cashflow vino de un voucher
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_fund_date ON core.fund_cashflows(fund_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_cf_lp_date ON core.fund_cashflows(lp_id, effective_date DESC) WHERE lp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cf_type ON core.fund_cashflows(cashflow_type);

-- ============================================================================
-- 6. COMPANY OPERATIONAL KPIs (revenue, EBITDA, runway, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.company_operational_kpis (
    kpi_id           BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
    period           DATE NOT NULL,  -- mes
    revenue_usd      NUMERIC(18, 2),
    ebitda_usd       NUMERIC(18, 2),
    ebitda_margin    NUMERIC(5, 2),
    gross_margin     NUMERIC(5, 2),
    cash_balance_usd NUMERIC(18, 2),
    burn_rate_usd    NUMERIC(18, 2),
    cash_runway_months NUMERIC(5, 1),
    headcount        INT,
    -- cleantech specific
    mw_installed     NUMERIC(10, 2),
    capacity_factor  NUMERIC(5, 2),
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, period)
);

CREATE INDEX IF NOT EXISTS idx_opkpi_company_period
    ON core.company_operational_kpis(empresa_codigo, period DESC);

-- ============================================================================
-- 7. IMPACT METRICS (IRIS+ v5.3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.impact_metrics (
    impact_id        BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT REFERENCES core.empresas(codigo),
    fund_id          UUID REFERENCES core.funds(fund_id),
    period           DATE NOT NULL,
    iris_metric_id   TEXT NOT NULL,  -- 'PI2764', 'OI2535', 'PI5842', etc.
    metric_name      TEXT NOT NULL,
    metric_value     NUMERIC(18, 4) NOT NULL,
    unit             TEXT NOT NULL,
    framework        TEXT DEFAULT 'IRIS+_v5.3',  -- IRIS+, ICMA_GBP, JIM, etc.
    verified         BOOLEAN DEFAULT FALSE,
    verifier         TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, period, iris_metric_id),
    CHECK (empresa_codigo IS NOT NULL OR fund_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_impact_company ON core.impact_metrics(empresa_codigo, period DESC) WHERE empresa_codigo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_impact_fund ON core.impact_metrics(fund_id, period DESC) WHERE fund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_impact_iris ON core.impact_metrics(iris_metric_id);

-- ============================================================================
-- 8. SDG ALIGNMENT (UN SDGs 1-17)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.company_sdg_alignment (
    sdg_alignment_id BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
    sdg_number       INT NOT NULL CHECK (sdg_number BETWEEN 1 AND 17),
    alignment_score  INT NOT NULL CHECK (alignment_score BETWEEN 0 AND 5),
    evidence         TEXT,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, sdg_number)
);

-- ============================================================================
-- 9. IMPACT DIMENSIONS (Impact Frontiers 5-dim framework)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.company_impact_dimensions (
    dim_id           BIGSERIAL PRIMARY KEY,
    empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
    as_of_date       DATE NOT NULL,
    what_score       INT CHECK (what_score BETWEEN 1 AND 5),
    who_score        INT CHECK (who_score BETWEEN 1 AND 5),
    how_much_score   INT CHECK (how_much_score BETWEEN 1 AND 5),
    contribution_score INT CHECK (contribution_score BETWEEN 1 AND 5),
    risk_score       INT CHECK (risk_score BETWEEN 1 AND 5),
    narrative        TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(empresa_codigo, as_of_date)
);

-- ============================================================================
-- 10. COMPLIANCE CHECKS INSTITUCIONALES (OPIM, CMF, UAF, CORFO, ICMA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS core.compliance_checks_institutional (
    check_id         BIGSERIAL PRIMARY KEY,
    fund_id          UUID NOT NULL REFERENCES core.funds(fund_id),
    framework        TEXT NOT NULL,  -- 'OPIM', 'CMF_NCG532', 'CMF_NCG554', 'UAF', 'CORFO', 'ICMA_GBP'
    principle_or_item TEXT NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('cumple', 'en_proceso', 'no_cumple', 'no_aplica')),
    evidence_url     TEXT,
    last_review_date DATE,
    next_review_date DATE,
    owner_user_id    UUID,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_fund_framework
    ON core.compliance_checks_institutional(fund_id, framework);

-- ============================================================================
-- 11. LP DOCUMENTS (con visibility por rol)
-- ============================================================================
-- NOTA: renombramos a lp_documents_institutional porque ya existe una tabla
-- core.lp_documents legacy con schema distinto (lp_doc_id, tipo, fecha_firma, etc.)
-- usada por otro flujo. No la tocamos.
CREATE TABLE IF NOT EXISTS core.lp_documents_institutional (
    doc_id           BIGSERIAL PRIMARY KEY,
    fund_id          UUID NOT NULL REFERENCES core.funds(fund_id),
    lp_id            UUID REFERENCES core.limited_partners(lp_id),  -- NULL = general
    doc_type         TEXT NOT NULL,  -- 'quarterly_letter', 'capital_call_notice', 'k1', 'financial_statements', 'side_letter', 'subscription_agreement'
    title            TEXT NOT NULL,
    storage_path     TEXT NOT NULL,  -- Dropbox path o similar
    visibility       TEXT NOT NULL CHECK (visibility IN ('director_only', 'all_lps', 'lp_specific')),
    reporting_period DATE,
    uploaded_by      UUID,
    uploaded_at      TIMESTAMPTZ DEFAULT NOW(),
    download_count   INT DEFAULT 0,
    requires_mfa     BOOLEAN DEFAULT FALSE  -- TRUE para K-1, side letters, subscription agreements
);

CREATE INDEX IF NOT EXISTS idx_lpdocins_fund ON core.lp_documents_institutional(fund_id);
CREATE INDEX IF NOT EXISTS idx_lpdocins_lp ON core.lp_documents_institutional(lp_id) WHERE lp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lpdocins_visibility ON core.lp_documents_institutional(visibility);

-- ============================================================================
-- 12. ACTUALIZAR core.user_company_roles para soportar roles institucionales
-- ============================================================================
-- Los roles GG, COO, CONTADOR, OPERADOR, DIRECTOR, TESORERIA ya existen.
-- Agregamos los institucionales: LP_CORFO, LP_PRIVADO, AUDITOR_EXTERNO

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'core'
      AND rel.relname = 'user_company_roles'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%role%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE core.user_company_roles DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE core.user_company_roles
        ADD CONSTRAINT user_company_roles_role_check
        CHECK (role IN (
            'GG', 'COO', 'CONTADOR', 'OPERADOR', 'DIRECTOR', 'TESORERIA',
            'LP_CORFO', 'LP_PRIVADO', 'AUDITOR_EXTERNO'
        ));
END $$;

-- ============================================================================
-- VISTAS DERIVADAS (para simplificar queries de los gráficos)
-- ============================================================================

-- Vista agregada del fondo (G01 KPI Row source)
CREATE OR REPLACE VIEW core.v_fund_metrics AS
SELECT
    f.fund_id,
    f.codigo AS fund_codigo,
    f.nombre AS fund_nombre,
    f.fund_size_committed_usd AS commitments_total_usd,
    COALESCE(SUM(CASE WHEN cf.cashflow_type = 'capital_call' THEN cf.amount_usd ELSE 0 END), 0) AS called_total_usd,
    COALESCE(SUM(CASE WHEN cf.cashflow_type = 'distribution' THEN cf.amount_usd ELSE 0 END), 0) AS distributed_total_usd,
    f.aum_current_usd AS current_nav_usd,
    f.fund_size_committed_usd - COALESCE(SUM(CASE WHEN cf.cashflow_type = 'capital_call' THEN cf.amount_usd ELSE 0 END), 0) AS unfunded_commitments_usd
FROM core.funds f
LEFT JOIN core.fund_cashflows cf ON cf.fund_id = f.fund_id AND cf.lp_id IS NULL
GROUP BY f.fund_id, f.codigo, f.nombre, f.fund_size_committed_usd, f.aum_current_usd;

-- Vista J-Curve (cashflow neto acumulado por trimestre)
CREATE OR REPLACE VIEW core.v_jcurve AS
SELECT
    fund_id,
    DATE_TRUNC('quarter', effective_date)::DATE AS quarter,
    SUM(CASE WHEN cashflow_type = 'capital_call' THEN -amount_usd
             WHEN cashflow_type = 'distribution' THEN amount_usd
             ELSE 0 END) AS quarter_net,
    SUM(SUM(CASE WHEN cashflow_type = 'capital_call' THEN -amount_usd
                 WHEN cashflow_type = 'distribution' THEN amount_usd
                 ELSE 0 END))
        OVER (PARTITION BY fund_id ORDER BY DATE_TRUNC('quarter', effective_date)) AS cumulative_net
FROM core.fund_cashflows
WHERE lp_id IS NULL  -- fund-level only para esta vista
GROUP BY fund_id, DATE_TRUNC('quarter', effective_date);

-- ============================================================================
-- AUDIT LOG INSTITUCIONAL (extiende audit.action_log existente)
-- ============================================================================
-- Reusa audit.action_log que ya existe. Solo agregamos los nuevos action types
-- como convencion (no requiere migración de schema).
-- Convenciones:
--   - 'dashboard_view_director'
--   - 'dashboard_view_lp'
--   - 'export_pdf_ilpa'
--   - 'export_excel_ilpa'
--   - 'document_download_lp'

-- ============================================================================
-- SEED DATA INICIAL
-- ============================================================================

-- Fondo principal: FIP CEHTA ESG
INSERT INTO core.funds (
    codigo, nombre, vintage_year, fund_size_committed_usd,
    inception_date, end_of_investment_period, end_of_fund,
    base_currency, reporting_standard, aum_current_usd,
    descripcion, administradora, regulador
) VALUES (
    'FIP_CEHTA_ESG',
    'FIP CEHTA ESG',
    2024,
    22500000.00,  -- USD 22.5M AUM segun prompt
    '2024-01-15',
    '2027-12-31',
    '2034-12-31',
    'USD',
    'ILPA_v2.0',
    22500000.00,
    'Fondo de Inversion Privado enfocado en economia circular y cleantech LatAm.',
    'AFIS S.A. (Administradora de Fondos de la Industria Sostenible)',
    'CMF Chile · NCG 532 + NCG 554'
)
ON CONFLICT (codigo) DO NOTHING;

-- Mapear las 6 portfolio companies + 4 entidades holding
DO $$
DECLARE
    v_fund_id UUID;
BEGIN
    SELECT fund_id INTO v_fund_id FROM core.funds WHERE codigo = 'FIP_CEHTA_ESG';

    -- 6 PORTFOLIO companies (las que generan valor para el fondo)
    INSERT INTO core.portfolio_companies_meta (empresa_codigo, fund_id, is_portfolio, ticker, sector, stage, thesis, invested_at)
    VALUES
        ('CSL',      v_fund_id, TRUE, 'CSL',      'Leasing equipos cleantech',           'growth',  'Leasing de equipos cleantech para PYMES sin acceso a financiamiento bancario tradicional.', '2024-03-01'),
        ('RHO',      v_fund_id, TRUE, 'RHO',      'Generacion renovable',                'growth',  'Generacion electrica renovable distribuida (PMGD + autoconsumo).', '2024-04-01'),
        ('DTE',      v_fund_id, TRUE, 'DTE',      'Consultoria energetica',              'early',   'Consultoria y desarrollo de proyectos cleantech para corporates.', '2024-05-01'),
        ('REVTECH',  v_fund_id, TRUE, 'REVTECH',  'Innovacion tecnologica',              'early',   'Tecnologias propias para mineria de bajo impacto y revalorizacion de escorias.', '2024-06-01'),
        ('EVOQUE',   v_fund_id, TRUE, 'EVOQUE',   'Valorizacion residuos / nuevos materiales', 'early', 'Valorizacion de residuos industriales en nuevos materiales (silice, baritina).', '2024-07-01'),
        ('TRONGKAI', v_fund_id, TRUE, 'TRONGKAI', 'Agro-cleantech',                      'early',   'Valorizacion de subproductos agroalimentarios (PEF, alperujo, cenizas).', '2024-08-01')
    ON CONFLICT (empresa_codigo) DO UPDATE SET
        fund_id = EXCLUDED.fund_id,
        is_portfolio = EXCLUDED.is_portfolio,
        ticker = EXCLUDED.ticker,
        sector = EXCLUDED.sector,
        stage = EXCLUDED.stage,
        updated_at = NOW();

    -- 4 entidades HOLDING / FUND (no son portfolio, son estructura)
    INSERT INTO core.portfolio_companies_meta (empresa_codigo, fund_id, is_portfolio, ticker, sector, is_public_disclosure)
    VALUES
        ('AFIS',      v_fund_id, FALSE, 'AFIS',      'Administradora de Fondos',  FALSE),
        ('FIP_CEHTA', v_fund_id, FALSE, 'FIP_CEHTA', 'Fondo de Inversion',         FALSE),
        ('CEHTA',     v_fund_id, FALSE, 'CEHTA',     'Holding',                    FALSE),
        ('CENERGY',   v_fund_id, FALSE, 'CENERGY',   'Servicios energeticos',      FALSE)
    ON CONFLICT (empresa_codigo) DO UPDATE SET
        is_portfolio = EXCLUDED.is_portfolio,
        is_public_disclosure = EXCLUDED.is_public_disclosure,
        updated_at = NOW();

    -- 2 LPs placeholder (1 CORFO publico + 1 privado)
    INSERT INTO core.limited_partners (
        fund_id, legal_name, lp_type, rut, commitment_usd, paid_in_usd,
        contact_email, contact_name, active
    ) VALUES
        (v_fund_id, 'CORFO - Corporacion de Fomento de la Produccion',
         'publico_corfo', '60.706.000-2', 11250000.00, 2500000.00,
         'contacto@corfo.cl', 'Ejecutivo CORFO', TRUE),
        (v_fund_id, 'Aportante Privado #1 (placeholder)',
         'privado', NULL, 11250000.00, 2500000.00,
         'placeholder@example.cl', 'Por definir', TRUE)
    ON CONFLICT DO NOTHING;
END $$;

-- ============================================================================
-- VERIFICACION
-- ============================================================================
DO $$
DECLARE
    v_funds INT;
    v_lps INT;
    v_portcos INT;
BEGIN
    SELECT COUNT(*) INTO v_funds FROM core.funds;
    SELECT COUNT(*) INTO v_lps FROM core.limited_partners;
    SELECT COUNT(*) INTO v_portcos FROM core.portfolio_companies_meta WHERE is_portfolio = TRUE;

    RAISE NOTICE 'R152 OK: % funds, % LPs, % portfolio companies', v_funds, v_lps, v_portcos;
END $$;
