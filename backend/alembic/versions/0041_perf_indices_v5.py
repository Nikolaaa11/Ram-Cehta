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
from sqlalchemy import text

revision: str = "0041"
down_revision: str | None = "0040"
branch_labels = None
depends_on = None


# NOTA: Los índices se crean DEFENSIVAMENTE con IF NOT EXISTS y nombres
# nuevos para no chocar con índices preexistentes de migrations 0035 (que
# ya creó algunos en voucher_lines). Si una tabla/columna no existe en el
# entorno (ej: migration aún no aplicada), el índice individual falla y
# pasamos al siguiente — el upgrade NO aborta por uno solo.
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
    # NOTA: ix_voucher_lines_cuenta / _proyecto / _area ya existen desde
    # migration 0035 (vouchers_core). No los re-creamos.
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
    # Movimientos — conciliación bancaria busca por empresa + fecha.
    # Columnas reales: `abono`, `egreso` (no `monto`). El reconcile
    # filtra por fecha+empresa y matchea monto en código.
    (
        "ix_movimientos_empresa_fecha",
        "CREATE INDEX IF NOT EXISTS ix_movimientos_empresa_fecha "
        "ON core.movimientos(empresa_codigo, fecha DESC)",
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
    # Approval rules — buscar regla matching por (empresa, activa).
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
    """Crea índices de performance V5+. Defensivo: si una tabla/columna no
    existe (entorno con migration anterior pendiente), ese índice se skipea
    y continuamos con el resto. Cada CREATE INDEX en su propia "transacción"
    (autocommit) — necesario para CONCURRENTLY.
    """
    import logging

    log = logging.getLogger("alembic")

    # Cerrar la transacción de Alembic para CONCURRENTLY
    op.execute("COMMIT")
    bind = op.get_bind()

    for name, ddl in _INDICES:
        # Reemplazamos CREATE INDEX por CREATE INDEX CONCURRENTLY
        ddl_concurrent = ddl.replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY ")
        try:
            bind.execute(text(ddl_concurrent))
        except Exception as exc:
            # Tabla/columna no existe → skip; cualquier otro error → re-raise.
            msg = str(exc).lower()
            if "does not exist" in msg or "undefined" in msg:
                log.warning(
                    "0041: skipping index %s (schema mismatch): %s", name, exc
                )
                # Asegurar que la conexión vuelve a estado limpio
                try:
                    bind.execute(text("ROLLBACK"))
                except Exception:
                    pass
            else:
                raise

    # Reabrir para que Alembic pueda escribir en alembic_version
    op.execute("BEGIN")


def downgrade() -> None:
    op.execute("COMMIT")
    for name, _ddl in _INDICES:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS core.{name}")
    op.execute("BEGIN")
