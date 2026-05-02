"""V5 fase 4 — Tabla app.ai_insights para persistir insights de AI.

Cada corrida del cron nightly (o invocación manual) genera hasta 5 insights
con Claude. Antes los teníamos solo en logs de GitHub Actions; ahora los
guardamos para que el operador:
  - Los vea acumulados en `/admin/ai-insights`
  - Pueda marcar como leídos / archivar
  - Tengamos histórico para detectar tendencias (insight repetido = más urgente)

Idempotencia:
  - Si un insight con mismo (severity, title) ya existe SIN marcar como
    `dismissed`, lo dejamos y NO duplicamos.
  - Si fue dismissed previamente, sí permitimos re-crear (el operador
    explicitamente lo cerró, si vuelve a aparecer es nuevo evento).

Idempotencia se enforza con UNIQUE constraint y ON CONFLICT en el INSERT
del service.
"""
from __future__ import annotations

from alembic import op

revision = "0025"
down_revision: str | None = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.ai_insights (
            insight_id    BIGSERIAL PRIMARY KEY,

            severity      VARCHAR(16) NOT NULL CHECK (
                severity IN ('critical','warning','info','positive')
            ),
            title         VARCHAR(200) NOT NULL,
            body          TEXT NOT NULL DEFAULT '',
            recommendation TEXT NOT NULL DEFAULT '',
            tags          JSONB NOT NULL DEFAULT '[]'::jsonb,

            -- Estado per-usuario admin (un solo grupo de admins por ahora)
            read_at       TIMESTAMPTZ,
            dismissed_at  TIMESTAMPTZ,

            -- Trazabilidad
            generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            generation_run_id UUID NOT NULL DEFAULT gen_random_uuid(),
            tokens_in     INT NOT NULL DEFAULT 0,
            tokens_out    INT NOT NULL DEFAULT 0,

            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ai_insights_open
            ON app.ai_insights (created_at DESC)
            WHERE dismissed_at IS NULL;
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_ai_insights_severity
            ON app.ai_insights (severity);
        """
    )
    # Unique parcial: solo un insight con (severity, title) "abierto"
    # (no dismissed). Cuando el operador lo cierra, el siguiente con
    # mismo título puede entrar.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_insights_open_title
            ON app.ai_insights (severity, title)
            WHERE dismissed_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.ai_insights;")
