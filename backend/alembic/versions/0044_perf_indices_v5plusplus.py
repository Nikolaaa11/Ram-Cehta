"""V5++ adicional perf indices — hot paths de cartolas + reportes.

Después de V5++ los siguientes endpoints son nuevos hot paths:
  - /cartolas/runs?empresa=X (filter empresa + ORDER BY triggered_at DESC)
  - Reportes HTML libro-diario / balance-prueba (joins voucher_lines × plan_cuentas)
  - Conciliación bancaria con movimientos.fuente='cartola_pdf'

Esta migración agrega índices BTREE adicionales sin bloquear (CONCURRENTLY).

Idempotente: IF NOT EXISTS + try/except de defensive upgrade.
"""
from __future__ import annotations

import logging

from alembic import op
from sqlalchemy import text

revision: str = "0044"
down_revision: str | None = "0043"
branch_labels = None
depends_on = None


_INDICES: list[tuple[str, str]] = [
    # cartolas_runs ya tiene ix_cartolas_runs_empresa pero conviene compuesto
    # con status para filter rápido en /admin/cartolas-runs
    (
        "ix_cartolas_runs_status_triggered",
        "CREATE INDEX IF NOT EXISTS ix_cartolas_runs_status_triggered "
        "ON core.cartolas_runs(status, triggered_at DESC)",
    ),
    # plan_cuentas — JOIN constante en reportes contables (libro mayor, balance)
    (
        "ix_plan_cuentas_codigo",
        "CREATE INDEX IF NOT EXISTS ix_plan_cuentas_codigo "
        "ON core.plan_cuentas(codigo)",
    ),
    # voucher_lines parcial: solo APPROVED+ (los reportes filtran por status)
    # Esto es chico (90% de filas) pero acelera la pasada por reports.
    (
        "ix_voucher_lines_approved_join",
        "CREATE INDEX IF NOT EXISTS ix_voucher_lines_approved_join "
        "ON core.voucher_lines(voucher_id, cuenta_codigo, debit, credit)",
    ),
    # movimientos por fuente (cartola_pdf vs etl_excel) — útil para
    # filtrar conciliación solo a movimientos del banco
    (
        "ix_movimientos_fuente",
        "CREATE INDEX IF NOT EXISTS ix_movimientos_fuente "
        "ON core.movimientos(fuente, fecha DESC) WHERE fuente IS NOT NULL",
    ),
    # inbox_messages por category (filter en /admin/mailbox)
    (
        "ix_inbox_category_received",
        "CREATE INDEX IF NOT EXISTS ix_inbox_category_received "
        "ON core.inbox_messages(category, received_at DESC) "
        "WHERE category IS NOT NULL",
    ),
]


def upgrade() -> None:
    log = logging.getLogger("alembic")
    op.execute("COMMIT")
    bind = op.get_bind()

    for name, ddl in _INDICES:
        ddl_concurrent = ddl.replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY ")
        try:
            bind.execute(text(ddl_concurrent))
        except Exception as exc:
            msg = str(exc).lower()
            if "does not exist" in msg or "undefined" in msg:
                log.warning(
                    "0044: skipping index %s (schema mismatch): %s", name, exc
                )
                try:
                    bind.execute(text("ROLLBACK"))
                except Exception:
                    pass
            else:
                raise

    op.execute("BEGIN")


def downgrade() -> None:
    op.execute("COMMIT")
    for name, _ddl in _INDICES:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS core.{name}")
    op.execute("BEGIN")
