-- R152mmm — Asignar a claudia@trongkai.com acceso completo a REVTECH y TRONGKAI.
--
-- Claudia es la coordinadora del subsidio CORFO 2024-265638 desde TRONGKAI
-- (co-ejecutor con REVTECH). Necesita poder ver TODAS las pestañas de ambas
-- empresas como si fuera GG (gerente general) — no solo el grupo "ClaudIA"
-- del sidebar que muestra los 4 items del subsidio.
--
-- Modelo de datos:
--   core.user_company_roles (user_id, empresa_codigo, role, active, granted_at, granted_by)
--   Roles válidos: GG, COO, CONTADOR, OPERADOR, DIRECTOR, TESORERIA
--   (definido en backend/app/api/v1/approval_rules.py:39)
--
-- Este script:
--   1. Busca el user_id de claudia@trongkai.com en auth.users de Supabase
--   2. Le asigna role 'GG' a REVTECH (full access para esa empresa)
--   3. Le asigna role 'GG' a TRONGKAI
--   4. Es idempotente (ON CONFLICT DO UPDATE para reactivar si ya existía)
--
-- Cómo correrlo:
--   1. Abrir Supabase Studio (sql editor) del proyecto Brasil
--   2. Copiar y pegar este archivo entero
--   3. Run

-- Paso 0: Verificar que Claudia existe en auth.users
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = 'claudia@trongkai.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'No se encontró usuario claudia@trongkai.com en auth.users. ' ||
      'Primero crear el usuario via Supabase Studio > Authentication > Users > Add User. ' ||
      'Después re-ejecutar este script.';
  END IF;

  RAISE NOTICE 'Usuario Claudia encontrado: user_id=%', v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Paso 1+2: Asignar GG en REVTECH y TRONGKAI
WITH claudia AS (
  SELECT id AS user_id FROM auth.users
  WHERE lower(email) = 'claudia@trongkai.com'
  LIMIT 1
)
INSERT INTO core.user_company_roles (user_id, empresa_codigo, role, active, granted_at, granted_by)
SELECT
  claudia.user_id,
  emp.codigo,
  'GG'::text AS role,
  TRUE AS active,
  NOW() AS granted_at,
  'R152mmm-script' AS granted_by
FROM claudia
CROSS JOIN (VALUES ('REVTECH'), ('TRONGKAI')) AS emp(codigo)
ON CONFLICT (user_id, empresa_codigo, role)
DO UPDATE SET
  active = TRUE,
  granted_at = NOW(),
  granted_by = 'R152mmm-script-reactivate';

-- Paso 3: Verificar que quedó OK
SELECT
  u.email,
  ucr.empresa_codigo,
  ucr.role,
  ucr.active,
  ucr.granted_at,
  ucr.granted_by
FROM core.user_company_roles ucr
JOIN auth.users u ON u.id = ucr.user_id
WHERE lower(u.email) = 'claudia@trongkai.com'
ORDER BY ucr.empresa_codigo;
