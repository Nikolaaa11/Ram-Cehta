"""V5++ ola CG — Columna core.empresas.logo_dropbox_path para PDF branded.

Cada empresa puede tener un logo asociado para imprimir en PDFs de OCs,
EEFF reports, vouchers branded, etc. Path al archivo en Dropbox bajo
`/Cehta Capital/01-Empresas/{CODIGO}/00-Branding/logo.png`.

Solo agrega la columna — la lógica de upload y rendering es del backend.

Idempotente.
"""
from __future__ import annotations

from alembic import op

revision: str = "0056"
down_revision: str | None = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.empresas
        ADD COLUMN IF NOT EXISTS logo_dropbox_path TEXT
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.empresas
        DROP COLUMN IF EXISTS logo_dropbox_path
        """
    )
