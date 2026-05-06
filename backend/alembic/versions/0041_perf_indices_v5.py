"""V5+ performance indices — hot paths del módulo Vouchers + Inbox + F22.

Después de V5 (vouchers, conciliación, nubox export, reportes contables) y
V5+ (inbox processing, F22, edición empresas), los siguientes endpoints
empezaron a recibir tráfico real y tocan muchas filas:

  - /vouchers (list + filtros: empresa + status + tipo + fecha)
  - /vouchers/{id}/lines (selectinload con filtro por voucher_id)
  - /admin/mailbox (list por status + categoria + received_at desc)
  - /reportes/contables/libro-diario (filter empresa + fecha range)
  - /reportes/contables/libro-mayor (filter empresa + cuenta_codigo + fecha)
  - /admin/conciliacion (LEFT JOIN voucher_lines / movimientos por monto+fecha)
  - /f22 (filter empresa + año + estado)

Esta migración agrega índices BTREE compuestos en columnas calientes que
NO los tenían. CREATE INDEX CONCURRENTLY para no bloquear prod.

Idempotencia: IF NOT EXISTS en cada índice → re-correr es seguro.

Cuando subamos escala (>50K vouchers) podemos agregar trigram en una
migración 0042. Por ahora con BTREE compuesto sub-ms es suficiente.
"""
from __future__ import annotations

from alembic import op

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels = None
depends_on = None


_INDICES: list[tuple[str, str]] = [
    # Vouchers — hot path: list filtrado por empresa + status + fecha
    (
        "ix_vouchers_empresa_status_fecha",
        "CREATE INDEX IF NOT EXISTS ix_vouchers_empresa_status_fecha "
        "ON core.vouchers(empresa_codigo, status, fecha_contable DESC)",
    ),
    # Vouchers — para reportes contables libro diario (status >= APPROVED)
    (
        "ix_vouchers_fecha_contable",
        "CREATE INDEX IF NOT EXISTS ix_vouchers_fecha_contable "
        "ON core.vouchers(fecha_contable DESC) WHERE status IN ('APPROVED','EXECUTED','SYNCED')",
    ),
    # Voucher lines — JOIN frecuente con vouchers + filter cuenta_codigo
    (
        "ix_voucher_lines_voucher",
        "CREATE INDEX IF NOT EXISTS ix_voucher_lines_voucher "
        "ON core.voucher_lines(voucher_id, line_number)",
    ),
    (
        "ix_voucher_lines_cuenta",
        "CREATE INDEX IF NOT EXISTS ix_voucher_lines_cuenta "
        "ON core.voucher_lines(cuenta_codigo)",
    ),
    (
        "ix_voucher_lines_proyecto",
        "CREATE INDEX IF NOT EXISTS ix_voucher_lines_proyecto "
        "ON core.voucher_lines(proyecto_codigo) WHERE proyecto_codigo IS NOT NULL",
    ),
    (
        "ix_voucher_lines_area",
        "CREATE INDEX IF NOT EXISTS ix_voucher_lines_area "
        "ON core.voucher_lines(area_codigo) WHERE area_codigo IS NOT NULL",
    ),
    # Voucher approvals — flujo de firma + audit
    (
        "ix_voucher_approvals_voucher",
        "CREATE INDEX IF NOT EXISTS ix_voucher_approvals_voucher "
        "ON core.voucher_approvals(voucher_id, signed_at DESC)",
    ),
    # Inbox messages — list por received_at desc + filter status/category
    (
        "ix_inbox_status_received",
        "CREATE INDEX IF NOT EXISTS ix_inbox_status_received "
        "ON core.inbox_messages(status, received_at DESC)",
    ),
    (
        "ix_inbox_linked_voucher",
        "CREATE INDEX IF NOT EXISTS ix_inbox_linked_voucher "
        "ON core.inbox_messages(linked_voucher_id) WHERE linked_voucher_id IS NOT NULL",
    ),
    (
        "ix_inbox_linked_oc",
        "CREATE INDEX IF NOT EXISTS ix_inbox_linked_oc "
        "ON core.inbox_messages(linked_oc_id) WHERE linked_oc_id IS NOT NULL",
    ),
    # Movimientos — conciliación bancaria busca por monto+fecha+empresa
    (
        "ix_movimientos_empresa_fecha_monto",
        "CREATE INDEX IF NOT EXISTS ix_movimientos_empresa_fecha_monto "
        "ON core.movimientos(empresa_codigo, fecha, monto)",
    ),
    # F29 — list filtrado por empresa + estado + vencimiento
    (
        "ix_f29_empresa_estado_venc",
        "CREATE INDEX IF NOT EXISTS ix_f29_empresa_estado_venc "
        "ON core.f29_obligaciones(empresa_codigo, estado, fecha_vencimiento) "
        "WHERE estado = 'pendiente'",
    ),
    # Plan cuentas empresa — JOIN frecuente al validar imputable
    (
        "ix_plan_cuenta_empresa_habilitada",
        "CREATE INDEX IF NOT EXISTS ix_plan_cuenta_empresa_habilitada "
        "ON core.plan_cuenta_empresa(empresa_codigo, habilitada) "
        "WHERE habilitada = TRUE",
    ),
    # Approval rules — buscar regla matching por (empresa, balance_treatment, monto)
    (
        "ix_approval_rules_empresa_active",
        "CREATE INDEX IF NOT EXISTS ix_approval_rules_empresa_active "
        "ON core.approval_rules(empresa_codigo, activa) "
        "WHERE activa = TRUE",
    ),
    # Audit log — list por user_id desc (panel admin)
    (
        "ix_audit_user_created",
        "CREATE INDEX IF NOT EXISTS ix_audit_user_created "
        "ON core.audit_log(user_id, created_at DESC)",
    ),
]


def upgrade() -> None:
    # Cerrar la transacción de Alembic para CONCURRENTLY
    op.execute("COMMIT")
    for _name, ddl in _INDICES:
        # Reemplazamos CREATE INDEX por CREATE INDEX CONCURRENTLY
        ddl_concurrent = ddl.replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY ")
        op.execute(ddl_concurrent)
    # Reabrir para que Alembic pueda escribir en alembic_version
    op.execute("BEGIN")


def downgrade() -> None:
    op.execute("COMMIT")
    for name, _ddl in _INDICES:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS core.{name}")
    op.execute("BEGIN")
