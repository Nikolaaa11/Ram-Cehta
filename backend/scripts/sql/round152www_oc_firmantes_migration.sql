-- R152www · Firmantes de OC por empresa + branding completo.
--
-- MEJORAS IA.docx #4: "cada empresa tenga su logo y su estilo de OC,
-- Estás deberan ser firmadas por los gg de cada empresa (en el caso de
-- rho todos los integrantes firman)".
--
-- Idempotente. Aplicar en Supabase Studio.

-- =====================================================================
-- 1. Columnas nuevas en core.empresas
-- =====================================================================

ALTER TABLE core.empresas
    ADD COLUMN IF NOT EXISTS gerente_general_nombre TEXT,
    ADD COLUMN IF NOT EXISTS gerente_general_cargo  TEXT
        DEFAULT 'Gerente General',
    ADD COLUMN IF NOT EXISTS gerente_general_email  TEXT,
    -- JSONB array de firmantes adicionales. Para empresas con UN solo
    -- firmante (la mayoría), queda NULL o []. Para RHO se popula con TODOS
    -- los integrantes que deben firmar. Estructura:
    --   [{"nombre": "...", "cargo": "...", "email": "...", "rut": "..."}, ...]
    ADD COLUMN IF NOT EXISTS firmantes_extra JSONB DEFAULT '[]'::jsonb,
    -- Marca explícita para "ESTA empresa requiere firma colectiva" (RHO).
    -- Cuando es TRUE, el PDF muestra TODAS las firmas de firmantes_extra
    -- en vez de solo la del GG.
    ADD COLUMN IF NOT EXISTS oc_firma_colectiva BOOLEAN NOT NULL DEFAULT FALSE,
    -- Para el bloque info OC en el PDF: a quién va dirigida la OC.
    -- Default es el GG.
    ADD COLUMN IF NOT EXISTS oc_color_primario TEXT DEFAULT '#236C4F';

COMMENT ON COLUMN core.empresas.gerente_general_nombre IS
    'R152www: nombre completo del GG que firma OCs. NULL → PDF muestra '
    'placeholder "________________".';
COMMENT ON COLUMN core.empresas.firmantes_extra IS
    'R152www: JSONB array de firmantes adicionales. RHO usa esto + '
    'oc_firma_colectiva=TRUE para mostrar TODAS las firmas en el PDF.';
COMMENT ON COLUMN core.empresas.oc_firma_colectiva IS
    'R152www: si TRUE, PDF muestra firmantes_extra en bloques apilados '
    'al final del cover. Caso de uso: RHO (todos los integrantes firman).';

-- =====================================================================
-- 2. Seed firmantes confirmados
--    NOTA: nombres son placeholders del primer seed — Nicolás debe
--    ajustarlos en /admin/empresas o vía UPDATE manual con los reales.
-- =====================================================================

-- AFIS (AGROTECNOLOGÍAS E INGENIERÍA SPA) — GG según libro remuneraciones
UPDATE core.empresas SET
    gerente_general_nombre = COALESCE(gerente_general_nombre, 'José Oscar Cuevas Valenzuela'),
    gerente_general_cargo  = COALESCE(gerente_general_cargo, 'Gerente General'),
    oc_color_primario      = COALESCE(oc_color_primario, '#236C4F')
WHERE codigo = 'AFIS';

UPDATE core.empresas SET
    gerente_general_cargo  = COALESCE(gerente_general_cargo, 'Gerente General'),
    oc_color_primario      = COALESCE(oc_color_primario, '#236C4F')
WHERE codigo IN ('FIP_CEHTA','CENERGY','EVOQUE','CSL','TRONGKAI','REVTECH','DTE');

-- RHO — firma colectiva. Placeholder con 3 firmantes (Nicolás debe ajustar)
UPDATE core.empresas SET
    oc_firma_colectiva = TRUE,
    firmantes_extra = COALESCE(
        NULLIF(firmantes_extra, '[]'::jsonb),
        '[
          {"nombre": "Integrante RHO 1 (ajustar)", "cargo": "Socio fundador", "email": null, "rut": null},
          {"nombre": "Integrante RHO 2 (ajustar)", "cargo": "Socio fundador", "email": null, "rut": null},
          {"nombre": "Integrante RHO 3 (ajustar)", "cargo": "Socio fundador", "email": null, "rut": null}
        ]'::jsonb
    ),
    gerente_general_cargo = COALESCE(gerente_general_cargo, 'Representante'),
    oc_color_primario = COALESCE(oc_color_primario, '#236C4F')
WHERE codigo = 'RHO';

-- =====================================================================
-- 3. (Opcional) Path Dropbox del logo si NULL — apunta a la convención
--    estándar para que el fetch funcione apenas Nicolás suba el PNG.
-- =====================================================================

UPDATE core.empresas SET
    logo_dropbox_path = '/Cehta Capital/01-Empresas/' || codigo || '/00-Branding/logo.png'
WHERE logo_dropbox_path IS NULL
  AND activo = TRUE;

-- =====================================================================
-- 4. Vista helper para consultas rápidas desde la app
-- =====================================================================

CREATE OR REPLACE VIEW core.v_empresas_oc_branding AS
SELECT
    codigo,
    razon_social,
    rut,
    logo_dropbox_path,
    oc_color_primario,
    gerente_general_nombre,
    gerente_general_cargo,
    gerente_general_email,
    oc_firma_colectiva,
    firmantes_extra,
    -- Cantidad de firmantes totales (1 GG o N integrantes)
    CASE
        WHEN oc_firma_colectiva
        THEN COALESCE(jsonb_array_length(firmantes_extra), 0)
        ELSE 1
    END AS cantidad_firmantes
FROM core.empresas
WHERE activo = TRUE;

COMMENT ON VIEW core.v_empresas_oc_branding IS
    'R152www: branding consolidado de empresa para generar PDFs de OC. '
    'cantidad_firmantes ayuda al renderer a calcular alto del bloque firma.';
