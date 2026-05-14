"""AJUSTE 15 del prompt-maestro voucher Nubox — RBAC fix.

Hallazgo: los 43 usuarios no-admin (CONTADOR/GG/DIRECTOR/etc por empresa)
no tienen row en core.user_roles. En security.py:111 defaultean a
app_role='viewer', que NO incluye 'legal:write', así que el endpoint
POST /vouchers (y voucher_nubox-form) rechaza con 403 — no pueden
crear vouchers.

Esta migration asigna app_role='finance' a TODOS los usuarios sin rol
asignado. 'finance' incluye legal:write + oc:create + proveedor:create +
movimiento:create + f29:create + avance:create + informe_lp:create —
todo lo operativo que necesita un contador/GG/director.

El admin global (contactocehta@gmail.com) ya tiene app_role='admin' y
queda intocado por el WHERE NOT EXISTS.

Idempotente — si la migration corre de nuevo no inserta duplicados.
"""
from __future__ import annotations

from alembic import op

revision: str = "0058"
down_revision: str | None = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # AJUSTE 15: usuarios sin app_role → 'finance' (operativo full).
    # WHERE NOT EXISTS = idempotente; los que ya tienen rol (admin) quedan
    # como están.
    op.execute(
        """
        INSERT INTO core.user_roles (user_id, app_role)
        SELECT u.id, 'finance'
        FROM auth.users u
        WHERE NOT EXISTS (
            SELECT 1 FROM core.user_roles r WHERE r.user_id = u.id
        )
        """
    )


def downgrade() -> None:
    # No-op: borrar los rows de 'finance' afectaría usuarios manualmente
    # configurados. Si querés revertir, hacé un DELETE manual filtrando
    # por created_at ~ a la fecha de esta migration.
    pass
