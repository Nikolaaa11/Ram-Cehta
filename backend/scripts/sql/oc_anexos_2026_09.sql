-- ============================================================================
-- Anexos de OC (2026-09-21)
-- ============================================================================
-- Nicolás: "que se pueda adjuntar anexo a las oc".
--
-- La tabla core.oc_attachments ya existía (la llena el inbox de correos) y
-- el PDF de la OC ya mergea sus filas al final. Faltaba subirlos a mano:
-- endpoints en app/api/v1/oc_anexos.py con source = 'manual_upload' (valor
-- que el CHECK ya admitía).
--
-- Lo único nuevo: quién lo subió y una descripción opcional, para que la
-- ficha diga "Cotización firmada · subido por X el …". Columnas nullable →
-- aditivo, idempotente, no rompe al código viejo ni a las filas del inbox.
-- ============================================================================

-- (sin \set: este archivo también lo corre apply_pending_migrations.py,
--  que ejecuta SQL plano y no entiende los meta-comandos de psql.)

BEGIN;

ALTER TABLE core.oc_attachments
    ADD COLUMN IF NOT EXISTS descripcion      TEXT,
    ADD COLUMN IF NOT EXISTS subido_por       UUID,
    ADD COLUMN IF NOT EXISTS subido_por_email TEXT;

DO $$
BEGIN
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'core' AND table_name = 'oc_attachments'
           AND column_name IN ('descripcion', 'subido_por', 'subido_por_email')) <> 3 THEN
        RAISE EXCEPTION 'FAIL · faltan columnas nuevas en core.oc_attachments';
    END IF;
    RAISE NOTICE 'OK · core.oc_attachments lista para anexos manuales';
END $$;

COMMIT;
