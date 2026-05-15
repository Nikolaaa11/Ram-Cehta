"""Etapa M — Tabla core.voucher_comments para discusion operativa por voucher.

Caso de uso: el operador crea un voucher pero le falta info ("falta confirmar
RUT del proveedor"). En lugar de un email separado, escribe un comment en el
voucher. El aprobador lo lee, responde o lo resuelve. Queda historial completo
con timestamps.

Tabla minima — sin reply nesting (un solo nivel chat-style), sin reactions,
sin attachments inline. Future: si crece la necesidad, ampliamos.

Schema:
  - comment_id     BIGSERIAL PK
  - voucher_id     FK a core.vouchers, ON DELETE CASCADE
  - user_id        UUID del autor (auth.users.id)
  - user_email     denormalizado (snapshot al momento del comment) para
                   no hacer JOIN cada vez ni perder data si el user se
                   desactiva
  - body           TEXT NOT NULL, max 2000 chars (validado en API)
  - resolved       BOOLEAN default false — si la conversacion concluyo,
                   se marca como resuelta (visual color subdued)
  - created_at, updated_at timestamps con timezone

Indices:
  - (voucher_id, created_at DESC) — listing ordenado en el detail
"""
from __future__ import annotations

from alembic import op

revision: str = "0059"
down_revision: str | None = "0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.voucher_comments (
            comment_id   BIGSERIAL PRIMARY KEY,
            voucher_id   BIGINT NOT NULL
                         REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
            user_id      UUID NOT NULL,
            user_email   TEXT NOT NULL,
            body         TEXT NOT NULL CHECK (length(trim(body)) >= 1),
            resolved     BOOLEAN NOT NULL DEFAULT FALSE,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_voucher_comments_voucher_created
        ON core.voucher_comments (voucher_id, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_voucher_comments_user
        ON core.voucher_comments (user_id, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_voucher_comments_user")
    op.execute("DROP INDEX IF EXISTS core.ix_voucher_comments_voucher_created")
    op.execute("DROP TABLE IF EXISTS core.voucher_comments")
