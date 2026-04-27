-- =====================================================================
-- Row Level Security — Cehta Capital (Supabase)
-- Ejecutar DESPUÉS de schema.sql y views.sql
-- =====================================================================
--
-- Modelo de roles:
--   - authenticated (rol nativo de Supabase para usuarios logueados)
--   - claim 'app_role' en JWT: 'admin' | 'finance' | 'viewer'
--
-- La claim 'app_role' se setea con una hook de Supabase Auth (Fase 2.2).
-- Mientras tanto, todos los usuarios autenticados son tratados como 'viewer'.
-- =====================================================================

-- Helper: leer el app_role desde el JWT del request.
-- Vive en 'public' porque 'auth' es gestionado por Supabase y no permite CREATE.
CREATE OR REPLACE FUNCTION public.app_role() RETURNS TEXT AS $$
    SELECT COALESCE(
        (current_setting('request.jwt.claims', true)::jsonb ->> 'app_role'),
        'viewer'
    );
$$ LANGUAGE SQL STABLE;

GRANT EXECUTE ON FUNCTION public.app_role() TO authenticated;

-- =====================================================================
-- ACTIVAR RLS en todas las tablas de core
-- =====================================================================
ALTER TABLE core.empresas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.proveedores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.movimientos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ordenes_compra        ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ordenes_compra_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.f29_obligaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.suscripciones_acciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.concepto_general      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.concepto_detallado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tipo_egreso           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.fuente                ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.proyecto              ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.banco                 ENABLE ROW LEVEL SECURITY;

-- Audit: nadie lee desde el frontend; solo service_role (backend).
ALTER TABLE audit.etl_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.rejected_rows ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- POLÍTICAS: lectura
-- Todos los autenticados leen catálogos y datos operativos.
-- =====================================================================
DROP POLICY IF EXISTS "authenticated_read" ON core.empresas;
CREATE POLICY "authenticated_read" ON core.empresas
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.proveedores;
CREATE POLICY "authenticated_read" ON core.proveedores
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.movimientos;
CREATE POLICY "authenticated_read" ON core.movimientos
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.ordenes_compra;
CREATE POLICY "authenticated_read" ON core.ordenes_compra
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.ordenes_compra_detalle;
CREATE POLICY "authenticated_read" ON core.ordenes_compra_detalle
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.f29_obligaciones;
CREATE POLICY "authenticated_read" ON core.f29_obligaciones
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read" ON core.suscripciones_acciones;
CREATE POLICY "authenticated_read" ON core.suscripciones_acciones
    FOR SELECT TO authenticated USING (true);

-- Catálogos: lectura abierta a autenticados.
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'core.concepto_general','core.concepto_detallado','core.tipo_egreso',
        'core.fuente','core.proyecto','core.banco'
    ])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "authenticated_read" ON %s', t);
        EXECUTE format(
            'CREATE POLICY "authenticated_read" ON %s FOR SELECT TO authenticated USING (true)',
            t
        );
    END LOOP;
END$$;

-- =====================================================================
-- POLÍTICAS: escritura
-- Solo admin y finance escriben. viewer es read-only.
-- El backend (service_role) bypassa RLS por diseño.
-- =====================================================================
DROP POLICY IF EXISTS "write_admin_finance" ON core.proveedores;
CREATE POLICY "write_admin_finance" ON core.proveedores
    FOR ALL TO authenticated
    USING (public.app_role() IN ('admin','finance'))
    WITH CHECK (public.app_role() IN ('admin','finance'));

DROP POLICY IF EXISTS "write_admin_finance" ON core.ordenes_compra;
CREATE POLICY "write_admin_finance" ON core.ordenes_compra
    FOR ALL TO authenticated
    USING (public.app_role() IN ('admin','finance'))
    WITH CHECK (public.app_role() IN ('admin','finance'));

DROP POLICY IF EXISTS "write_admin_finance" ON core.ordenes_compra_detalle;
CREATE POLICY "write_admin_finance" ON core.ordenes_compra_detalle
    FOR ALL TO authenticated
    USING (public.app_role() IN ('admin','finance'))
    WITH CHECK (public.app_role() IN ('admin','finance'));

DROP POLICY IF EXISTS "write_admin_finance" ON core.f29_obligaciones;
CREATE POLICY "write_admin_finance" ON core.f29_obligaciones
    FOR ALL TO authenticated
    USING (public.app_role() IN ('admin','finance'))
    WITH CHECK (public.app_role() IN ('admin','finance'));

-- Empresas: solo admin las modifica.
DROP POLICY IF EXISTS "write_admin_only" ON core.empresas;
CREATE POLICY "write_admin_only" ON core.empresas
    FOR ALL TO authenticated
    USING (public.app_role() = 'admin')
    WITH CHECK (public.app_role() = 'admin');

-- Movimientos: nadie los modifica desde el frontend (llegan por ETL vía service_role).
-- Sin policy de INSERT/UPDATE/DELETE para authenticated → RLS los rechaza.

-- Audit: nadie lee/escribe desde frontend (service_role only).
-- Sin policies → RLS rechaza todo para authenticated.
