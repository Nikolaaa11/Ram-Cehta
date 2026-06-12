-- R152MMMMMM — Formato OC "Panimávida" por empresa (réplica del PDF
-- canónico OC0013-PAN001-FUMIAGRO). Idempotente.

-- 1. Template de PDF por empresa: 'default' (institucional v2) o
--    'panimavida' (carta formal MANDANTE/PROVEEDOR + página de firmas).
ALTER TABLE core.empresas
    ADD COLUMN IF NOT EXISTS oc_template TEXT;

-- 2. Firmantes de la página de firmas: JSONB [{nombre, cargo}, ...].
--    El proveedor se agrega dinámico (contacto de la OC).
ALTER TABLE core.empresas
    ADD COLUMN IF NOT EXISTS oc_firmantes JSONB;

-- 3. Unidad por ítem del detalle (Mes / Aplic. / Un. / kg / etc.) —
--    columna "Un." del formato. NULL = se muestra "—".
ALTER TABLE core.ordenes_compra_detalle
    ADD COLUMN IF NOT EXISTS unidad TEXT;

COMMENT ON COLUMN core.empresas.oc_template IS
    'Template PDF de OC: NULL/default = institucional v2; panimavida = '
    'carta formal con MANDANTE/PROVEEDOR + firmas (R152MMMMMM).';
COMMENT ON COLUMN core.empresas.oc_firmantes IS
    'Firmantes página de firmas OC: [{"nombre","cargo"}]. R152MMMMMM.';

-- 4. Seed RHO: activa el formato + firmantes del PDF modelo.
UPDATE core.empresas
SET oc_template = 'panimavida',
    oc_firmantes = '[
        {"nombre": "Javier Alvarez Abarca",   "cargo": "Gerente General"},
        {"nombre": "Victoria Álvarez Abarca", "cargo": "Administración y Finanzas"},
        {"nombre": "Javiera Vargas Ríos",     "cargo": "Líder Coordinación de Proyectos"},
        {"nombre": "Francisco Chandía",       "cargo": "Project Manager"},
        {"nombre": "Guido Rietta González",   "cargo": "Director General FIP"}
    ]'::jsonb
WHERE codigo = 'RHO';

-- Verificación
SELECT codigo, oc_template, jsonb_array_length(oc_firmantes) AS n_firmantes
FROM core.empresas WHERE codigo = 'RHO';
