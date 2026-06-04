-- R152EEEEE · Columnas para tracking de emails OC via Resend webhooks
--
-- Resend manda webhooks por cada cambio de estado del email:
--   email.sent       — Resend aceptó el email
--   email.delivered  — el servidor de destino lo aceptó
--   email.opened     — el destinatario abrió el email (pixel tracking)
--   email.clicked    — el destinatario clickeó un link
--   email.bounced    — rebotó (mailbox lleno, dominio inexistente, etc)
--   email.complained — el destinatario lo marcó como spam
--
-- Nos interesa especialmente:
--   delivered_at: confirmación de entrega → operador ve que llegó
--   opened_at:    el firmante LO LEYÓ → señal fuerte de intención
--   bounced_at:   no llegó → operador debe re-enviar con otro email
--
-- core.ordenes_compra ya tiene oc_send_message_id (R152IIII). Este es el
-- mapping para correlacionar el webhook con la OC.

ALTER TABLE core.ordenes_compra
    ADD COLUMN IF NOT EXISTS oc_email_delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS oc_email_opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS oc_email_clicked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS oc_email_bounced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS oc_email_complained_at TIMESTAMPTZ,
    -- Counter de aperturas/clicks (pueden ser múltiples).
    ADD COLUMN IF NOT EXISTS oc_email_open_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS oc_email_click_count INTEGER NOT NULL DEFAULT 0,
    -- Razón del bounce/complaint para que el operador entienda qué pasó.
    ADD COLUMN IF NOT EXISTS oc_email_bounce_reason TEXT;

-- Índice para lookups rápidos por message_id desde el webhook receiver.
CREATE INDEX IF NOT EXISTS idx_oc_sent_message_id
    ON core.ordenes_compra (oc_send_message_id)
    WHERE oc_send_message_id IS NOT NULL;

-- Tabla para guardar eventos crudos del webhook (auditoría + debug).
-- 1 row por evento entrante. Si el mismo evento llega 2 veces (retry de
-- Resend), se ignora por UNIQUE(provider_event_id).
CREATE TABLE IF NOT EXISTS core.email_events (
    event_id BIGSERIAL PRIMARY KEY,
    -- Identificador único del provider — Resend lo manda en el body.
    -- Sirve para idempotency: si Resend reintenta, no duplicamos.
    provider_event_id TEXT UNIQUE,
    -- Tipo del evento: email.sent, email.delivered, email.opened, etc.
    event_type TEXT NOT NULL,
    -- Message-Id del email (lo que mandamos en oc_send_message_id).
    message_id TEXT NOT NULL,
    -- Si pudimos correlacionar con una OC, guardamos el ID.
    oc_id INTEGER REFERENCES core.ordenes_compra(oc_id) ON DELETE SET NULL,
    -- Payload completo del webhook (para debug y forensics).
    payload JSONB NOT NULL,
    -- Cuándo Resend disparó el evento (no cuándo lo procesamos).
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_events_message_id
    ON core.email_events (message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_oc_id
    ON core.email_events (oc_id) WHERE oc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_events_occurred_at
    ON core.email_events (occurred_at DESC);

COMMENT ON TABLE core.email_events IS
    'R152EEEEE · Eventos de Resend webhook. 1 row por delivered/opened/clicked/bounced.';
