-- =====================================================================
-- Migración 0002 — Tabla core.user_roles + Hook JWT personalizado
-- Ejecutar DESPUÉS de rls.sql
-- =====================================================================
--
-- Esta migración:
--   1. Crea core.user_roles que mapea auth.users.id → app_role
--   2. Instala public.custom_access_token_hook para inyectar app_role en el JWT
--      Se activa en: Supabase Dashboard > Auth > Hooks > Custom Access Token
-- =====================================================================

CREATE TABLE IF NOT EXISTS core.user_roles (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    app_role    TEXT NOT NULL DEFAULT 'viewer'
                CHECK (app_role IN ('admin', 'finance', 'viewer')),
    assigned_by TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER trg_touch_user_roles
    BEFORE UPDATE ON core.user_roles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS: admins gestionan todos los roles; cada usuario lee el propio.
ALTER TABLE core.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "self_read_role" ON core.user_roles;
CREATE POLICY "self_read_role" ON core.user_roles
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_manage_roles" ON core.user_roles;
CREATE POLICY "admin_manage_roles" ON core.user_roles
    FOR ALL TO authenticated
    USING (public.app_role() = 'admin')
    WITH CHECK (public.app_role() = 'admin');

-- =====================================================================
-- Hook JWT: inyecta app_role en los claims del access token.
-- Supabase llama a esta función antes de firmar cada JWT.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
    claims    jsonb;
    user_role text;
BEGIN
    SELECT app_role INTO user_role
    FROM core.user_roles
    WHERE user_id = (event->>'user_id')::uuid;

    claims := event->'claims';
    claims := jsonb_set(claims, '{app_role}', to_jsonb(COALESCE(user_role, 'viewer')));

    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Permisos para que supabase_auth_admin ejecute el hook.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT USAGE ON SCHEMA core TO supabase_auth_admin;
GRANT SELECT ON core.user_roles TO supabase_auth_admin;

-- =====================================================================
-- Seed: primer administrador (solo si ya creó su cuenta en Supabase Auth).
-- Cambiar el email por el real si es diferente.
-- =====================================================================
DO $$
DECLARE
    admin_uid UUID;
BEGIN
    SELECT id INTO admin_uid
    FROM auth.users
    WHERE email = 'nikola@cehta.cl'
    LIMIT 1;

    IF admin_uid IS NOT NULL THEN
        INSERT INTO core.user_roles (user_id, app_role, assigned_by)
        VALUES (admin_uid, 'admin', 'seed')
        ON CONFLICT (user_id) DO UPDATE
            SET app_role = 'admin', updated_at = now();
    END IF;
END$$;
