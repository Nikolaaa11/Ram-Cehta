-- MEGAPROMPT OC · Empresa Panimávida + pagos por PORCENTAJE
-- =====================================================================
-- 1) Alta de PANIMAVIDA Energy SpA como empresa propia (hasta hoy sus OC
--    se emitían desde RHO, pero el MANDANTE impreso decía Panimávida y esa
--    empresa no existía en la plataforma). Datos tomados del e-RUT del SII
--    (serie 202608515891, emitido 08/06/2026) y de las OC 0035-0038.
--    Hereda el equipo de firmantes y los accesos de RHO: es una filial con
--    el mismo personal.
--
-- 2) Los pagos de una OC pasan de "cuotas con monto fijo" a PORCENTAJES
--    con fecha. Las OC reales se pactan así: "30% anticipo al inicio de
--    fabricación y 70% contra entrega", "50% de anticipo y saldo contra
--    entrega". Guardar el porcentaje (y no solo el monto) permite recalcular
--    si cambia el total de la OC y es lo que el proveedor firma.
--
-- Idempotente.

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Empresa PANIMAVIDA
-- ---------------------------------------------------------------------
INSERT INTO core.empresas (
    codigo, razon_social, rut, giro, direccion, ciudad, telefono,
    representante_legal, oc_prefix, activo, org_id,
    pagina_web, contabilidad_proveedor,
    oc_template, oc_color_primario, oc_firma_colectiva, auto_send_oc_emails
) VALUES (
    'PANIMAVIDA',
    'Panimávida Energy SpA',
    '78.214.693-9',
    'Generación, Transmisión y Distribución de Energía Eléctrica',
    'Panimávida PC 3 Lote 3',
    'Colbún',
    '+56 9 87779234',
    -- Representante legal según el e-RUT (usuario de la cédula asociada).
    'Francisco Javier Chandía Pozas',
    'OC', TRUE, 'CEHTA',
    'https://panimavida.energy',
    'MCG Consultores',
    'panimavida', '#1A793B', TRUE, TRUE
)
ON CONFLICT (codigo) DO UPDATE SET
    razon_social = EXCLUDED.razon_social,
    rut          = EXCLUDED.rut,
    giro         = EXCLUDED.giro,
    direccion    = EXCLUDED.direccion,
    ciudad       = EXCLUDED.ciudad,
    telefono     = EXCLUDED.telefono,
    oc_template  = EXCLUDED.oc_template,
    oc_color_primario = EXCLUDED.oc_color_primario;
-- NOTA: logo_dropbox_path queda NULL a propósito — Panimávida tiene logo
-- propio que Nicolás va a subir desde /ordenes-compra (branding). Sin logo
-- el PDF sale igual, solo sin la imagen del encabezado.

-- ---------------------------------------------------------------------
-- 2) Equipo de firmantes: el MISMO de RHO
-- ---------------------------------------------------------------------
INSERT INTO core.empresa_equipo
    (empresa_codigo, nombre, cargo, email, rut, orden, es_default, activo, user_id)
SELECT 'PANIMAVIDA', m.nombre, m.cargo, m.email, m.rut, m.orden,
       m.es_default, m.activo, m.user_id
FROM core.empresa_equipo m
WHERE m.empresa_codigo = 'RHO' AND m.activo
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 3) Accesos: todos los que ven RHO ven Panimávida
-- ---------------------------------------------------------------------
INSERT INTO core.user_company_roles
    (user_id, empresa_codigo, role, active, notas)
SELECT r.user_id, 'PANIMAVIDA', r.role, TRUE,
       'Heredado de RHO (filial con el mismo personal)'
FROM core.user_company_roles r
WHERE r.empresa_codigo = 'RHO' AND r.active
ON CONFLICT (user_id, empresa_codigo, role) DO UPDATE SET active = TRUE;

-- ---------------------------------------------------------------------
-- 4) Pagos por PORCENTAJE (reemplaza el modelo de cuotas con monto fijo)
-- ---------------------------------------------------------------------
-- `porcentaje` es la fuente de verdad de cuánto se cobra en cada hito;
-- `monto` queda como valor derivado (porcentaje × total de la OC) para no
-- romper a los consumidores actuales (generar-vouchers, flujo de caja).
ALTER TABLE core.oc_cuotas
    ADD COLUMN IF NOT EXISTS porcentaje NUMERIC(6,3);

COMMENT ON COLUMN core.oc_cuotas.porcentaje IS
    'Porcentaje del total de la OC que se cobra en este hito (0-100). '
    'Fuente de verdad: `monto` se deriva de acá. Los porcentajes de una '
    'misma OC deben sumar 100.';
COMMENT ON COLUMN core.oc_cuotas.descripcion IS
    'Hito de pago tal como se pacta con el proveedor, ej. "Anticipo al '
    'inicio de fabricación" o "Contra entrega conforme".';

-- Las filas viejas (si hubiera) se completan derivando el % desde el monto.
UPDATE core.oc_cuotas c
SET porcentaje = ROUND((c.monto / NULLIF(oc.total, 0)) * 100, 3)
FROM core.ordenes_compra oc
WHERE oc.oc_id = c.oc_id
  AND c.porcentaje IS NULL
  AND oc.total > 0;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación (correr aparte)
-- ---------------------------------------------------------------------
-- SELECT codigo, razon_social, rut, oc_template, oc_color_primario
--   FROM core.empresas WHERE codigo IN ('RHO','PANIMAVIDA');
-- SELECT empresa_codigo, COUNT(*) FROM core.empresa_equipo
--   GROUP BY empresa_codigo;
-- SELECT empresa_codigo, COUNT(*) FROM core.user_company_roles
--   WHERE active GROUP BY empresa_codigo;
