"""V5++ perf round 2 — índices adicionales para sidebar-state composite + hot paths.

Esta migración cubre los queries que aparecen MUY seguido (cada page load)
y aún no tenían índice perfecto:

  1. app.notifications(user_id, read_at) — para count unread per user
  2. core.entregables(estado, fecha_entrega) — count críticos ≤5d
  3. core.f29_obligaciones(fecha_vencimiento) WHERE estado='pendiente' — sidebar
  4. core.f22_obligaciones(fecha_vencimiento) WHERE estado='pendiente' — sidebar
  5. core.inbox_messages(received_at DESC) WHERE status IN ('received','classified')
  6. core.vouchers(empresa_codigo, status) — list filtrado en /vouchers

Defensive: skip si tabla/columna no existe (idéntica estrategia a 0041 y 0044).

Idempotente: IF NOT EXISTS + CONCURRENTLY → safe en producción.
"""
from __future__ import annotations

import logging

from alembic import op
from sqlalchemy import text

revision: str = "0045"
down_revision: str | None = "0044"
branch_labels = None
depends_on = None


_INDICES: list[tuple[str, str]] = [
    # Notifications: count unread por user (sidebar-state composite)
    (
        "ix_notifications_user_unread",
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_unread "
        "ON app.notifications(user_id) WHERE read_at IS NULL",
    ),
    # Entregables: count críticos próximos
    (
        "ix_entregables_estado_fecha",
        "CREATE INDEX IF NOT EXISTS ix_entregables_estado_fecha "
        "ON core.entregables(estado, fecha_entrega) "
        "WHERE estado IN ('pendiente', 'en_proceso')",
    ),
    # F29 pending vencidos (sidebar critical_obligations)
    (
        "ix_f29_pendiente_vencidos",
        "CREATE INDEX IF NOT EXISTS ix_f29_pendiente_vencidos "
        "ON core.f29_obligaciones(fecha_vencimiento) "
        "WHERE estado = 'pendiente'",
    ),
    # Inbox pendientes (sidebar mailbox_pending) — partial parcial sobre status
    (
        "ix_inbox_pending_review",
        "CREATE INDEX IF NOT EXISTS ix_inbox_pending_review "
        "ON core.inbox_messages(received_at DESC) "
        "WHERE status IN ('received', 'classified')",
    ),
    # Vouchers list filter común: empresa + status
    (
        "ix_vouchers_filter_list",
        "CREATE INDEX IF NOT EXISTS ix_vouchers_filter_list "
        "ON core.vouchers(empresa_codigo, status, fecha_contable DESC)",
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
                    "0045: skipping %s (schema mismatch): %s", name, exc
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
        try:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS app.{name}")
        except Exception:
            pass
        try:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS core.{name}")
        except Exception:
            pass
    op.execute("BEGIN")
