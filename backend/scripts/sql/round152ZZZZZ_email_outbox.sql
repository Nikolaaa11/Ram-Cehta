-- R152ZZZZZ · Email outbox para retry de emails fallidos.
--
-- Problema (auditoría R152SSSSS):
--   email_service.py::send() retorna None silenciosamente si Resend está
--   caído. No hay retry, no hay cola. Los emails se PIERDEN.
--
-- Solución:
--   Tabla outbox que persiste cada intento de envío. Un cron polls cada
--   2 minutos buscando rows con status='pending' y los reintenta.
--
-- Flow:
--   1. Caller llama a email_service.send_with_outbox(to, subject, html, ...)
--   2. INSERT en outbox con status='pending'
--   3. Si Resend OK → UPDATE status='sent', resend_id, sent_at
--   4. Si Resend FAIL → UPDATE status='failed', error_msg, attempts++
--   5. Cron retry: SELECT WHERE status='failed' AND attempts<5 AND
--                  last_attempt_at < NOW() - INTERVAL '5 min' * attempts
--
-- Retry strategy:
--   - Backoff exponencial: 5, 10, 20, 40, 80 min entre intentos
--   - Después de 5 intentos → status='dead', notif admin
--
-- Retención:
--   - status='sent': 30 días después de sent_at
--   - status='dead': 90 días para forensics
--   - status='failed' (mid-retry): hasta que pase a sent o dead

CREATE TABLE IF NOT EXISTS core.email_outbox (
    outbox_id BIGSERIAL PRIMARY KEY,
    -- Identidad del mensaje (idempotencia opcional)
    idempotency_key TEXT,           -- Si seteado, UNIQUE evita doble-send
    -- Destinatarios
    to_emails TEXT[] NOT NULL,
    cc_emails TEXT[] DEFAULT ARRAY[]::TEXT[],
    reply_to TEXT,
    -- Contenido
    subject TEXT NOT NULL,
    html_body TEXT NOT NULL,
    attachments_meta JSONB,         -- Lista de {name, dropbox_path, mime}
    -- Tracking
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    -- Provider response
    resend_message_id TEXT,         -- ID que devuelve Resend al enviar
    sent_at TIMESTAMPTZ,
    -- Timestamps de gestión
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ,
    -- Audit
    triggered_by_user_id UUID,      -- Quién originó este send (NULL si automático)
    triggered_by_entity TEXT,       -- 'oc:123', 'voucher:456' para correlación
    -- Opcional metadata libre (template name, etc.)
    metadata JSONB
);

-- Idempotencia opcional. Caller puede setear idempotency_key="oc-{id}-send-1"
-- para evitar doble-send de la misma OC.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_outbox_idempotency
    ON core.email_outbox (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Index para el cron retry: encontrar rápido los failed que tocan reintento.
CREATE INDEX IF NOT EXISTS ix_email_outbox_retry
    ON core.email_outbox (status, last_attempt_at)
    WHERE status IN ('pending', 'failed');

-- Index para tracking por entidad: ver todos los emails de una OC/voucher.
CREATE INDEX IF NOT EXISTS ix_email_outbox_entity
    ON core.email_outbox (triggered_by_entity, created_at DESC);

COMMENT ON TABLE core.email_outbox IS
    'R152ZZZZZ - Buffer de emails outbound con retry. Poblada por email_service.send_with_outbox(). Procesada por cron retry-failed-emails cada 2 min.';
