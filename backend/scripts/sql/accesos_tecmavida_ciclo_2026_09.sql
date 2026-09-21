-- ============================================================================
-- Accesos TECMAVIDA y CICLO para el equipo global (2026-09-21)
-- ============================================================================
-- Nicolás: "añade al perfil de guido, benja, vicky, cescobar y camila
-- tecmavida. Y a guido, vicky, benja, cescobar a ciclocapital".
--
-- Cada persona recibe en TECMAVIDA y CICLO el MISMO rol que ya tiene en las
-- otras 11 empresas (se copió su patrón, no se inventó):
--   · Guido Rietta   grietta@cehtacapital.com        → DIRECTOR
--       (en las empresas operativas es DIRECTOR; GG sólo en holding/fondo).
--       Además resuelve un pendiente: TECMAVIDA y CICLO no tenían DIRECTOR,
--       así que ninguna OC ni voucher podía juntar las dos firmas.
--   · Benjamín Toro  btoro@cenergy.cl                → GG + OPERADOR
--   · Victoria Álvarez victoria.alvarez@rhoingenieria.cl → GG
--   · Caterin Escobar cescobar@cenergy.cl            → GG
--   · Camila Urrutia currutila@evoquenergy.com       → ya tenía TECMAVIDA
--       como CONTADOR desde 2026-09-02; se verifica, no se duplica.
--
-- Idempotente (ON CONFLICT reactiva). Reporta OK/FAIL.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_faltan TEXT;
BEGIN
    SELECT string_agg(e, ', ') INTO v_faltan
      FROM unnest(ARRAY['grietta@cehtacapital.com','btoro@cenergy.cl',
                        'victoria.alvarez@rhoingenieria.cl','cescobar@cenergy.cl',
                        'currutila@evoquenergy.com']) AS e
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = e);
    IF v_faltan IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL · no existen en auth.users: %', v_faltan;
    END IF;
    IF (SELECT count(*) FROM core.empresas WHERE codigo IN ('TECMAVIDA','CICLO')) <> 2 THEN
        RAISE EXCEPTION 'FAIL · falta la empresa TECMAVIDA o CICLO';
    END IF;
END $$;

-- Esquema real (verificado en la BD): user_id, empresa_codigo, role, active,
-- assigned_at, assigned_by (uuid), notas. PK (user_id, empresa_codigo, role).
INSERT INTO core.user_company_roles (user_id, empresa_codigo, role, active, assigned_at, notas)
SELECT u.id, x.empresa, x.rol, TRUE, now(), 'Pedido de Nicolás 2026-09-21 (accesos TECMAVIDA/CICLO)'
  FROM (VALUES
        ('grietta@cehtacapital.com',          'TECMAVIDA', 'DIRECTOR'),
        ('grietta@cehtacapital.com',          'CICLO',     'DIRECTOR'),
        ('btoro@cenergy.cl',                  'TECMAVIDA', 'GG'),
        ('btoro@cenergy.cl',                  'TECMAVIDA', 'OPERADOR'),
        ('btoro@cenergy.cl',                  'CICLO',     'GG'),
        ('btoro@cenergy.cl',                  'CICLO',     'OPERADOR'),
        ('victoria.alvarez@rhoingenieria.cl', 'TECMAVIDA', 'GG'),
        ('victoria.alvarez@rhoingenieria.cl', 'CICLO',     'GG'),
        ('cescobar@cenergy.cl',               'TECMAVIDA', 'GG'),
        ('cescobar@cenergy.cl',               'CICLO',     'GG'),
        ('currutila@evoquenergy.com',         'TECMAVIDA', 'CONTADOR')
       ) AS x(email, empresa, rol)
  JOIN auth.users u ON lower(u.email) = x.email
ON CONFLICT (user_id, empresa_codigo, role)
DO UPDATE SET active = TRUE;

-- Verificación: cada persona ve las dos empresas y ambas tienen GG + DIRECTOR
DO $$
DECLARE
    v_n INT;
    r RECORD;
BEGIN
    FOR r IN
        SELECT x.email, x.empresa
          FROM (VALUES ('grietta@cehtacapital.com','TECMAVIDA'), ('grietta@cehtacapital.com','CICLO'),
                       ('btoro@cenergy.cl','TECMAVIDA'), ('btoro@cenergy.cl','CICLO'),
                       ('victoria.alvarez@rhoingenieria.cl','TECMAVIDA'), ('victoria.alvarez@rhoingenieria.cl','CICLO'),
                       ('cescobar@cenergy.cl','TECMAVIDA'), ('cescobar@cenergy.cl','CICLO'),
                       ('currutila@evoquenergy.com','TECMAVIDA')) AS x(email, empresa)
    LOOP
        SELECT count(*) INTO v_n
          FROM core.user_company_roles ucr JOIN auth.users u ON u.id = ucr.user_id
         WHERE lower(u.email) = r.email AND ucr.empresa_codigo = r.empresa AND ucr.active;
        IF v_n = 0 THEN
            RAISE EXCEPTION 'FAIL · % no quedó con acceso a %', r.email, r.empresa;
        END IF;
    END LOOP;

    FOR r IN SELECT unnest(ARRAY['TECMAVIDA','CICLO']) AS empresa LOOP
        SELECT count(DISTINCT ucr.user_id) INTO v_n
          FROM core.user_company_roles ucr
         WHERE ucr.empresa_codigo = r.empresa AND ucr.active AND ucr.role = 'DIRECTOR';
        IF v_n = 0 THEN
            RAISE EXCEPTION 'FAIL · % sigue sin DIRECTOR', r.empresa;
        END IF;
        RAISE NOTICE 'OK · % tiene % DIRECTOR(es)', r.empresa, v_n;
    END LOOP;
    RAISE NOTICE 'OK · 9 accesos verificados (Guido, Benja, Vicky, Caterin en ambas; Camila en TECMAVIDA)';
END $$;

COMMIT;
