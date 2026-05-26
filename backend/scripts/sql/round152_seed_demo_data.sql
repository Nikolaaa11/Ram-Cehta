-- ============================================================================
-- Round 152 — Seed demo data para dashboard institucional
-- ============================================================================
-- Genera cashflows, valuations, KPIs operativos e impact metrics realistas
-- para que el dashboard tenga algo que mostrar de entrada.
-- Estos valores son DEMO — el usuario debe reemplazarlos con datos reales.
-- ============================================================================

DO $$
DECLARE
    v_fund_id UUID;
    v_lp_corfo UUID;
    v_lp_priv UUID;
    v_q DATE;
    v_company TEXT;
    v_companies TEXT[] := ARRAY['CSL', 'RHO', 'DTE', 'REVTECH', 'EVOQUE', 'TRONGKAI'];
    v_invested NUMERIC;
    v_fv NUMERIC;
    v_moic NUMERIC;
BEGIN
    SELECT fund_id INTO v_fund_id FROM core.funds WHERE codigo = 'FIP_CEHTA_ESG';

    SELECT lp_id INTO v_lp_corfo FROM core.limited_partners
    WHERE fund_id = v_fund_id AND lp_type = 'publico_corfo' LIMIT 1;

    SELECT lp_id INTO v_lp_priv FROM core.limited_partners
    WHERE fund_id = v_fund_id AND lp_type = 'privado' LIMIT 1;

    -- ========================================================
    -- 1. CAPITAL CALLS (cumulative deployment del fund)
    -- ========================================================
    -- Fund-level cashflows (para J-curve y fund metrics)
    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion) VALUES
        (v_fund_id, NULL, 'capital_call', 2500000, '2024-03-15', 'Capital call #1 — initial deployment'),
        (v_fund_id, NULL, 'capital_call', 1800000, '2024-06-15', 'Capital call #2 — primeras inversiones'),
        (v_fund_id, NULL, 'capital_call', 1200000, '2024-09-15', 'Capital call #3'),
        (v_fund_id, NULL, 'capital_call', 1500000, '2024-12-15', 'Capital call #4 — cierre 2024'),
        (v_fund_id, NULL, 'capital_call', 2200000, '2025-03-15', 'Capital call #5 — 2025'),
        (v_fund_id, NULL, 'capital_call', 1700000, '2025-06-15', 'Capital call #6'),
        (v_fund_id, NULL, 'capital_call', 1400000, '2025-09-15', 'Capital call #7'),
        (v_fund_id, NULL, 'capital_call', 900000,  '2025-12-15', 'Capital call #8 — cierre 2025'),
        (v_fund_id, NULL, 'capital_call', 1300000, '2026-03-15', 'Capital call #9 — 2026'),
        (v_fund_id, NULL, 'capital_call', 800000,  '2026-05-15', 'Capital call #10');

    -- Management fees fund-level
    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion) VALUES
        (v_fund_id, NULL, 'management_fee', 280000, '2024-12-31', 'Management fee 2024 (2% AUM)'),
        (v_fund_id, NULL, 'management_fee', 450000, '2025-12-31', 'Management fee 2025'),
        (v_fund_id, NULL, 'management_fee', 225000, '2026-06-30', 'Management fee H1 2026');

    -- Una distribucion temprana (caso real: realized de un asset)
    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion) VALUES
        (v_fund_id, NULL, 'distribution', 350000, '2025-09-30', 'Realized gain DTE consulting milestone');

    -- Cashflows por LP (50/50 split: CORFO + privado)
    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion)
    SELECT
        v_fund_id, v_lp_corfo, 'capital_call', amount_usd / 2, effective_date,
        descripcion || ' (CORFO 50%)'
    FROM core.fund_cashflows
    WHERE fund_id = v_fund_id AND lp_id IS NULL AND cashflow_type = 'capital_call';

    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion)
    SELECT
        v_fund_id, v_lp_priv, 'capital_call', amount_usd / 2, effective_date,
        descripcion || ' (Privado 50%)'
    FROM core.fund_cashflows
    WHERE fund_id = v_fund_id AND lp_id IS NULL AND cashflow_type = 'capital_call';

    -- Distribuciones por LP
    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion)
    SELECT
        v_fund_id, v_lp_corfo, 'distribution', amount_usd / 2, effective_date,
        descripcion || ' (CORFO 50%)'
    FROM core.fund_cashflows
    WHERE fund_id = v_fund_id AND lp_id IS NULL AND cashflow_type = 'distribution';

    INSERT INTO core.fund_cashflows (fund_id, lp_id, cashflow_type, amount_usd, effective_date, descripcion)
    SELECT
        v_fund_id, v_lp_priv, 'distribution', amount_usd / 2, effective_date,
        descripcion || ' (Privado 50%)'
    FROM core.fund_cashflows
    WHERE fund_id = v_fund_id AND lp_id IS NULL AND cashflow_type = 'distribution';

    -- Actualizar paid_in y distributed de los LPs
    UPDATE core.limited_partners SET
        paid_in_usd = (
            SELECT COALESCE(SUM(amount_usd), 0)
            FROM core.fund_cashflows
            WHERE fund_id = v_fund_id AND lp_id = limited_partners.lp_id AND cashflow_type = 'capital_call'
        ),
        distributed_usd = (
            SELECT COALESCE(SUM(amount_usd), 0)
            FROM core.fund_cashflows
            WHERE fund_id = v_fund_id AND lp_id = limited_partners.lp_id AND cashflow_type = 'distribution'
        ),
        ownership_pct = 50.00
    WHERE fund_id = v_fund_id;

    -- ========================================================
    -- 2. COMPANY VALUATIONS (por trimestre, 6 portfolio companies)
    -- ========================================================
    -- Datos realistas: cada compañía con MOIC 1.0x → 1.5x progresivo
    INSERT INTO core.company_valuations (empresa_codigo, as_of_date, invested_amount_usd, realized_value_usd, unrealized_fv_usd, moic_gross, moic_net, irr_gross, irr_net, valuation_method)
    VALUES
        -- CSL — leasing equipos cleantech
        ('CSL', '2024-12-31', 1200000, 0,      1250000, 1.04, 1.00, 0.08,  0.04, 'DCF'),
        ('CSL', '2025-06-30', 1500000, 0,      1620000, 1.08, 1.04, 0.12,  0.08, 'DCF'),
        ('CSL', '2025-12-31', 1800000, 0,      2010000, 1.12, 1.08, 0.15,  0.11, 'DCF'),
        ('CSL', '2026-03-31', 2000000, 0,      2280000, 1.14, 1.10, 0.16,  0.12, 'DCF'),
        -- RHO — generacion renovable
        ('RHO', '2024-12-31', 1500000, 0,      1500000, 1.00, 0.96, 0.00,  -0.04, 'Multiples'),
        ('RHO', '2025-06-30', 1800000, 0,      1980000, 1.10, 1.06, 0.18,  0.13, 'Multiples'),
        ('RHO', '2025-12-31', 2200000, 50000,  2420000, 1.12, 1.08, 0.20,  0.15, 'Multiples'),
        ('RHO', '2026-03-31', 2400000, 50000,  2640000, 1.12, 1.08, 0.18,  0.13, 'Multiples'),
        -- DTE — consultoria energetica
        ('DTE', '2024-12-31', 800000,  0,      800000,  1.00, 0.96, 0.00,  -0.04, 'Multiples'),
        ('DTE', '2025-06-30', 900000,  100000, 945000,  1.16, 1.12, 0.32,  0.27, 'Multiples'),
        ('DTE', '2025-12-31', 1100000, 350000, 990000,  1.22, 1.17, 0.38,  0.33, 'Multiples'),
        ('DTE', '2026-03-31', 1100000, 350000, 1045000, 1.27, 1.22, 0.40,  0.35, 'Multiples'),
        -- REVTECH — innovacion tecnologica
        ('REVTECH', '2024-12-31', 1000000, 0, 1000000, 1.00, 0.96, 0.00,  -0.04, 'DCF'),
        ('REVTECH', '2025-06-30', 1200000, 0, 1296000, 1.08, 1.04, 0.15,  0.10, 'DCF'),
        ('REVTECH', '2025-12-31', 1400000, 0, 1554000, 1.11, 1.07, 0.18,  0.13, 'DCF'),
        ('REVTECH', '2026-03-31', 1500000, 0, 1680000, 1.12, 1.08, 0.17,  0.12, 'DCF'),
        -- EVOQUE — valorizacion residuos
        ('EVOQUE', '2024-12-31', 1100000, 0, 1100000, 1.00, 0.96, 0.00,  -0.04, 'DCF'),
        ('EVOQUE', '2025-06-30', 1300000, 0, 1430000, 1.10, 1.06, 0.18,  0.13, 'DCF'),
        ('EVOQUE', '2025-12-31', 1500000, 0, 1725000, 1.15, 1.11, 0.22,  0.17, 'DCF'),
        ('EVOQUE', '2026-03-31', 1700000, 0, 1989000, 1.17, 1.13, 0.24,  0.19, 'DCF'),
        -- TRONGKAI — agro-cleantech
        ('TRONGKAI', '2024-12-31', 900000,  0, 900000,  1.00, 0.96, 0.00,  -0.04, 'DCF'),
        ('TRONGKAI', '2025-06-30', 1100000, 0, 1166000, 1.06, 1.02, 0.10,  0.06, 'DCF'),
        ('TRONGKAI', '2025-12-31', 1300000, 0, 1430000, 1.10, 1.06, 0.15,  0.11, 'DCF'),
        ('TRONGKAI', '2026-03-31', 1400000, 0, 1568000, 1.12, 1.08, 0.17,  0.13, 'DCF')
    ON CONFLICT (empresa_codigo, as_of_date) DO NOTHING;

    -- ========================================================
    -- 3. COMPANY OPERATIONAL KPIs (revenue/EBITDA/runway 6 ult meses)
    -- ========================================================
    INSERT INTO core.company_operational_kpis (empresa_codigo, period, revenue_usd, ebitda_usd, ebitda_margin, cash_balance_usd, burn_rate_usd, cash_runway_months, headcount, gross_margin) VALUES
        ('CSL',      '2025-12-01', 480000, 95000,  19.8, 850000, 65000, 13.1, 28, 38.5),
        ('CSL',      '2026-01-01', 510000, 102000, 20.0, 900000, 60000, 15.0, 28, 39.0),
        ('CSL',      '2026-02-01', 530000, 110000, 20.8, 880000, 55000, 16.0, 30, 39.5),
        ('CSL',      '2026-03-01', 565000, 120000, 21.2, 920000, 50000, 18.4, 32, 40.0),
        ('CSL',      '2026-04-01', 590000, 125000, 21.2, 950000, 52000, 18.3, 33, 40.2),
        ('CSL',      '2026-05-01', 615000, 132000, 21.5, 980000, 50000, 19.6, 34, 41.0),

        ('RHO',      '2025-12-01', 320000, 45000,  14.0, 540000, 80000, 6.8,  15, 32.0),
        ('RHO',      '2026-01-01', 340000, 52000,  15.3, 580000, 75000, 7.7,  16, 33.5),
        ('RHO',      '2026-02-01', 360000, 58000,  16.1, 600000, 72000, 8.3,  16, 34.0),
        ('RHO',      '2026-03-01', 385000, 62000,  16.1, 620000, 70000, 8.9,  17, 34.5),
        ('RHO',      '2026-04-01', 395000, 65000,  16.5, 650000, 68000, 9.6,  17, 35.0),
        ('RHO',      '2026-05-01', 420000, 72000,  17.1, 670000, 66000, 10.2, 18, 35.5),

        ('DTE',      '2025-12-01', 240000, 38000,  15.8, 380000, 42000, 9.0,  12, 45.0),
        ('DTE',      '2026-01-01', 260000, 45000,  17.3, 410000, 40000, 10.3, 13, 46.0),
        ('DTE',      '2026-02-01', 280000, 52000,  18.6, 440000, 38000, 11.6, 13, 47.0),
        ('DTE',      '2026-03-01', 295000, 58000,  19.7, 470000, 36000, 13.1, 14, 47.5),
        ('DTE',      '2026-04-01', 310000, 62000,  20.0, 490000, 36000, 13.6, 14, 48.0),
        ('DTE',      '2026-05-01', 325000, 68000,  20.9, 510000, 34000, 15.0, 15, 48.5),

        ('REVTECH',  '2025-12-01', 180000, -22000, -12.2, 320000, 55000, 5.8,  8,  28.0),
        ('REVTECH',  '2026-01-01', 195000, -18000, -9.2,  290000, 52000, 5.6,  9,  29.0),
        ('REVTECH',  '2026-02-01', 215000, -12000, -5.6,  270000, 50000, 5.4,  9,  30.0),
        ('REVTECH',  '2026-03-01', 235000, -5000,  -2.1,  250000, 48000, 5.2,  10, 31.5),
        ('REVTECH',  '2026-04-01', 255000, 8000,   3.1,   240000, 45000, 5.3,  10, 33.0),
        ('REVTECH',  '2026-05-01', 280000, 18000,  6.4,   235000, 44000, 5.3,  11, 34.5),

        ('EVOQUE',   '2025-12-01', 295000, 42000,  14.2, 480000, 55000, 8.7,  14, 36.0),
        ('EVOQUE',   '2026-01-01', 315000, 50000,  15.9, 510000, 52000, 9.8,  15, 37.0),
        ('EVOQUE',   '2026-02-01', 335000, 56000,  16.7, 540000, 50000, 10.8, 15, 38.0),
        ('EVOQUE',   '2026-03-01', 360000, 62000,  17.2, 565000, 48000, 11.8, 16, 38.5),
        ('EVOQUE',   '2026-04-01', 385000, 68000,  17.7, 590000, 47000, 12.6, 16, 39.0),
        ('EVOQUE',   '2026-05-01', 410000, 75000,  18.3, 615000, 45000, 13.7, 17, 39.5),

        ('TRONGKAI', '2025-12-01', 200000, 25000,  12.5, 350000, 48000, 7.3,  10, 30.0),
        ('TRONGKAI', '2026-01-01', 215000, 30000,  14.0, 380000, 46000, 8.3,  11, 31.0),
        ('TRONGKAI', '2026-02-01', 235000, 34000,  14.5, 405000, 45000, 9.0,  11, 31.5),
        ('TRONGKAI', '2026-03-01', 255000, 39000,  15.3, 430000, 44000, 9.8,  12, 32.0),
        ('TRONGKAI', '2026-04-01', 275000, 44000,  16.0, 450000, 42000, 10.7, 12, 33.0),
        ('TRONGKAI', '2026-05-01', 295000, 49000,  16.6, 475000, 41000, 11.6, 13, 33.5)
    ON CONFLICT (empresa_codigo, period) DO NOTHING;

    -- ========================================================
    -- 4. IMPACT METRICS (IRIS+ v5.3) — datos demo
    -- ========================================================
    INSERT INTO core.impact_metrics (empresa_codigo, period, iris_metric_id, metric_name, metric_value, unit, framework, verified) VALUES
        -- GHG Emissions Avoided
        ('RHO',      '2025-12-31', 'PI2764', 'Greenhouse Gas Emissions Avoided', 2450.0, 'tCO2e', 'IRIS+_v5.3', TRUE),
        ('CSL',      '2025-12-31', 'PI2764', 'Greenhouse Gas Emissions Avoided', 1820.0, 'tCO2e', 'IRIS+_v5.3', TRUE),
        ('EVOQUE',   '2025-12-31', 'PI2764', 'Greenhouse Gas Emissions Avoided', 980.0,  'tCO2e', 'IRIS+_v5.3', FALSE),
        ('TRONGKAI', '2025-12-31', 'PI2764', 'Greenhouse Gas Emissions Avoided', 620.0,  'tCO2e', 'IRIS+_v5.3', FALSE),

        -- Renewable Energy Generated for Sale
        ('RHO',      '2025-12-31', 'PI5842', 'Renewable Energy Generated for Sale', 4280.0, 'MWh', 'IRIS+_v5.3', TRUE),
        ('CSL',      '2025-12-31', 'PI5842', 'Renewable Energy Generated for Sale', 3120.0, 'MWh', 'IRIS+_v5.3', TRUE),

        -- Waste Recycled/Reused
        ('EVOQUE',   '2025-12-31', 'OI2535', 'Waste Recycled/Reused', 1850.0, 'tonnes', 'IRIS+_v5.3', TRUE),
        ('TRONGKAI', '2025-12-31', 'OI2535', 'Waste Recycled/Reused', 1240.0, 'tonnes', 'IRIS+_v5.3', FALSE),
        ('REVTECH',  '2025-12-31', 'OI2535', 'Waste Recycled/Reused', 480.0,  'tonnes', 'IRIS+_v5.3', FALSE),

        -- Jobs Created
        ('CSL',      '2025-12-31', 'PI4060', 'Jobs Created', 34, 'count', 'IRIS+_v5.3', TRUE),
        ('RHO',      '2025-12-31', 'PI4060', 'Jobs Created', 18, 'count', 'IRIS+_v5.3', TRUE),
        ('DTE',      '2025-12-31', 'PI4060', 'Jobs Created', 15, 'count', 'IRIS+_v5.3', TRUE),
        ('REVTECH',  '2025-12-31', 'PI4060', 'Jobs Created', 11, 'count', 'IRIS+_v5.3', TRUE),
        ('EVOQUE',   '2025-12-31', 'PI4060', 'Jobs Created', 17, 'count', 'IRIS+_v5.3', TRUE),
        ('TRONGKAI', '2025-12-31', 'PI4060', 'Jobs Created', 13, 'count', 'IRIS+_v5.3', TRUE)
    ON CONFLICT (empresa_codigo, period, iris_metric_id) DO NOTHING;

    -- ========================================================
    -- 5. SDG ALIGNMENT (scores 0-5 por compañía y SDG)
    -- ========================================================
    INSERT INTO core.company_sdg_alignment (empresa_codigo, sdg_number, alignment_score, evidence) VALUES
        -- CSL — leasing cleantech
        ('CSL', 7, 5,  'SDG 7: Affordable Clean Energy — leasing exclusivo cleantech'),
        ('CSL', 9, 4,  'SDG 9: Industry Innovation — financiamiento PYMES innovacion'),
        ('CSL', 13, 5, 'SDG 13: Climate Action — equipos bajo carbon'),
        -- RHO — generacion renovable
        ('RHO', 7, 5,  'SDG 7: Affordable Clean Energy — generacion PMGD'),
        ('RHO', 13, 5, 'SDG 13: Climate Action — generacion 100% renovable'),
        ('RHO', 8, 3,  'SDG 8: Decent Work — empleos rurales'),
        -- DTE
        ('DTE', 7, 4,  'SDG 7'),
        ('DTE', 9, 5,  'SDG 9: consultoria tecnica especializada'),
        ('DTE', 13, 4, 'SDG 13'),
        -- REVTECH
        ('REVTECH', 9, 5,  'SDG 9: I+D mineria sostenible'),
        ('REVTECH', 12, 5, 'SDG 12: Responsible Production — revalorizacion escorias'),
        ('REVTECH', 13, 4, 'SDG 13'),
        -- EVOQUE
        ('EVOQUE', 12, 5, 'SDG 12: Responsible Production — economia circular industrial'),
        ('EVOQUE', 9, 4,  'SDG 9'),
        ('EVOQUE', 13, 4, 'SDG 13'),
        -- TRONGKAI
        ('TRONGKAI', 2, 4,  'SDG 2: Zero Hunger — agroalimentos valorizados'),
        ('TRONGKAI', 12, 5, 'SDG 12: Responsible Production'),
        ('TRONGKAI', 13, 4, 'SDG 13')
    ON CONFLICT (empresa_codigo, sdg_number) DO NOTHING;

    -- ========================================================
    -- 6. IMPACT DIMENSIONS (Impact Frontiers 5-dim)
    -- ========================================================
    INSERT INTO core.company_impact_dimensions (empresa_codigo, as_of_date, what_score, who_score, how_much_score, contribution_score, risk_score, narrative) VALUES
        ('CSL',      '2026-03-31', 4, 4, 4, 5, 2, 'Leasing equipos cleantech permite acceso PYMES a tecnologia limpia. Contribucion alta — sin nosotros muchas no podrian financiar.'),
        ('RHO',      '2026-03-31', 5, 3, 5, 4, 3, 'Generacion 100% renovable. Beneficio amplio. Riesgo medio: regulatoria + climatica.'),
        ('DTE',      '2026-03-31', 4, 3, 3, 4, 2, 'Consultoria habilita proyectos cleantech corporates.'),
        ('REVTECH',  '2026-03-31', 4, 4, 3, 5, 3, 'Revalorizacion escorias mineras reduce impacto ambiental directo.'),
        ('EVOQUE',   '2026-03-31', 5, 4, 4, 5, 2, 'Economia circular industrial. What y Contribution muy altos.'),
        ('TRONGKAI', '2026-03-31', 4, 4, 3, 4, 3, 'Valorizacion subproductos agro. Mercado en desarrollo, riesgo de adopcion.')
    ON CONFLICT (empresa_codigo, as_of_date) DO NOTHING;

    -- ========================================================
    -- 7. COMPLIANCE INSTITUCIONAL (OPIM 9 principios)
    -- ========================================================
    INSERT INTO core.compliance_checks_institutional (fund_id, framework, principle_or_item, status, last_review_date, next_review_date, notes) VALUES
        (v_fund_id, 'OPIM', 'P1: Strategic Intent', 'cumple', '2026-03-31', '2026-09-30', 'Articulado en LP Agreement + tesis ESG documentada'),
        (v_fund_id, 'OPIM', 'P2: Origination & Structuring', 'cumple', '2026-03-31', '2026-09-30', 'Screening ESG en pipeline de IC'),
        (v_fund_id, 'OPIM', 'P3: Portfolio Management', 'en_proceso', '2026-03-31', '2026-06-30', 'Monitoreo trimestral; falta automatizar via dashboard'),
        (v_fund_id, 'OPIM', 'P4: Impact at Exit', 'en_proceso', '2026-03-31', '2026-12-31', 'Estrategia de exit ESG por compañia en desarrollo'),
        (v_fund_id, 'OPIM', 'P5: Risk Management', 'cumple', '2026-03-31', '2026-09-30', 'Risk register actualizado'),
        (v_fund_id, 'OPIM', 'P6: Monitoring & Measurement', 'cumple', '2026-03-31', '2026-09-30', 'IRIS+ v5.3 implementado'),
        (v_fund_id, 'OPIM', 'P7: Decisions on Exit', 'no_aplica', '2026-03-31', '2027-06-30', 'Fondo en periodo de inversion'),
        (v_fund_id, 'OPIM', 'P8: Review & Improvement', 'cumple', '2026-03-31', '2026-09-30', 'Annual review proceso documentado'),
        (v_fund_id, 'OPIM', 'P9: Independent Disclosure', 'en_proceso', '2026-03-31', '2026-09-30', 'Verificacion externa Q3 2026 (BlueMark / Tideline)'),
        (v_fund_id, 'CMF_NCG532', 'Reglamento Interno (FONDOS01)', 'cumple', '2026-03-31', '2027-03-31', 'Archivado en CMF'),
        (v_fund_id, 'CMF_NCG532', 'Contrato General de Fondos (FONDOS02)', 'cumple', '2026-03-31', '2027-03-31', NULL),
        (v_fund_id, 'CMF_NCG554', 'Reporte trimestral SVS', 'cumple', '2026-03-31', '2026-06-30', 'Q1 2026 entregado a tiempo'),
        (v_fund_id, 'CORFO', 'Rendicion gastos elegibles', 'en_proceso', '2026-03-31', '2026-06-30', 'Rendicion semestral en preparacion');

    RAISE NOTICE 'Seed demo data R152 aplicada OK';
END $$;
