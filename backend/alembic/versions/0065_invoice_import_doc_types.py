"""Round 80 — soporte para Invoice + ciclo completo de importacion.

Bug/feature: el operador necesita registrar vouchers de compra al exterior.
El Invoice (factura comercial del proveedor extranjero) por si solo NO es
documento tributario chileno valido. Se legaliza con:
  1. Invoice — del proveedor extranjero (lo principal)
  2. DIN (Declaracion de Ingreso) — aduana chilena, ya esta en el enum
  3. Factura de Importacion (DTE 914 SII) — emitida por agente de aduana

Esta migration extiende los CHECK constraints para aceptar todos los docs
involucrados en una importacion completa.

doc_tributario_tipo de core.vouchers agrega:
  - INVOICE                — factura comercial extranjera (principal)
  - FACTURA_IMPORTACION    — DTE 914 SII (legaliza el Invoice)
  - FACTURA_EXPORTACION    — DTE 110 SII (para completitud, exports)

voucher_attachments.tipo agrega los anexos tipicos del ciclo:
  - INVOICE                — el Invoice subido como adjunto
  - DIN                    — Declaracion de Ingreso (alias de DECLARACION_INGRESO)
  - FACTURA_IMPORTACION    — Factura de Importacion
  - PACKING_LIST           — lista de bultos / contenido
  - BILL_OF_LADING         — conocimiento de embarque maritimo
  - AIRWAY_BILL            — carta de porte aerea (AWB)
  - POLIZA_SEGURO          — poliza de seguro internacional (CIF)
  - SWIFT_PAGO             — comprobante de transferencia internacional
  - CARTA_CREDITO          — carta de credito bancaria (LC)

Idempotente: usamos DROP + ADD con IF EXISTS guard. Los valores viejos
quedan en el enum (backward compat — vouchers antiguos siguen validos).
"""
from __future__ import annotations

from alembic import op

revision = "0065_invoice_imports"
down_revision = "0064_sync_app_role_auth"
branch_labels = None
depends_on = None


# Lista canonica de doc_tributario_tipo aceptados.
DOC_TRIBUTARIO_TIPOS = [
    "DECLARACION_INGRESO",
    "FACTURA",
    "FACTURA_COMPRA",
    "FACTURA_COMPRA_ELECTRONICA",
    "FACTURA_INICIO",
    "FACTURA_ELECTRONICA",
    "FACTURA_ELECTRONICA_EXENTA",
    "FACTURA_EXENTA",
    "LIQUIDACION_FACTURA",
    "LIQUIDACION_FACTURA_ELECTRONICA",
    "NOTA_CREDITO",
    "NOTA_CREDITO_ELECTRONICA",
    "NOTA_DEBITO",
    "NOTA_DEBITO_ELECTRONICA",
    "SOLICITUD_REGISTRO_FACTURA",
    "BOLETA",
    "HONORARIOS",
    "NA",
    # Round 80 — comercio exterior
    "INVOICE",
    "FACTURA_IMPORTACION",
    "FACTURA_EXPORTACION",
]

# Lista canonica de voucher_attachments.tipo aceptados.
ATTACHMENT_TIPOS = [
    "FACTURA",
    "BOLETA",
    "CONTRATO",
    "COTIZACION",
    "TRANSFERENCIA",
    "LIQUIDACION_SUELDO",
    "ACTA",
    "RESPALDO_TECNICO",
    "OTRO",
    # Round 80 — ciclo importacion
    "INVOICE",
    "DIN",
    "FACTURA_IMPORTACION",
    "PACKING_LIST",
    "BILL_OF_LADING",
    "AIRWAY_BILL",
    "POLIZA_SEGURO",
    "SWIFT_PAGO",
    "CARTA_CREDITO",
]


def _array_literal(values: list[str]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"ARRAY[{quoted}]"


def upgrade() -> None:
    # 1. vouchers.doc_tributario_tipo — expandir enum.
    op.execute(
        "ALTER TABLE core.vouchers "
        "DROP CONSTRAINT IF EXISTS vouchers_doc_tributario_tipo_check"
    )
    op.execute(
        f"""
        ALTER TABLE core.vouchers
        ADD CONSTRAINT vouchers_doc_tributario_tipo_check
        CHECK (
          doc_tributario_tipo IS NULL
          OR doc_tributario_tipo = ANY({_array_literal(DOC_TRIBUTARIO_TIPOS)})
        )
        """
    )

    # 2. voucher_attachments.tipo — expandir enum.
    op.execute(
        "ALTER TABLE core.voucher_attachments "
        "DROP CONSTRAINT IF EXISTS voucher_attachments_tipo_check"
    )
    op.execute(
        f"""
        ALTER TABLE core.voucher_attachments
        ADD CONSTRAINT voucher_attachments_tipo_check
        CHECK (tipo = ANY({_array_literal(ATTACHMENT_TIPOS)}))
        """
    )


def downgrade() -> None:
    # Revertir a los enums anteriores Round 79.
    old_doc_tipos = [
        "DECLARACION_INGRESO", "FACTURA", "FACTURA_COMPRA",
        "FACTURA_COMPRA_ELECTRONICA", "FACTURA_INICIO", "FACTURA_ELECTRONICA",
        "FACTURA_ELECTRONICA_EXENTA", "FACTURA_EXENTA", "LIQUIDACION_FACTURA",
        "LIQUIDACION_FACTURA_ELECTRONICA", "NOTA_CREDITO",
        "NOTA_CREDITO_ELECTRONICA", "NOTA_DEBITO", "NOTA_DEBITO_ELECTRONICA",
        "SOLICITUD_REGISTRO_FACTURA", "BOLETA", "HONORARIOS", "NA",
    ]
    old_att_tipos = [
        "FACTURA", "BOLETA", "CONTRATO", "COTIZACION", "TRANSFERENCIA",
        "LIQUIDACION_SUELDO", "ACTA", "RESPALDO_TECNICO", "OTRO",
    ]
    op.execute(
        "ALTER TABLE core.vouchers "
        "DROP CONSTRAINT IF EXISTS vouchers_doc_tributario_tipo_check"
    )
    op.execute(
        f"""
        ALTER TABLE core.vouchers
        ADD CONSTRAINT vouchers_doc_tributario_tipo_check
        CHECK (
          doc_tributario_tipo IS NULL
          OR doc_tributario_tipo = ANY({_array_literal(old_doc_tipos)})
        )
        """
    )
    op.execute(
        "ALTER TABLE core.voucher_attachments "
        "DROP CONSTRAINT IF EXISTS voucher_attachments_tipo_check"
    )
    op.execute(
        f"""
        ALTER TABLE core.voucher_attachments
        ADD CONSTRAINT voucher_attachments_tipo_check
        CHECK (tipo = ANY({_array_literal(old_att_tipos)}))
        """
    )
