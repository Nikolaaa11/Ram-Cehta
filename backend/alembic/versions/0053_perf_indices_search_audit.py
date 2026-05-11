"""V5++ ola AQ — Índices para acelerar search global + audit + LP contratos.

El `/search` endpoint hace 9 queries ILIKE simultáneas. Sin índices funcionales
sobre las columnas filtradas, Postgres escanea full table. Estos índices
GIN trigram aceleran ILIKE 10-50x dependiendo del tamaño de la tabla.

Además agrega índices en LP contratos (Ola AL) y compuestos en audit.

Idempotente con CREATE INDEX IF NOT EXISTS.
"""
from __future__ import annotations

from alembic import op

revision: str = "0053"
down_revision: str | None = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Habilitar pg_trgm si no está ya
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")

    # 2. Trigram indices para ILIKE en /search (la query más caliente)
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_empresas_codigo_trgm
        ON core.empresas USING GIN (codigo gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_empresas_razon_trgm
        ON core.empresas USING GIN (razon_social gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_ordenes_compra_numero_trgm
        ON core.ordenes_compra USING GIN (numero_oc gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_proveedores_razon_trgm
        ON core.proveedores USING GIN (razon_social gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_trabajadores_nombre_trgm
        ON core.trabajadores USING GIN (nombre_completo gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_glosa_trgm
        ON core.vouchers USING GIN (glosa gin_trgm_ops);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vouchers_contraparte_trgm
        ON core.vouchers USING GIN (contraparte_nombre gin_trgm_ops);
        """
    )

    # 3. LP contratos: índices nuevos para la lista filtrable + summary
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_lp_contratos_estado
        ON core.lp_contratos(estado, fecha_contrato DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_lp_contratos_suscriptor_trgm
        ON core.lp_contratos USING GIN (suscriptor_nombre gin_trgm_ops);
        """
    )

    # 4. Audit: index para queries de bitacora por user + tipo entity
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_action_log_user_entity_recent
        ON audit.action_log(user_email, entity_type, created_at DESC)
        WHERE user_email IS NOT NULL;
        """
    )

    # 5. Voucher search_tsv ya existe (migración 0046). Verificar.

    # 6. ANALYZE
    op.execute("ANALYZE core.empresas;")
    op.execute("ANALYZE core.ordenes_compra;")
    op.execute("ANALYZE core.proveedores;")
    op.execute("ANALYZE core.trabajadores;")
    op.execute("ANALYZE core.vouchers;")
    op.execute("ANALYZE core.lp_contratos;")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS core.ix_empresas_codigo_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_empresas_razon_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_ordenes_compra_numero_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_proveedores_razon_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_trabajadores_nombre_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_glosa_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_vouchers_contraparte_trgm;")
    op.execute("DROP INDEX IF EXISTS core.ix_lp_contratos_estado;")
    op.execute("DROP INDEX IF EXISTS core.ix_lp_contratos_suscriptor_trgm;")
    op.execute("DROP INDEX IF EXISTS audit.ix_action_log_user_entity_recent;")
