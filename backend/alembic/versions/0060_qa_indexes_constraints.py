"""QA fix 14/05/2026 — índices FK faltantes + check constraint safe.

Hallazgos del agente de auditoría DB (Round 6):

### Índices faltantes (FKs sin index → seq scan en lookups inversos)

1. `core.vouchers.movimiento_id` — FK a movimientos (post-conciliación).
   Sin índice, "qué voucher concilió este movimiento" hace seq-scan
   sobre TODA la tabla vouchers (puede ser >10k rows en 2026).

2. `core.vouchers.reversal_of` — FK self-join a voucher_id. Lookup
   "¿este voucher fue reversado?" sin índice = seq-scan.

3. `core.vouchers.reversed_by` — Mismo problema que reversal_of, otra
   dirección.

4. `core.voucher_attachments.uploaded_by` — UUID del user que subió.
   "Adjuntos de tal usuario" en auditoria sin índice.

### Check constraint nuevo (safe — no rompe data existente)

5. `core.vouchers.chk_totals_non_negative`:
   `CHECK (total_debit >= 0 AND total_credit >= 0)`.

   Hoy solo se valida `voucher_lines.debit/credit >= 0` (constraint a
   nivel línea). Los totales del header podrían quedar negativos por
   un bug del service. Aplicar a nivel DB es defensa declarativa.

   Verificación de safety: ningún voucher actual tiene totales < 0
   (los lines son non-negative y los totales son sum). Constraint
   añadible sin migración de data.

### NO se aplican (necesitan análisis):
   - `chk_balanced_when_not_draft`: posible data legacy descuadrada.
   - `chk_fecha_contable_ge_documento`: muchos vouchers podrían no cumplir.
   - `chk_rut_format`: muchos RUTs históricos podrían fallar el regex.
   Esos quedan para QA específico futuro.

Idempotente: usa `IF NOT EXISTS` / `IF EXISTS`.
"""
from __future__ import annotations

from alembic import op

revision: str = "0060"
down_revision: str | None = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Indices FK faltantes
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_movimiento_id
        ON core.vouchers (movimiento_id)
        WHERE movimiento_id IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_reversal_of
        ON core.vouchers (reversal_of)
        WHERE reversal_of IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_reversed_by
        ON core.vouchers (reversed_by)
        WHERE reversed_by IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_voucher_attachments_uploaded_by
        ON core.voucher_attachments (uploaded_by)
        """
    )
    # Check constraint safe — totals nunca deben quedar negativos
    op.execute(
        """
        ALTER TABLE core.vouchers
        DROP CONSTRAINT IF EXISTS chk_vouchers_totals_non_negative
        """
    )
    op.execute(
        """
        ALTER TABLE core.vouchers
        ADD CONSTRAINT chk_vouchers_totals_non_negative
        CHECK (total_debit >= 0 AND total_credit >= 0)
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE core.vouchers "
        "DROP CONSTRAINT IF EXISTS chk_vouchers_totals_non_negative"
    )
    op.execute("DROP INDEX IF EXISTS core.ix_voucher_attachments_uploaded_by")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_reversed_by")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_reversal_of")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_movimiento_id")
