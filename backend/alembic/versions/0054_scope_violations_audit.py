"""V5++ ola CB — Tabla audit.scope_violations para guardar tentativas cross-tenant.

Cuando `assert_empresa_access()` o `EmpresaScope.filter_codes()` detecta que
un usuario intenta acceder a una empresa fuera de su scope, además de tirar
403, ahora también guarda un row en esta tabla para review por admin.

Útil para:
- Detectar usuarios con configuración incorrecta (rol mal asignado)
- Detectar tentativas maliciosas (mismo user reintenta varias veces)
- Auditoría compliance (CMF puede pedir evidencia de no cross-leakage)

Retention: 90 días por default. Se limpia con el mismo cron de audit retention
(`scripts/audit_retention_cleanup.py`).

Idempotente.
"""
from __future__ import annotations

from alembic import op

revision: str = "0054"
down_revision: str | None = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS audit.scope_violations (
            id BIGSERIAL PRIMARY KEY,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            user_id UUID NOT NULL,
            user_email TEXT,
            user_role TEXT,
            attempted_empresa TEXT NOT NULL,
            allowed_empresas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            via TEXT,                    -- 'path_param' | 'query_param' | 'body_field'
            endpoint_path TEXT,           -- /api/v1/legal etc. (opcional)
            ip_address INET,
            user_agent TEXT,
            request_id UUID,
            CONSTRAINT scope_violations_attempted_not_empty
                CHECK (attempted_empresa <> '')
        );
        """
    )

    # Índice por user_id + occurred_at DESC para "ver tentativas de este user"
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_scope_violations_user_time
        ON audit.scope_violations (user_id, occurred_at DESC);
        """
    )

    # Índice por empresa intentada (para "quién intentó acceder a CENERGY?")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_scope_violations_empresa
        ON audit.scope_violations (attempted_empresa, occurred_at DESC);
        """
    )

    # Índice por occurred_at solo (para cleanup retention)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_scope_violations_occurred_at
        ON audit.scope_violations (occurred_at);
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS audit.ix_scope_violations_user_time;")
    op.execute("DROP INDEX IF EXISTS audit.ix_scope_violations_empresa;")
    op.execute("DROP INDEX IF EXISTS audit.ix_scope_violations_occurred_at;")
    op.execute("DROP TABLE IF EXISTS audit.scope_violations;")
