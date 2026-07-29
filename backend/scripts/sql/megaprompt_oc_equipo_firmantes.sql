-- MEGAPROMPT OC · Equipo de firmantes clickeable + firmantes externos
-- =====================================================================
-- Problema que resuelve:
--   Hoy hay DOS columnas JSONB de firmantes desincronizadas y ninguna
--   sirve para una UI de "click para agregar/quitar":
--     · empresas.firmantes_extra  → la lee el branding admin + `sugeridos`
--       de oc_firmas + el PDF v1. En RHO tiene 3 placeholders basura
--       ("Integrante RHO 1 (ajustar)") SIN email.
--     · empresas.oc_firmantes     → la lee el PDF v2 (el que se usa hoy).
--       En RHO tiene los 5 firmantes REALES pero sin email, y no existe
--       ningún endpoint para editarla.
--   Ninguna tiene ID estable ⇒ imposible hacer toggle por click.
--   Y `_sugeridos_de` (oc_firmas.py) descarta a los que no tienen email,
--   por eso hoy RHO no sugiere a NADIE.
--
-- Solución: `core.empresa_equipo` como catálogo con ID estable, email y
-- flag `es_default`. Las columnas JSONB se mantienen SINCRONIZADAS desde
-- esta tabla (trigger) para no romper PDF v1/v2 ni send_oc_to_signers.
--
-- Idempotente. Aplicar con: psql / script de migración.

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Precondición: empresas.codigo debe ser UNIQUE para poder referenciarlo
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'core' AND rel.relname = 'empresas'
          AND con.contype IN ('p', 'u')
          AND pg_get_constraintdef(con.oid) LIKE '%(codigo)%'
    ) THEN
        RAISE EXCEPTION 'core.empresas.codigo no tiene UNIQUE/PK — no se puede crear la FK';
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2) Catálogo de personas que pueden firmar, por empresa
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.empresa_equipo (
    miembro_id      BIGSERIAL PRIMARY KEY,
    empresa_codigo  TEXT NOT NULL
                    REFERENCES core.empresas(codigo) ON DELETE CASCADE,
    nombre          TEXT NOT NULL,
    cargo           TEXT,
    -- email es opcional para poder cargar a alguien que todavía no tiene
    -- cuenta; pero SIN email no puede firmar electrónicamente (el backend
    -- resuelve al firmante por email contra auth.users).
    email           TEXT,
    rut             TEXT,
    orden           INT NOT NULL DEFAULT 1,
    -- es_default: entra en el set que aplica el botón "firmantes habituales"
    es_default      BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    -- user_id se resuelve por email contra auth.users; informativo.
    user_id         UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un mismo email no puede estar dos veces en la misma empresa.
-- Índice funcional (no constraint) para poder usar lower() y filtrar NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresa_equipo_email
    ON core.empresa_equipo (empresa_codigo, lower(email))
    WHERE email IS NOT NULL;

-- Sin email igual evitamos duplicar a la misma persona por nombre.
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresa_equipo_nombre
    ON core.empresa_equipo (empresa_codigo, lower(nombre))
    WHERE email IS NULL;

CREATE INDEX IF NOT EXISTS ix_empresa_equipo_empresa
    ON core.empresa_equipo (empresa_codigo, orden)
    WHERE activo;

COMMENT ON TABLE core.empresa_equipo IS
    'Catálogo de personas firmantes por empresa. Fuente de verdad del '
    'picker de firmantes de OC; sincroniza empresas.oc_firmantes y '
    'empresas.firmantes_extra vía trigger para no romper los renderers.';

-- ---------------------------------------------------------------------
-- 3) Firmantes EXTERNOS en las firmas de una OC (proveedor / cliente)
-- ---------------------------------------------------------------------
-- El template panimávida tiene hoy la celda del proveedor HARDCODEADA con
-- el cargo fijo "Representante Legal". Las OCs reales alternan entre
-- "Representante Legal" y "Representante Comercial", y a veces firma un
-- tercero (cliente/mandante). Con es_externo el template puede renderizar
-- esas firmas desde datos en vez de tenerlas fijas.
ALTER TABLE core.oc_firmas
    ADD COLUMN IF NOT EXISTS es_externo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE core.oc_firmas
    ADD COLUMN IF NOT EXISTS empresa_firmante TEXT;

COMMENT ON COLUMN core.oc_firmas.es_externo IS
    'TRUE = firmante del proveedor/cliente (va primero en el PDF y NO '
    'recibe invitación a firmar en la plataforma salvo que tenga cuenta).';
COMMENT ON COLUMN core.oc_firmas.empresa_firmante IS
    'Razón social que se imprime bajo el cargo. NULL = la empresa emisora.';

-- ---------------------------------------------------------------------
-- 4) Sincronización automática empresa_equipo → columnas JSONB legacy
-- ---------------------------------------------------------------------
-- Mantiene vivos a los consumidores existentes sin tocarlos:
--   · empresas.oc_firmantes  [{nombre,cargo}]            → PDF v2
--   · empresas.firmantes_extra [{nombre,cargo,email,rut}] → PDF v1, sugeridos
CREATE OR REPLACE FUNCTION core.sync_empresa_firmantes_jsonb()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_codigo TEXT := COALESCE(NEW.empresa_codigo, OLD.empresa_codigo);
BEGIN
    UPDATE core.empresas e
    SET oc_firmantes = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nombre', m.nombre,
                                                'cargo',  m.cargo)
                             ORDER BY m.orden, m.miembro_id)
            FROM core.empresa_equipo m
            WHERE m.empresa_codigo = v_codigo AND m.activo AND m.es_default
        ), '[]'::jsonb),
        firmantes_extra = COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nombre', m.nombre,
                                                'cargo',  m.cargo,
                                                'email',  m.email,
                                                'rut',    m.rut)
                             ORDER BY m.orden, m.miembro_id)
            FROM core.empresa_equipo m
            WHERE m.empresa_codigo = v_codigo AND m.activo AND m.es_default
        ), '[]'::jsonb)
    WHERE e.codigo = v_codigo;
    RETURN NULL;  -- AFTER trigger
END $$;

DROP TRIGGER IF EXISTS trg_sync_empresa_firmantes ON core.empresa_equipo;
CREATE TRIGGER trg_sync_empresa_firmantes
    AFTER INSERT OR UPDATE OR DELETE ON core.empresa_equipo
    FOR EACH ROW EXECUTE FUNCTION core.sync_empresa_firmantes_jsonb();

-- ---------------------------------------------------------------------
-- 5) Seed RHO — los 5 firmantes reales de las OC de referencia
-- ---------------------------------------------------------------------
-- Fuente: OC0034/0035/0036/0037 (PDFs reales). Los emails se cruzan con
-- auth.users para que puedan firmar electrónicamente de verdad.
INSERT INTO core.empresa_equipo
    (empresa_codigo, nombre, cargo, email, orden, es_default, activo)
VALUES
    ('RHO', 'Javier Alvarez Abarca',  'Gerente General',
     'j.alvarez@rhoingenieria.cl',        1, TRUE, TRUE),
    ('RHO', 'Victoria Álvarez Abarca', 'Administración y Finanzas',
     'victoria.alvarez@rhoingenieria.cl', 2, TRUE, TRUE),
    ('RHO', 'Javiera Vargas Ríos',     'Líder Coordinación de Proyectos',
     'javiera.vargas@rhoingenieria.cl',   3, TRUE, TRUE),
    ('RHO', 'Francisco Chandía',       'Project Manager',
     'francisco.chandia@rhoingenieria.cl', 4, TRUE, TRUE),
    ('RHO', 'Guido Rietta González',   'Director General FIP',
     'grietta@cehtacapital.com',          5, TRUE, TRUE)
ON CONFLICT DO NOTHING;

-- Resolver user_id por email (informativo; el flujo de firma re-resuelve).
UPDATE core.empresa_equipo m
SET user_id = u.id
FROM auth.users u
WHERE lower(u.email) = lower(m.email) AND m.user_id IS NULL;

-- El GG de la empresa se usa como fallback en varios renderers: dejarlo
-- coherente con el equipo (RHO lo tenía en NULL, por eso no sugería nada).
UPDATE core.empresas e
SET gerente_general_nombre = m.nombre,
    gerente_general_cargo  = COALESCE(m.cargo, 'Gerente General'),
    gerente_general_email  = m.email
FROM core.empresa_equipo m
WHERE m.empresa_codigo = e.codigo
  AND m.activo
  AND lower(COALESCE(m.cargo, '')) = 'gerente general'
  AND e.gerente_general_email IS DISTINCT FROM m.email;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación (correr aparte)
-- ---------------------------------------------------------------------
-- SELECT empresa_codigo, nombre, cargo, email, orden, es_default
--   FROM core.empresa_equipo ORDER BY empresa_codigo, orden;
-- SELECT codigo, gerente_general_email,
--        jsonb_array_length(oc_firmantes)    AS n_pdf,
--        jsonb_array_length(firmantes_extra) AS n_extra
--   FROM core.empresas WHERE codigo = 'RHO';
