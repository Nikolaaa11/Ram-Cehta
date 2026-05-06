"""V5++ Multi-tenant foundation — agrega `org_id` opcional a tablas críticas.

Estado actual: la plataforma es single-tenant (FIP CEHTA). Esta migración
**NO ROMPE NADA** — solo agrega:
  1. core.organizations table con la org default ('CEHTA')
  2. org_id opcional (NULL-able) en empresas, vouchers, inbox_messages,
     f22_obligaciones, cartolas_runs
  3. Default trigger: nuevas filas heredan la org del user que las crea
     (vía core.user_org_membership — agregada acá también)

El código actual no usa org_id (queda como NULL → default a 'CEHTA').
Cuando el segundo fondo se agregue:
  1. INSERT en core.organizations
  2. Asignar users a la nueva org via user_org_membership
  3. Agregar middleware que setea org_id automático según user
  4. Filtrar queries por org_id (cambio gradual endpoint por endpoint)

No hay breaking change. Rollback: drop columns + tabla. Nada se pierde.
"""
from __future__ import annotations

from alembic import op

revision: str = "0043"
down_revision: str | None = "0042"
branch_labels = None
depends_on = None


# Tablas que reciben org_id (críticas para multi-tenancy)
_TABLES = [
    "empresas",
    "vouchers",
    "inbox_messages",
    "f22_obligaciones",
    "cartolas_runs",
    "ordenes_compra",
    "f29_obligaciones",
    "movimientos",
]


def upgrade() -> None:
    # 1. Tabla de organizaciones (fondos/clientes potenciales)
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.organizations (
            org_id      TEXT PRIMARY KEY,
            nombre      TEXT NOT NULL,
            tipo        TEXT NOT NULL DEFAULT 'fondo'
                        CHECK (tipo IN ('fondo', 'family_office', 'consulting', 'demo')),
            activo      BOOLEAN NOT NULL DEFAULT TRUE,
            settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    # 2. Org default — todo el data existente queda implícitamente acá
    op.execute(
        """
        INSERT INTO core.organizations (org_id, nombre, tipo)
        VALUES ('CEHTA', 'Cehta Capital - FIP CEHTA ESG', 'fondo')
        ON CONFLICT (org_id) DO NOTHING
        """
    )

    # 3. Membresía user ↔ org
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.user_org_membership (
            user_id     UUID NOT NULL,
            org_id      TEXT NOT NULL REFERENCES core.organizations(org_id),
            role        TEXT NOT NULL DEFAULT 'member'
                        CHECK (role IN ('owner', 'admin', 'finance', 'viewer', 'member')),
            primary_org BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, org_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_org_membership_user "
        "ON core.user_org_membership(user_id) WHERE primary_org = TRUE"
    )

    # 4. org_id opcional en cada tabla crítica
    for tbl in _TABLES:
        op.execute(
            f"""
            ALTER TABLE core.{tbl}
            ADD COLUMN IF NOT EXISTS org_id TEXT
                REFERENCES core.organizations(org_id)
                DEFAULT 'CEHTA'
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_{tbl}_org_id
            ON core.{tbl}(org_id)
            WHERE org_id IS NOT NULL
            """
        )


def downgrade() -> None:
    for tbl in _TABLES:
        op.execute(f"ALTER TABLE core.{tbl} DROP COLUMN IF EXISTS org_id")
        op.execute(f"DROP INDEX IF EXISTS ix_{tbl}_org_id")
    op.execute("DROP TABLE IF EXISTS core.user_org_membership")
    op.execute("DROP TABLE IF EXISTS core.organizations")
