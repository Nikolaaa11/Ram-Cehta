"""V5++ ola AB — voucher_templates: plantillas reutilizables para vouchers recurrentes.

Caso de uso:
    - Sueldos mensuales (mismo desglose cada mes, solo cambia el monto y fecha)
    - Arriendos
    - Servicios mensuales (luz, agua, internet, custodia, contabilidad)
    - Distribuciones a LPs

El usuario crea una plantilla a partir de un voucher existente:
    POST /vouchers/templates  → guarda lines como JSONB
Después la usa:
    POST /vouchers/templates/{id}/use  → crea voucher DRAFT pre-llenado

Schema:
    template_id     BIGSERIAL PK
    codigo          TEXT UNIQUE   ej "TPL-FONDO-SUELDO-CEO"
    nombre          TEXT          ej "Sueldo CEO mensual"
    empresa_codigo  TEXT FK
    tipo            TEXT          INGRESO|EGRESO|TRASPASO|...
    glosa_default   TEXT          plantilla glosa (puede tener {mes}/{anio})
    moneda          TEXT default CLP
    lines           JSONB         array de {line_number, cuenta, debit_amount, credit_amount, ...}
    contraparte_*   nullable      pre-llena si la contraparte es fija
    doc_tributario_tipo nullable
    activo          BOOLEAN default true
    use_count       INTEGER       cuántas veces se usó (analytics)
    last_used_at    TIMESTAMP
    created_by      UUID
    created_at      TIMESTAMP
    updated_at      TIMESTAMP
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0047"
down_revision: str | None = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voucher_templates",
        sa.Column("template_id", sa.BigInteger, primary_key=True),
        sa.Column("codigo", sa.Text, unique=True, nullable=False),
        sa.Column("nombre", sa.Text, nullable=False),
        sa.Column(
            "empresa_codigo",
            sa.Text,
            sa.ForeignKey("core.empresas.codigo"),
            nullable=False,
        ),
        sa.Column("tipo", sa.Text, nullable=False),
        sa.Column("glosa_default", sa.Text, nullable=False),
        sa.Column("moneda", sa.Text, server_default="CLP", nullable=False),
        sa.Column("lines", JSONB, nullable=False),
        sa.Column("contraparte_rut", sa.Text),
        sa.Column("contraparte_nombre", sa.Text),
        sa.Column("contraparte_tipo", sa.Text),
        sa.Column("doc_tributario_tipo", sa.Text),
        sa.Column(
            "activo", sa.Boolean, server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "use_count",
            sa.Integer,
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", UUID(as_uuid=False)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "tipo IN ('INGRESO','EGRESO','TRASPASO','COMPRA','VENTA',"
            "'APERTURA','CIERRE','REVERSO')",
            name="ck_voucher_templates_tipo",
        ),
        schema="core",
    )

    # Index para list filtrada por empresa + activo
    op.create_index(
        "ix_voucher_templates_empresa_activo",
        "voucher_templates",
        ["empresa_codigo", "activo"],
        schema="core",
    )

    # Index para sort por last_used_at desc (templates más usadas arriba)
    op.create_index(
        "ix_voucher_templates_last_used",
        "voucher_templates",
        [sa.text("last_used_at DESC NULLS LAST")],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_voucher_templates_last_used", table_name="voucher_templates", schema="core"
    )
    op.drop_index(
        "ix_voucher_templates_empresa_activo",
        table_name="voucher_templates",
        schema="core",
    )
    op.drop_table("voucher_templates", schema="core")
