-- R152HHHH · Link entidades auto-creadas desde inbox.
--
-- Cuando llega un email y Claude lo clasifica como tipo=oc/voucher/factura,
-- el sistema crea automáticamente la entidad y la linkea al inbox_message
-- vía estas dos columnas. Auditoría + drill-down en la UI.
--
-- Idempotente. Aplicar en Supabase Studio.

ALTER TABLE core.inbox_messages
    ADD COLUMN IF NOT EXISTS created_entity_type TEXT
        CHECK (created_entity_type IN ('orden_compra','voucher','factura') OR created_entity_type IS NULL),
    ADD COLUMN IF NOT EXISTS created_entity_id BIGINT,
    ADD COLUMN IF NOT EXISTS auto_create_error TEXT,
    ADD COLUMN IF NOT EXISTS auto_create_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_inbox_created_entity
    ON core.inbox_messages (created_entity_type, created_entity_id)
    WHERE created_entity_id IS NOT NULL;

COMMENT ON COLUMN core.inbox_messages.created_entity_type IS
    'R152HHHH: tipo de entidad creada automáticamente desde este email '
    '(orden_compra, voucher, factura). NULL si Claude clasificó pero no '
    'se logró auto-crear (o el operador todavía no aprobó).';

COMMENT ON COLUMN core.inbox_messages.created_entity_id IS
    'R152HHHH: ID de la entidad creada. Para drill-down desde /admin/mailbox '
    'al detalle del OC/voucher/factura.';

COMMENT ON COLUMN core.inbox_messages.auto_create_error IS
    'R152HHHH: si la auto-creación falló (RUT inválido, empresa no detectada, '
    'AI returned junk), guarda el mensaje de error acá. NULL = sin intento '
    'o éxito.';
