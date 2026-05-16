"""Round 68 — índices parciales por status para queries del sidebar/badges.

Los queries del sidebar (Round 67 `_count_voucher_approved_ready_to_pay`,
y la lista de transferencia-masiva preview, y la cola /aprobaciones) hacen
`WHERE status = 'XXX' AND ...` muy frecuentemente. Hoy son rápidos porque
hay <100 vouchers, pero con 10k+ vouchers el `Seq Scan` se va a notar.

Agregamos 2 índices parciales:

1. `ix_vouchers_approved_empresa` (WHERE status='APPROVED'):
   Para Round 67 badge + /transferencias preview. Solo cubre la fracción
   de vouchers en APPROVED (típicamente <5% del total), por lo que el
   índice se mantiene chico.

2. `ix_vouchers_pending_empresa` (WHERE status='PENDING'):
   Para /aprobaciones cola + count voucher_pending_approvals del sidebar.
   Mismo razonamiento — fracción chica de la tabla.

Sin índice = full Seq Scan al filtrar status. Con índice parcial = lookup
directo + bounded scan por empresa_codigo.

Idempotente: `IF NOT EXISTS`. Si Alembic se corre múltiples veces, no rompe.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
# Nota: revision corto (<32 chars) por límite del campo en alembic_version.
revision = "0063_idx_voucher_status"
down_revision = "0062_expand_doc_tributario_tipos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_approved_empresa
            ON core.vouchers (empresa_codigo, fecha_contable DESC)
            WHERE status = 'APPROVED'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_pending_empresa
            ON core.vouchers (empresa_codigo, fecha_contable DESC)
            WHERE status = 'PENDING'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_approved_empresa")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_pending_empresa")
