"""V5++ ola CE — Columna core.vouchers.source para trackear origen del voucher.

Cuando un voucher se crea desde distintos flujos (form manual, form Nubox,
importacion con IA, CSV bulk, plantilla recurrente, factura PDF) hoy no
sabemos cual fue. Agregamos una columna `source` para que:

  - El badge "IA" / "CSV" / "Manual" aparezca en la lista de vouchers.
  - Los webhooks salientes puedan filtrar por origen (ej: notificar a Slack
    solo los importados con IA para revisar precision del modelo).
  - Compliance pueda reportar "% de vouchers automatizados vs manuales".

Valores convenidos (texto libre, sin enum forzado):
  - 'manual'        — form /vouchers/nuevo (default si NULL)
  - 'nubox_form'    — form /vouchers/nubox (creacion completa con cuentas)
  - 'ai_import'     — flujo /vouchers/importar (extract-from-upload + nubox)
  - 'factura_pdf'   — flujo /vouchers/from-factura-pdf (Dropbox + Claude)
  - 'csv_bulk'      — endpoint /vouchers/import-csv
  - 'template'      — instancia desde /vouchers/templates/{id}/use

NULL = legacy / manual implicito. Idempotente.
"""
from __future__ import annotations

from alembic import op

revision: str = "0055"
down_revision: str | None = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.vouchers
        ADD COLUMN IF NOT EXISTS source TEXT
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_source
        ON core.vouchers (source)
        WHERE source IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_source")
    op.execute("ALTER TABLE core.vouchers DROP COLUMN IF EXISTS source")
