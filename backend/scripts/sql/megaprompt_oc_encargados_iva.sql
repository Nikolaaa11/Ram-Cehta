-- MEGAPROMPT OC · Encargados de proveedor + IVA%/tipo de documento editable
-- =====================================================================
-- 1) core.proveedor_contactos: catálogo de personas de contacto por
--    proveedor (antes solo existía `proveedores.contacto`, un TEXT libre
--    sin cargo/email/teléfono ni forma de tener más de una persona). Mismo
--    patrón que core.empresa_equipo (Round B de este proyecto): catálogo
--    con ID estable, chips clickeables en el form de OC.
--
-- 2) Columnas en core.ordenes_compra:
--    - atte_nombre / atte_cargo: SNAPSHOT del encargado elegido al crear
--      la OC (mismo principio que firma_visual — "documento firmado es
--      probatorio": si el proveedor cambia de encargado después, las OC ya
--      emitidas no deben cambiar de destinatario retroactivamente).
--    - proveedor_contacto_id: referencia informativa al contacto del
--      catálogo (ON DELETE SET NULL — si el contacto se borra del catálogo,
--      el snapshot atte_nombre/atte_cargo sobrevive igual).
--    - tipo_documento: FACTURA | BOLETA — de qué documento tributario se
--      va a respaldar la compra (afecta si hay crédito fiscal IVA).
--    - iva_porcentaje: reemplaza el 19% hardcodeado. Editable por OC porque
--      no todas las compras son con factura afecta (boletas, exentos, etc).
--
-- Idempotente.

BEGIN;

-- ---------------------------------------------------------------------
-- 1) core.proveedor_contactos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.proveedor_contactos (
    contacto_id  SERIAL PRIMARY KEY,
    proveedor_id INT NOT NULL REFERENCES core.proveedores(proveedor_id) ON DELETE CASCADE,
    nombre       TEXT NOT NULL,
    cargo        TEXT,
    email        TEXT,
    telefono     TEXT,
    orden        INT NOT NULL DEFAULT 0,
    es_default   BOOLEAN NOT NULL DEFAULT FALSE,
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_proveedor_contactos_proveedor
    ON core.proveedor_contactos (proveedor_id) WHERE activo;

-- Un solo default por proveedor: evita que el form no sepa cuál preseleccionar.
CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedor_contactos_default
    ON core.proveedor_contactos (proveedor_id) WHERE es_default AND activo;

-- Migra el `contacto` TEXT libre existente como primer contacto (es_default)
-- de cada proveedor que lo tenga cargado, para no perder el dato ya escrito.
INSERT INTO core.proveedor_contactos (proveedor_id, nombre, email, telefono, es_default, orden)
SELECT p.proveedor_id, p.contacto, p.email, p.telefono, TRUE, 0
FROM core.proveedores p
WHERE p.contacto IS NOT NULL AND btrim(p.contacto) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM core.proveedor_contactos c WHERE c.proveedor_id = p.proveedor_id
  );

-- ---------------------------------------------------------------------
-- 2) Columnas en core.ordenes_compra
-- ---------------------------------------------------------------------
ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS atte_nombre TEXT,
    ADD COLUMN IF NOT EXISTS atte_cargo TEXT,
    ADD COLUMN IF NOT EXISTS proveedor_contacto_id INT
        REFERENCES core.proveedor_contactos(contacto_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT 'FACTURA',
    ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 19.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_oc_tipo_documento'
    ) THEN
        ALTER TABLE core.ordenes_compra
            ADD CONSTRAINT ck_oc_tipo_documento
            CHECK (tipo_documento IN ('FACTURA', 'BOLETA'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_oc_iva_porcentaje'
    ) THEN
        ALTER TABLE core.ordenes_compra
            ADD CONSTRAINT ck_oc_iva_porcentaje
            CHECK (iva_porcentaje >= 0 AND iva_porcentaje <= 100);
    END IF;
END $$;

COMMIT;
