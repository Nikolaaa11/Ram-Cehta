-- =====================================================================
-- Round 115 — Migración para empresa extra data + credenciales cifradas
-- =====================================================================
-- INSTRUCCIONES PARA NICOLAS:
--   1. Abrí https://supabase.com/dashboard/project/dqwwqfhzejscgcynkbip
--   2. SQL Editor (icono de DB) → New query
--   3. Pegá todo este archivo y dale RUN
--   4. Si todo OK vas a ver "Success. No rows returned"
--
-- IDEMPOTENTE: podés correrlo varias veces sin que pase nada raro.
-- =====================================================================

-- 1. Extender core.empresas con datos del SII
ALTER TABLE core.empresas
    ADD COLUMN IF NOT EXISTS pagina_web TEXT,
    ADD COLUMN IF NOT EXISTS contabilidad_proveedor TEXT,
    ADD COLUMN IF NOT EXISTS direccion_sii TEXT;

-- 2. Tabla de credenciales cifradas (SII + Previred)
CREATE TABLE IF NOT EXISTS core.empresa_credenciales (
    credencial_id           BIGSERIAL PRIMARY KEY,
    empresa_codigo          TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    sistema                 TEXT NOT NULL,
    rut_usuario             TEXT NOT NULL,
    password_encrypted      TEXT NOT NULL,
    notas                   TEXT,
    ultima_validacion_at    TIMESTAMPTZ,
    ultima_validacion_ok    BOOLEAN,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sistema CHECK (sistema IN ('sii', 'previred')),
    CONSTRAINT uq_empresa_sistema UNIQUE (empresa_codigo, sistema)
);
CREATE INDEX IF NOT EXISTS idx_empresa_cred_sistema
    ON core.empresa_credenciales(sistema);

-- 3. Directorio formal del fondo (NO es el mismo que user_company_roles que es operativo)
CREATE TABLE IF NOT EXISTS core.directorio_miembros (
    miembro_id      BIGSERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    rut             TEXT,
    direccion       TEXT,
    telefono        TEXT,
    banco           TEXT,
    cuenta          TEXT,
    codigo_banco    TEXT,
    correo          TEXT,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_directorio_activo
    ON core.directorio_miembros(activo) WHERE activo = TRUE;

-- 4. Inversionistas / Aportantes del FIP CEHTA ESG
CREATE TABLE IF NOT EXISTS core.inversionistas_aportantes (
    inversionista_id BIGSERIAL PRIMARY KEY,
    nombre          TEXT NOT NULL,
    rut             TEXT,
    direccion       TEXT,
    telefono        TEXT,
    banco           TEXT,
    cuenta          TEXT,
    codigo_banco    TEXT,
    correo          TEXT,
    tipo            TEXT NOT NULL DEFAULT 'aportante',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_tipo_inversionista CHECK (tipo IN ('aportante', 'inversionista'))
);
CREATE INDEX IF NOT EXISTS idx_inversionistas_activo
    ON core.inversionistas_aportantes(activo) WHERE activo = TRUE;

-- Verificación rápida — esto te dice que todo se creó OK.
SELECT
    'core.empresa_credenciales' AS tabla,
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'empresa_credenciales') AS existe
UNION ALL
SELECT 'core.directorio_miembros',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'directorio_miembros')
UNION ALL
SELECT 'core.inversionistas_aportantes',
    EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'core' AND table_name = 'inversionistas_aportantes')
UNION ALL
SELECT 'core.empresas.pagina_web',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'core' AND table_name = 'empresas' AND column_name = 'pagina_web');
