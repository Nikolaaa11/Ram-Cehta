"""dashboard performance indexes

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-26

Indexes destinados a soportar los endpoints de /api/v1/dashboard/*.

- idx_mov_periodo_real      acelera filtros por (periodo, real_proyectado)
                            usados en /kpis y /egresos-por-concepto.
- idx_mov_empresa_fecha     soporta el lookup "último saldo por empresa"
                            con DISTINCT ON (empresa_codigo) ORDER BY fecha DESC.
- idx_mov_proyecto_fecha    acelera /proyectos-ranking (filtra fecha + agrega).
- idx_etl_runs_finished_ok  /kpis lee MAX(finished_at) WHERE status='success'.
- idx_oc_estado             /kpis cuenta OCs filtrando por estado.

CONCURRENTLY no se usa porque corremos dentro de la transacción de Alembic.
Si en producción molestan los locks, ejecutar el SQL manualmente con
CREATE INDEX CONCURRENTLY antes de aplicar la migración.
"""
from __future__ import annotations

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mov_periodo_real "
        "ON core.movimientos(periodo, real_proyectado);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mov_empresa_fecha "
        "ON core.movimientos(empresa_codigo, fecha DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_mov_proyecto_fecha "
        "ON core.movimientos(proyecto, fecha) "
        "WHERE proyecto IS NOT NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_etl_runs_finished_ok "
        "ON audit.etl_runs(finished_at DESC) "
        "WHERE status = 'success';"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_oc_estado "
        "ON core.ordenes_compra(estado);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.idx_mov_periodo_real;")
    op.execute("DROP INDEX IF EXISTS core.idx_mov_empresa_fecha;")
    op.execute("DROP INDEX IF EXISTS core.idx_mov_proyecto_fecha;")
    op.execute("DROP INDEX IF EXISTS audit.idx_etl_runs_finished_ok;")
    op.execute("DROP INDEX IF EXISTS core.idx_oc_estado;")
