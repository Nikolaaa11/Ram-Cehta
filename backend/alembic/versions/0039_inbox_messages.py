"""V5+ Inbox processing — tabla para tracking de emails entrantes.

Pipeline:
  1. Servicio IMAP poll Gmail UNSEEN cada 15min (cron Fly)
  2. Para cada mail nuevo, INSERT row en core.inbox_messages con:
     - message_id (RFC 2822, idempotente)
     - from/to/subject/body_text/body_html
     - has_attachments / attachments_meta JSON
  3. Clasificador Claude lee la row → UPDATE category + ai_summary +
     draft_response_html
  4. Si tiene PDF adjunto, sube a Dropbox /00-Inbox/{año}/{mes}/{file}
     y guarda paths en attachments_meta
  5. Nicolás abre /admin/inbox, revisa cada mail con su draft, click
     "Enviar respuesta" → Resend manda el HTML editado y row pasa a
     status='replied'

Idempotencia: UNIQUE constraint sobre message_id. Re-correr el poll no
duplica mails ni regenera drafts ya hechos.

Categorías AI iniciales (extensible):
  - factura_proveedor    → ofrecer "crear voucher COMPRA" o "linkear a OC"
  - boleta_honorarios    → ofrecer "crear voucher COMPRA"
  - pago_confirmado      → ofrecer "marcar OC como pagada"
  - consulta_lp          → draft de respuesta + ping a Guido
  - consulta_cliente     → draft de respuesta amable + ping a comercial
  - spam                 → archivar sin draft
  - notif_banco          → parsear monto/fecha/contraparte → conciliación
  - notif_sii            → flag urgente, ping legal
  - otro                 → draft genérico de "gracias, te respondemos pronto"
"""
from __future__ import annotations

from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.inbox_messages (
            inbox_id            BIGSERIAL PRIMARY KEY,

            -- Identidad RFC 2822 — único globalmente, idempotencia del poll
            message_id          TEXT NOT NULL UNIQUE,
            in_reply_to         TEXT,
            thread_id           TEXT,

            -- Headers básicos
            from_email          TEXT NOT NULL,
            from_name           TEXT,
            to_emails           TEXT[] NOT NULL DEFAULT '{}',
            cc_emails           TEXT[] NOT NULL DEFAULT '{}',
            subject             TEXT NOT NULL DEFAULT '',
            received_at         TIMESTAMPTZ NOT NULL,

            -- Cuerpo (los dos formatos por si el cliente solo manda uno)
            body_text           TEXT,
            body_html           TEXT,

            -- Adjuntos. JSON estructura:
            -- [{"filename": "...", "content_type": "...", "size_bytes": N,
            --   "dropbox_path": "/00-Inbox/...", "extracted_text": "..."}, ...]
            has_attachments     BOOLEAN NOT NULL DEFAULT FALSE,
            attachments_meta    JSONB NOT NULL DEFAULT '[]'::jsonb,

            -- Clasificación AI
            category            TEXT,        -- factura_proveedor | pago_confirmado | ...
            ai_confidence       NUMERIC(3,2), -- 0.00–1.00
            ai_summary          TEXT,        -- 1-2 oraciones, qué quiere el remitente
            ai_suggested_action TEXT,        -- "crear voucher", "marcar OC pagada", etc.
            draft_response_html TEXT,        -- borrador de respuesta que Nicolás puede editar

            -- Linking opcional con artefactos generados desde este email
            linked_voucher_id   BIGINT REFERENCES core.vouchers(voucher_id),
            linked_oc_id        INT REFERENCES core.ordenes_compra(oc_id),
            linked_movimiento_id BIGINT,

            -- Estado del flujo
            status              TEXT NOT NULL DEFAULT 'received'
                                CHECK (status IN (
                                    'received',     -- recién bajado del IMAP
                                    'classified',   -- clasificador AI corrió
                                    'reviewed',     -- Nicolás lo abrió pero no actuó
                                    'replied',      -- envió respuesta vía Resend
                                    'archived',     -- descartado / spam
                                    'failed'        -- error en clasificación
                                )),

            -- Auditoría
            classified_at       TIMESTAMPTZ,
            replied_at          TIMESTAMPTZ,
            replied_by_user_id  TEXT,
            archived_at         TIMESTAMPTZ,
            archived_reason     TEXT,

            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    # Índices para los queries más comunes
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inbox_received_at ON core.inbox_messages(received_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inbox_status ON core.inbox_messages(status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inbox_category ON core.inbox_messages(category)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inbox_from ON core.inbox_messages(from_email)"
    )

    # Trigger updated_at
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.touch_inbox_updated_at() RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_inbox_updated_at ON core.inbox_messages;
        CREATE TRIGGER trg_inbox_updated_at
            BEFORE UPDATE ON core.inbox_messages
            FOR EACH ROW
            EXECUTE FUNCTION core.touch_inbox_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_inbox_updated_at ON core.inbox_messages")
    op.execute("DROP FUNCTION IF EXISTS core.touch_inbox_updated_at()")
    op.execute("DROP TABLE IF EXISTS core.inbox_messages")
