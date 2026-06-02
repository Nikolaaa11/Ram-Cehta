-- R152vvv · Módulo RRHH — Libros de Remuneraciones
--
-- Propósito: permitir a Benjamín Toro (Adm. y Finanzas) y Victoria
-- calcular automáticamente el gasto real de la empresa por cada
-- empleado, mes a mes. Distinto del líquido pagado: el costo real
-- incluye aportes patronales (AFP empleador, SIS, Seg. Cesantía 2.4%,
-- Seg. Social, Mutual ATEP).
--
-- Idempotente: usa IF NOT EXISTS, ON CONFLICT.
-- Aplicar en: Supabase Studio → SQL Editor.

-- =====================================================================
-- 1. EMPLEADOS — catálogo activo de personal por empresa
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.empleados (
    rut TEXT PRIMARY KEY,                       -- RUT con DV (ej: "21089265-6")
    nombre TEXT NOT NULL,
    empresa_codigo TEXT NOT NULL REFERENCES core.empresas(codigo),
    area TEXT,                                  -- "Gerencia", "Administración y Finanzas", etc.
    cargo TEXT,                                 -- cargo formal opcional
    fecha_ingreso DATE,
    fecha_salida DATE,                          -- NULL = activo
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    afp TEXT,                                   -- "Modelo", "Capital", "Habitat", etc.
    salud TEXT,                                 -- "Fonasa" o nombre Isapre
    sueldo_base_actual NUMERIC(14,2),           -- snapshot vigente, se actualiza con cada libro
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empleados_empresa
    ON core.empleados (empresa_codigo, activo);

CREATE INDEX IF NOT EXISTS idx_empleados_area
    ON core.empleados (empresa_codigo, area)
    WHERE activo = TRUE;

-- =====================================================================
-- 2. LIBROS DE REMUNERACIONES — un registro por empresa-mes
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.libros_remuneraciones (
    id BIGSERIAL PRIMARY KEY,
    empresa_codigo TEXT NOT NULL REFERENCES core.empresas(codigo),
    periodo TEXT NOT NULL,                      -- 'YYYY-MM' (ej: '2026-04')
    -- Totales agregados (suma de líneas para reportes rápidos sin JOIN)
    total_haberes NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_liquido NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_descuentos_legales NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_aportes_patronales NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_costo_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,  -- haberes + aportes patronales
    -- Metadata del archivo origen
    archivo_origen TEXT,                        -- nombre o path Dropbox del Excel
    archivo_hash TEXT,                          -- sha256 para dedup
    uploaded_by UUID,                           -- core.users.id
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cantidad_empleados INTEGER NOT NULL DEFAULT 0,
    notas TEXT,
    UNIQUE (empresa_codigo, periodo)
);

CREATE INDEX IF NOT EXISTS idx_libros_rem_empresa_periodo
    ON core.libros_remuneraciones (empresa_codigo, periodo DESC);

-- =====================================================================
-- 3. LIBRO LÍNEAS — una fila por empleado-mes con TODO el detalle
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.libro_remuneraciones_lineas (
    id BIGSERIAL PRIMARY KEY,
    libro_id BIGINT NOT NULL REFERENCES core.libros_remuneraciones(id) ON DELETE CASCADE,
    empleado_rut TEXT NOT NULL,                 -- FK suelta a core.empleados.rut (puede crearse on-the-fly)
    -- Nombre / área en el libro (snapshot del mes — el catálogo puede cambiar)
    nombre TEXT NOT NULL,
    area TEXT,
    dias_trabajados NUMERIC(5,2) NOT NULL DEFAULT 30,

    -- HABERES IMPONIBLES (columnas E,F,G,H,I del Excel)
    sueldo_base NUMERIC(14,2) NOT NULL DEFAULT 0,
    horas_extras NUMERIC(14,2) NOT NULL DEFAULT 0,
    gratificacion_legal NUMERIC(14,2) NOT NULL DEFAULT 0,
    otros_imponibles NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_imponibles NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- HABERES NO IMPONIBLES (J,K,L)
    asignacion_familiar NUMERIC(14,2) NOT NULL DEFAULT 0,
    otros_no_imponibles NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_no_imponibles NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- M
    total_haberes NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- DESCUENTOS LEGALES TRABAJADOR (N,O,P,Q,R)
    prevision NUMERIC(14,2) NOT NULL DEFAULT 0, -- AFP del trabajador
    salud NUMERIC(14,2) NOT NULL DEFAULT 0,     -- Isapre / Fonasa
    seguro_cesantia_trab NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 0.6% trabajador
    otros_descuentos_legales NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_descuentos_legales NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- DESCUENTOS VARIOS (S,T)
    descuentos_varios NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_descuentos NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- U
    liquido_pagado NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- APORTES PATRONALES (segunda tabla del Excel, columnas E,F,G,H,I)
    aporte_afp_empleador NUMERIC(14,2) NOT NULL DEFAULT 0,
    sis NUMERIC(14,2) NOT NULL DEFAULT 0,                    -- ~1.85% empleador
    seguro_cesantia_empleador NUMERIC(14,2) NOT NULL DEFAULT 0,  -- 2.4%
    seguro_social NUMERIC(14,2) NOT NULL DEFAULT 0,          -- Mutual base
    mutual NUMERIC(14,2) NOT NULL DEFAULT 0,                 -- ATEP 0.95% + adicional
    total_aportes_patronales NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- CÁLCULO IMPUESTO ÚNICO (segunda tabla, K,L)
    base_tributable NUMERIC(14,2) NOT NULL DEFAULT 0,
    impuesto_unico NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- COSTO TOTAL EMPRESA = total_haberes + total_aportes_patronales
    -- (el AFP empleador es 1.5% por SIS social Ley Bustos en algunos casos —
    -- por simplicidad el parser suma los 5 aportes y ese es el costo total)
    costo_total_empresa NUMERIC(14,2) NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (libro_id, empleado_rut)
);

CREATE INDEX IF NOT EXISTS idx_lrl_empleado_libro
    ON core.libro_remuneraciones_lineas (empleado_rut, libro_id);

-- =====================================================================
-- 4. VISTA materializada de costo por empleado-periodo
-- =====================================================================

CREATE OR REPLACE VIEW core.v_costo_empleado_mensual AS
SELECT
    l.empleado_rut AS rut,
    l.nombre,
    lr.empresa_codigo,
    lr.periodo,
    l.area,
    l.dias_trabajados,
    l.total_haberes,
    l.liquido_pagado,
    l.total_aportes_patronales,
    l.costo_total_empresa,
    -- Ratio costo / líquido: cuánto "extra" paga la empresa sobre lo que
    -- recibe el empleado en su cuenta
    CASE
        WHEN l.liquido_pagado > 0
        THEN ROUND((l.costo_total_empresa / l.liquido_pagado), 3)
        ELSE NULL
    END AS multiplicador_costo
FROM core.libro_remuneraciones_lineas l
JOIN core.libros_remuneraciones lr ON lr.id = l.libro_id;

COMMENT ON VIEW core.v_costo_empleado_mensual IS
    'R152vvv: vista plana costo/empleado/mes. Multiplicador = cuántas '
    'veces sale más caro contratar respecto al líquido pagado al empleado.';

-- =====================================================================
-- 5. PERMISO RRHH — solo Benja, Victoria y admins
-- =====================================================================

-- Tabla de allowlist explícita. El sidebar consulta este endpoint para
-- decidir si mostrar /rrhh. Más simple que sumarlo al schema de roles.
CREATE TABLE IF NOT EXISTS core.rrhh_allowlist (
    email TEXT PRIMARY KEY,
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notas TEXT
);

INSERT INTO core.rrhh_allowlist (email, notas) VALUES
    ('benjamin.toro@cehtacapital.com', 'Adm. y Finanzas — owner RRHH'),
    ('benjamin@cehtacapital.com', 'Alias alternativo Benja'),
    ('victoria@cehtacapital.com', 'RRHH — co-owner módulo'),
    ('victoria.cehta@cehtacapital.com', 'Alias alternativo Victoria')
ON CONFLICT (email) DO NOTHING;

-- =====================================================================
-- 6. SEED — empleados del libro Abril 2026 de AFIS (cargados como activos)
-- =====================================================================

INSERT INTO core.empleados (rut, nombre, empresa_codigo, area, sueldo_base_actual, activo)
VALUES
    ('7736580-K',   'Echevarría Riquelme Jaime Rafael',  'AFIS', 'Gerencia',                  4786646, TRUE),
    ('15354775-0',  'Cuevas Valenzuela José Oscar',      'AFIS', 'Gerencia',                  4786646, TRUE),
    ('16727226-6',  'Gotschlich Stoffel Claudia Andrea', 'AFIS', 'Gerencia',                  1986646, TRUE),
    ('21089265-6',  'Toro Salazar Benjamín Antonio',     'AFIS', 'Administración y Finanzas', 1086646, TRUE)
ON CONFLICT (rut) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    empresa_codigo = EXCLUDED.empresa_codigo,
    area = EXCLUDED.area,
    sueldo_base_actual = EXCLUDED.sueldo_base_actual,
    updated_at = NOW();

-- =====================================================================
-- 7. Notas
-- =====================================================================

COMMENT ON TABLE core.empleados IS
    'R152vvv: catálogo de empleados por empresa. Se popula vía seed inicial '
    'o vía upload de libro de remuneraciones (auto-upsert por RUT).';

COMMENT ON TABLE core.libros_remuneraciones IS
    'R152vvv: libro mensual por empresa. UNIQUE(empresa, periodo): no se '
    'pueden cargar dos libros del mismo mes para la misma empresa — se '
    'reemplaza el existente vía endpoint de re-upload.';

COMMENT ON COLUMN core.libro_remuneraciones_lineas.costo_total_empresa IS
    'R152vvv: total_haberes + total_aportes_patronales. Es lo que la '
    'empresa REALMENTE gasta por el empleado en el mes — incluye lo que '
    'el empleado recibe + lo que se paga a AFP empleador + SIS + Seg. '
    'Cesantía patronal + Mutual + Seg. Social. NO incluye finiquito ni '
    'indemnización por años de servicio (provisión separada).';
