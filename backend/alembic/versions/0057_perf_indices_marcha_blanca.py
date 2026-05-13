"""V5++ ola CJ — Indices que reportó el audit de perf como faltantes.

Específicamente:
  1. core.movimientos: índice parcial para el DISTINCT ON de saldos por
     empresa (usado en portfolio, dashboard CEO, saldos-por-empresa).
     Sin él hace scan completo de ~50k rows cada vez.
  2. core.voucher_attachments(voucher_id, uploaded_at): usado en
     subquery del nuevo endpoint /vouchers/mis-pendientes para traer
     primer_adjunto + primer_adjunto_id.

Idempotente — CREATE INDEX IF NOT EXISTS.
"""
from __future__ import annotations

from alembic import op

revision: str = "0057"
down_revision: str | None = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Indice parcial para DISTINCT ON (empresa_codigo, banco) en queries
    # de saldos. Sin él, el dashboard CEO p95 sufre. El parcial limita el
    # tamaño del índice a solo las rows reales con saldo (no proyectado, no
    # nulos), que son las únicas que usan estas queries.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_movimientos_saldos_real
        ON core.movimientos (empresa_codigo, banco, fecha DESC, movimiento_id DESC)
        WHERE real_proyectado = 'Real'
          AND saldo_contable IS NOT NULL
        """
    )

    # 2. Indice compuesto para que la subquery LIMIT 1 ORDER BY uploaded_at ASC
    # use el índice en vez de scan completo de attachments por voucher.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher_uploaded
        ON core.voucher_attachments (voucher_id, uploaded_at ASC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.idx_movimientos_saldos_real")
    op.execute(
        "DROP INDEX IF EXISTS core.idx_voucher_attachments_voucher_uploaded"
    )
