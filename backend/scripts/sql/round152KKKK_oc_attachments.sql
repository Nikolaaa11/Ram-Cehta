-- R152KKKK · Tabla oc_attachments + adjuntos del email cuando auto-crea OC.
--
-- oc_pdf_service.py ya espera esta tabla para mergear adjuntos al PDF final.
-- Creamos la estructura mínima y la lógica de copy desde inbox_messages
-- vive en auto_create_oc_from_inbox_service.
--
-- Idempotente. Aplicar en Supabase Studio.

CREATE TABLE IF NOT EXISTS core.oc_attachments (
    attachment_id BIGSERIAL PRIMARY KEY,
    oc_id BIGINT NOT NULL REFERENCES core.ordenes_compra(oc_id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    dropbox_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    -- R152KKKK: origen para audit
    source TEXT CHECK (source IN ('inbox_email','manual_upload','dropbox_sync')
                       OR source IS NULL),
    inbox_message_id BIGINT,            -- FK suelta a core.inbox_messages
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Evitar duplicados del mismo path para la misma OC
    UNIQUE (oc_id, dropbox_path)
);

CREATE INDEX IF NOT EXISTS idx_oc_attachments_oc
    ON core.oc_attachments (oc_id);

CREATE INDEX IF NOT EXISTS idx_oc_attachments_inbox
    ON core.oc_attachments (inbox_message_id)
    WHERE inbox_message_id IS NOT NULL;

COMMENT ON TABLE core.oc_attachments IS
    'R152KKKK: adjuntos por OC. oc_pdf_service.generate_oc_pdf_bundle '
    'lee esta tabla cuando include_attachments=TRUE y mergea cada PDF/imagen '
    'al final del cover branded. Fuentes: email auto-creado (source=inbox_email '
    '+ inbox_message_id), upload manual del operador, o sync Dropbox.';
