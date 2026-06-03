-- R152IIII · Auto-envío del PDF de OC al GG (con CC a encargados).
--
-- Pedido del operador: cuando se auto-crea una OC desde email, mandar el
-- PDF directamente al GG firmante (TO) y copiar a los encargados (CC).
--
-- Decisiones:
-- - emails_oc_cc en core.empresas como TEXT[] simple (no tabla aparte).
--   La cantidad típica es 2-4 personas por empresa.
-- - oc_sent_to / oc_sent_cc / oc_sent_at en core.ordenes_compra para audit:
--   queda registro exacto de a quién se envió.
-- - oc_send_error para troubleshooting (si Resend rechaza, falla DNS, etc.)

-- =====================================================================
-- 1. Empresas: lista de CC para OCs
-- =====================================================================

ALTER TABLE core.empresas
    ADD COLUMN IF NOT EXISTS emails_oc_cc TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS auto_send_oc_emails BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN core.empresas.emails_oc_cc IS
    'R152IIII: lista de emails que reciben CC cuando se manda una OC al GG. '
    'Típico: encargados operativos, equipo cehta, contador. '
    'Si oc_firma_colectiva=TRUE (RHO), los emails de firmantes_extra también '
    'se agregan automáticamente al TO.';

COMMENT ON COLUMN core.empresas.auto_send_oc_emails IS
    'R152IIII: master switch por empresa. Si FALSE, ninguna OC auto-creada '
    'desde email genera envío automático (la OC se crea igual, pero queda '
    'esperando que el operador la mande manual).';

-- =====================================================================
-- 2. core.ordenes_compra: audit de envío
-- =====================================================================

ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS oc_sent_to TEXT,
    ADD COLUMN IF NOT EXISTS oc_sent_cc TEXT[],
    ADD COLUMN IF NOT EXISTS oc_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS oc_send_error TEXT,
    ADD COLUMN IF NOT EXISTS oc_send_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_oc_sent_at
    ON core.ordenes_compra (oc_sent_at DESC NULLS LAST)
    WHERE oc_sent_at IS NOT NULL;

COMMENT ON COLUMN core.ordenes_compra.oc_sent_to IS
    'R152IIII: email del firmante (GG) al que se envió el PDF. NULL = aún '
    'no enviada o falló.';

COMMENT ON COLUMN core.ordenes_compra.oc_sent_cc IS
    'R152IIII: emails CC del envío. Snapshot al momento del envío (la '
    'config en empresas.emails_oc_cc puede cambiar después).';

COMMENT ON COLUMN core.ordenes_compra.oc_send_message_id IS
    'R152IIII: ID que Resend devuelve. Útil para trazar el delivery en '
    'el dashboard de Resend.';

-- =====================================================================
-- 3. Seed inicial: emails CC default
--    Placeholder con un email genérico de Cehta. El operador edita en
--    /admin/oc-branding con los emails reales por empresa.
-- =====================================================================

UPDATE core.empresas
SET emails_oc_cc = ARRAY['contactocehta@gmail.com']::TEXT[]
WHERE emails_oc_cc IS NULL OR cardinality(emails_oc_cc) = 0;
