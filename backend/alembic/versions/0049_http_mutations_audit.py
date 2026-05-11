"""V5++ ola AE — Tabla audit.http_mutations + índices.

Tabla coarse-grained de cada request mutante (POST/PATCH/PUT/DELETE).
Complementa audit.action_log (que captura diffs entity-level).

Casos de uso:
  - "¿qué hizo el user X en la última hora?" (forense)
  - "¿cuántos endpoints lentos hay?" (perf monitoring vía latency_ms)
  - "¿hay bursts de requests?" (detección de abuso)

Retención: la tabla crece rápido. Default policy: retener 90 días, después
borrar con un cron job (se agrega en una ola posterior).

Indices:
  - (timestamp DESC) para "últimas N mutaciones"
  - (user_email, timestamp DESC) para "actividad de user X"
  - (status_code, timestamp DESC) para "errores recientes"
  - (path, timestamp DESC) para "endpoint hot"
"""
from __future__ import annotations

from alembic import op

revision: str = "0049"
down_revision: str | None = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Schema audit ya existe (creado por 0034 audit_log)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.http_mutations (
            id              BIGSERIAL PRIMARY KEY,
            method          TEXT NOT NULL CHECK (method IN ('POST','PATCH','PUT','DELETE')),
            path            TEXT NOT NULL,
            status_code     INTEGER NOT NULL,
            latency_ms      INTEGER NOT NULL,
            user_email      TEXT,
            ip              TEXT,
            user_agent      TEXT,
            timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

    # Índice principal: trail cronológico
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_http_mutations_timestamp "
        "ON audit.http_mutations(timestamp DESC);"
    )

    # Índice forense: actividad por usuario
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_http_mutations_user "
        "ON audit.http_mutations(user_email, timestamp DESC) "
        "WHERE user_email IS NOT NULL;"
    )

    # Índice errores: status 4xx/5xx
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_http_mutations_errors "
        "ON audit.http_mutations(status_code, timestamp DESC) "
        "WHERE status_code >= 400;"
    )

    # Índice perf: endpoints lentos
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_http_mutations_slow "
        "ON audit.http_mutations(latency_ms DESC, timestamp DESC) "
        "WHERE latency_ms > 1000;"
    )

    # Vista convenience para últimas 24h
    op.execute(
        """
        CREATE OR REPLACE VIEW audit.http_mutations_recent_24h AS
        SELECT
            id, method, path, status_code, latency_ms,
            user_email, ip, timestamp
        FROM audit.http_mutations
        WHERE timestamp > (now() - INTERVAL '24 hours')
        ORDER BY timestamp DESC;
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS audit.http_mutations_recent_24h;")
    op.execute("DROP TABLE IF EXISTS audit.http_mutations CASCADE;")
