"""Round 41 — expandir CHECK de vouchers.doc_tributario_tipo a los 18 valores SII.

Hallazgo: el CHECK actual solo permite 6 valores:
  FACTURA · BOLETA · NOTA_CREDITO · NOTA_DEBITO · HONORARIOS · NA

PERO el código Pydantic (`NuboxFormCreate.tipo_documento`) acepta 18:
  DECLARACION_INGRESO · FACTURA · FACTURA_COMPRA · FACTURA_COMPRA_ELECTRONICA ·
  FACTURA_INICIO · FACTURA_ELECTRONICA · FACTURA_ELECTRONICA_EXENTA ·
  FACTURA_EXENTA · LIQUIDACION_FACTURA · LIQUIDACION_FACTURA_ELECTRONICA ·
  NOTA_CREDITO · NOTA_CREDITO_ELECTRONICA · NOTA_DEBITO · NOTA_DEBITO_ELECTRONICA ·
  SOLICITUD_REGISTRO_FACTURA · BOLETA · HONORARIOS · NA

Riesgo: si el operador elige FACTURA_ELECTRONICA en el form Nubox, el
Pydantic acepta el body, pero el INSERT a core.vouchers falla con
CheckViolationError. Esto recién no se manifestó porque Nubox-form
preset el tipo más común (FACTURA) y nadie clickeó otras opciones, pero
es bomba de tiempo.

Fix: actualizar el CHECK para incluir los 18 valores SII (V5++ ola CH —
catálogo SII oficial). Mantiene los 6 antiguos para no romper data.
"""
from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0062_expand_doc_tributario_tipos"
down_revision = "0061_relax_action_log_check"
branch_labels = None
depends_on = None

_TIPOS_SII_18 = """
ARRAY[
    'DECLARACION_INGRESO',
    'FACTURA',
    'FACTURA_COMPRA',
    'FACTURA_COMPRA_ELECTRONICA',
    'FACTURA_INICIO',
    'FACTURA_ELECTRONICA',
    'FACTURA_ELECTRONICA_EXENTA',
    'FACTURA_EXENTA',
    'LIQUIDACION_FACTURA',
    'LIQUIDACION_FACTURA_ELECTRONICA',
    'NOTA_CREDITO',
    'NOTA_CREDITO_ELECTRONICA',
    'NOTA_DEBITO',
    'NOTA_DEBITO_ELECTRONICA',
    'SOLICITUD_REGISTRO_FACTURA',
    'BOLETA',
    'HONORARIOS',
    'NA'
]
"""


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.vouchers
            DROP CONSTRAINT IF EXISTS vouchers_doc_tributario_tipo_check
        """
    )
    op.execute(
        f"""
        ALTER TABLE core.vouchers
            ADD CONSTRAINT vouchers_doc_tributario_tipo_check
            CHECK (
                doc_tributario_tipo IS NULL
                OR doc_tributario_tipo = ANY ({_TIPOS_SII_18})
            )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE core.vouchers
            DROP CONSTRAINT IF EXISTS vouchers_doc_tributario_tipo_check
        """
    )
    op.execute(
        """
        ALTER TABLE core.vouchers
            ADD CONSTRAINT vouchers_doc_tributario_tipo_check
            CHECK (doc_tributario_tipo = ANY (ARRAY[
                'FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO',
                'HONORARIOS', 'NA'
            ]))
        """
    )
