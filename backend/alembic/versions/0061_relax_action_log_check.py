"""Round 40 — relajar audit.action_log.action_log_action_check.

Hallazgo durante QA E2E del flujo voucher (Round 39):
- El constraint `action_log_action_check` solo permite 8 valores:
    create | update | delete | approve | reject | sync | upload | other
- El código del backend ya usa 20+ valores distintos (`download_pdf`,
  `bulk_approve`, `create_nubox_form`, `execute`, `submit`, `merge`,
  `marcar_suscrito`, `delete_bulk`, `export_transferencia_masiva`, etc.).
- Resultado: cada vez que un endpoint llama audit_log con uno de esos
  valores, el INSERT falla con `CheckViolationError` y el log se pierde
  (el endpoint principal sigue funcionando porque audit_log es soft-fail,
  pero quedan agujeros en la trazabilidad).

Fix: reemplazar el ENUM hardcodeado por un check más laxo
  `CHECK (length(action) BETWEEN 1 AND 64)`
que valida tipo+forma pero no encierra a un set fijo. Si el código
necesita agregar un nuevo action en el futuro, no requiere migración.

Mantenemos el constraint (no lo dropeamos) porque previene escrituras
de strings absurdamente largos o vacíos en el log.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0061_relax_action_log_check"
down_revision = "0060_qa_indexes_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE audit.action_log
            DROP CONSTRAINT IF EXISTS action_log_action_check
        """
    )
    op.execute(
        """
        ALTER TABLE audit.action_log
            ADD CONSTRAINT action_log_action_check
            CHECK (length(action) BETWEEN 1 AND 64)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE audit.action_log
            DROP CONSTRAINT IF EXISTS action_log_action_check
        """
    )
    op.execute(
        """
        ALTER TABLE audit.action_log
            ADD CONSTRAINT action_log_action_check
            CHECK (action = ANY (ARRAY[
                'create'::text, 'update'::text, 'delete'::text,
                'approve'::text, 'reject'::text, 'sync'::text,
                'upload'::text, 'other'::text
            ]))
        """
    )
