"""V5++ ola AF — Índices defensivos para multi-tenant scope + audit.

Nuevos índices que aceleran las queries introducidas en olas AD-AE:

1. core.user_company_roles(user_id, active) — multi-tenant scope lookup
   El path crítico al inicio de cada request: "¿qué empresas puede ver
   este user?" se ejecuta sobre esta tabla. Index parcial WHERE active=TRUE
   reduce el set a aproximadamente lo necesario.

2. core.vouchers(empresa_codigo, status, fecha_contable DESC) — composite
   El query típico del list es: filtrar empresa + status + sortear por
   fecha. Sin este index, scan de tabla completa.

3. core.vouchers(empresa_codigo, created_at DESC) — para dashboards.

4. core.ordenes_compra(empresa_codigo, estado, fecha_emision DESC) — paralelo
   al de vouchers.

5. core.empresas(activo, codigo) — para el cache lookup "¿empresa activa?"
   en assert_empresa_access.

Todos los índices son `IF NOT EXISTS` (idempotente). Si la tabla ya tiene
mucha data, usar `CONCURRENTLY` para no bloquear writes.
"""
from __future__ import annotations

from alembic import op

revision: str = "0050"
down_revision: str | None = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Multi-tenant scope lookup (path crítico AD)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_user_company_roles_active_user
        ON core.user_company_roles(user_id, empresa_codigo)
        WHERE active = TRUE;
        """
    )

    # 2-3. Vouchers — composite por list page y dashboard
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_empresa_status_fecha
        ON core.vouchers(empresa_codigo, status, fecha_contable DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_empresa_created
        ON core.vouchers(empresa_codigo, created_at DESC);
        """
    )

    # 4. OCs — paralelo
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_oc_empresa_estado_fecha
        ON core.ordenes_compra(empresa_codigo, estado, fecha_emision DESC);
        """
    )

    # 5. Empresas activas (lookup rápido por codigo)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_empresas_codigo_activo
        ON core.empresas(codigo)
        WHERE activo = TRUE;
        """
    )

    # Audit log: filtrar por user_email + entity_type + tiempo
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_action_log_user_recent
        ON audit.action_log(user_email, created_at DESC)
        WHERE user_email IS NOT NULL;
        """
    )

    # ANALYZE para que el planner agarre las stats nuevas
    op.execute("ANALYZE core.user_company_roles;")
    op.execute("ANALYZE core.vouchers;")
    op.execute("ANALYZE core.ordenes_compra;")
    op.execute("ANALYZE core.empresas;")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_user_company_roles_active_user;")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_empresa_status_fecha;")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_empresa_created;")
    op.execute("DROP INDEX IF EXISTS core.ix_oc_empresa_estado_fecha;")
    op.execute("DROP INDEX IF EXISTS core.ix_empresas_codigo_activo;")
    op.execute("DROP INDEX IF EXISTS audit.ix_action_log_user_recent;")
