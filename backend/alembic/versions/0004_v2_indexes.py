"""V2 indexes — suscripciones + audit

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-26

Indexes que soportan los endpoints V2:

- idx_susc_empresa_fecha   acelera /suscripciones?empresa_codigo=...
                           (orden DESC por fecha_recibo).
- idx_etl_runs_started     /audit/etl-runs lista por started_at DESC.
- idx_etl_runs_status      /audit/etl-runs?status=failed.
- idx_rejected_run         /audit/etl-runs/{id}/rejected-rows lookup por run_id
                           (algunos schemas ya lo crean en schema.sql; lo
                           reaseguramos acá idempotente).

CONCURRENTLY no se usa porque corremos dentro de la transacción de Alembic.
Si en producción molestan los locks, ejecutar el SQL manualmente con
CREATE INDEX CONCURRENTLY antes de aplicar la migración.
"""
from __future__ import annotations

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_susc_empresa_fecha "
        "ON core.suscripciones_acciones(empresa_codigo, fecha_recibo DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_etl_runs_started "
        "ON audit.etl_runs(started_at DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_etl_runs_status "
        "ON audit.etl_runs(status);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_rejected_run "
        "ON audit.rejected_rows(run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.idx_susc_empresa_fecha;")
    op.execute("DROP INDEX IF EXISTS audit.idx_etl_runs_started;")
    op.execute("DROP INDEX IF EXISTS audit.idx_etl_runs_status;")
    op.execute("DROP INDEX IF EXISTS audit.idx_rejected_run;")
