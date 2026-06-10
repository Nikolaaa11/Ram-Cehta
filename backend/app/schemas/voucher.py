"""Schemas Pydantic para vouchers (V5).

Validación en 3 capas:
  1. Frontend (Zod) — UX, mensajes inmediatos
  2. API (acá) — Pydantic, autoritative
  3. DB (triggers) — última red de seguridad

La regla de partida doble se valida en `VoucherCreate.model_validator`
para que ningún POST descuadrado llegue a la DB. El trigger Postgres
es backup adicional.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


# Literals — espejo exacto de los CHECK constraints de la migración 0035
VoucherTipo = Literal[
    "INGRESO", "EGRESO", "TRASPASO", "COMPRA", "VENTA",
    "APERTURA", "CIERRE", "REVERSO",
]
VoucherStatus = Literal[
    "DRAFT", "PENDING", "APPROVED", "EXECUTED",
    "SYNCED", "RECONCILED", "CLOSED", "REJECTED", "VOID",
]
ContraparteTipo = Literal[
    "PROVEEDOR", "CLIENTE", "EMPLEADO", "BANCO", "INTERNO", "OTRO"
]
DocTributarioTipo = Literal[
    # Round 144 — expandido para soportar TODOS los tipos que el form
    # Nubox y CORFO pueden generar. Antes solo aceptaba 6 valores (los
    # genéricos), y vouchers creados desde /vouchers/nubox-form con
    # tipo_documento='FACTURA_ELECTRONICA_EXENTA' (o similar) tiraban
    # ValidationError al leerse con GET /vouchers/{id} → 500 →
    # "no se pudo cargar voucher" en el FE.
    # Bug reportado por el usuario al hacer clic en un voucher DRAFT
    # de CORFO. Fix: alinear el Literal con la lista de
    # NuboxFormCreate.tipo_documento (vouchers_nubox_form.py:238).
    "FACTURA",
    "BOLETA",
    "NOTA_CREDITO",
    "NOTA_DEBITO",
    "HONORARIOS",
    "NA",
    # Tipos electrónicos / SII
    "DECLARACION_INGRESO",
    "FACTURA_COMPRA",
    "FACTURA_COMPRA_ELECTRONICA",
    "FACTURA_INICIO",
    "FACTURA_ELECTRONICA",
    "FACTURA_ELECTRONICA_EXENTA",
    "FACTURA_EXENTA",
    "LIQUIDACION_FACTURA",
    "LIQUIDACION_FACTURA_ELECTRONICA",
    "NOTA_CREDITO_ELECTRONICA",
    "NOTA_DEBITO_ELECTRONICA",
    "SOLICITUD_REGISTRO_FACTURA",
    # Comercio exterior (Round 80)
    "INVOICE",
    "FACTURA_IMPORTACION",
    "FACTURA_EXPORTACION",
]
Moneda = Literal["CLP", "UF", "USD", "EUR"]
IvaTratamiento = Literal["AFECTO", "EXENTO", "NO_GRAVADO", "NA"]
BalanceTreatment = Literal["GASTO", "ACTIVACION", "NA"]
AttachmentTipo = Literal[
    "FACTURA", "BOLETA", "CONTRATO", "COTIZACION",
    "TRANSFERENCIA", "LIQUIDACION_SUELDO", "ACTA",
    "RESPALDO_TECNICO", "OTRO",
]


# =====================================================================
# Voucher Lines
# =====================================================================


class VoucherLineCreate(BaseModel):
    """Una línea debe/haber con imputación triple."""

    line_number: int = Field(ge=1, description="Orden dentro del voucher")
    cuenta_codigo: str = Field(min_length=1, max_length=20)
    proyecto_codigo: str | None = None
    area_codigo: str | None = Field(default=None, min_length=3, max_length=3)
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)
    descripcion: str | None = None
    iva_tratamiento: IvaTratamiento | None = None
    iva_amount: Decimal | None = None
    neto_amount: Decimal | None = None
    balance_treatment: BalanceTreatment = "NA"

    @model_validator(mode="after")
    def _xor_debit_credit(self) -> "VoucherLineCreate":
        """Una línea es debit XOR credit. Espejo del CHECK constraint."""
        if self.debit > 0 and self.credit > 0:
            raise ValueError(
                f"Línea {self.line_number}: no puede tener debit y credit > 0 al mismo tiempo"
            )
        if self.debit == 0 and self.credit == 0:
            raise ValueError(
                f"Línea {self.line_number}: debe tener debit O credit > 0"
            )
        return self


class VoucherLineRead(VoucherLineCreate):
    model_config = ConfigDict(from_attributes=True)
    line_id: int
    voucher_id: int
    created_at: datetime


# =====================================================================
# Voucher header
# =====================================================================


class VoucherCreate(BaseModel):
    """POST /vouchers — crear voucher con sus líneas en una transacción.

    Si `status` se omite, queda en `DRAFT` (permite descuadre temporal).
    Para crear directamente en `PENDING` (raro), las líneas tienen que
    cuadrar.
    """

    empresa_codigo: str = Field(min_length=2, max_length=20)
    tipo: VoucherTipo
    status: VoucherStatus = "DRAFT"
    fecha_documento: date
    fecha_contable: date
    fecha_ejecucion: date | None = None
    # Round 132 (Observaciones 20/05/2026): fecha_vencimiento +
    # documento_dropbox_path se aceptan ahora en POST /vouchers (antes
    # solo el endpoint nubox-form los soportaba). Permite que el form
    # /vouchers/nuevo guarde estos campos sin pasar por nubox-form.
    fecha_vencimiento: date | None = None
    documento_dropbox_path: str | None = Field(default=None, max_length=500)
    glosa: str = Field(min_length=5, max_length=500)
    moneda: Moneda = "CLP"
    exchange_rate: Decimal | None = None

    contraparte_rut: str | None = Field(default=None, max_length=20)
    contraparte_nombre: str | None = Field(default=None, max_length=200)
    contraparte_tipo: ContraparteTipo | None = None

    doc_tributario_tipo: DocTributarioTipo | None = None
    doc_tributario_folio: str | None = Field(default=None, max_length=50)
    doc_tributario_sii_track_id: str | None = None

    banco: str | None = None
    banco_cuenta_alias: str | None = None

    threshold_aplicado: bool = False
    reversal_of: int | None = None

    # R152EEEEEE — Cap defensivo: voucher típico tiene 2-10 líneas, máximo
    # razonable son 50-100 para cierres complejos. Sin esto un POST con
    # 10.000 líneas bloqueaba el pool DB con N×3 round-trips de validación.
    lines: list[VoucherLineCreate] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _validate_lines(self) -> "VoucherCreate":
        """Reglas de negocio que se cruzan con las líneas."""
        # 1. line_number único e iniciando en 1
        nums = [line.line_number for line in self.lines]
        if sorted(nums) != list(range(1, len(self.lines) + 1)):
            raise ValueError(
                "line_number debe ser correlativo desde 1 sin saltos ni duplicados"
            )

        # 2. Partida doble — solo si NO está en DRAFT
        if self.status != "DRAFT":
            total_debit = sum(line.debit for line in self.lines)
            total_credit = sum(line.credit for line in self.lines)
            if total_debit != total_credit:
                raise ValueError(
                    f"Partida doble descuadrada: debe={total_debit} haber={total_credit} "
                    f"diferencia={total_debit - total_credit}. Para guardar descuadrado "
                    f"temporalmente, usá status=DRAFT."
                )

        # 3. COMPRA/VENTA exigen documento tributario
        if self.tipo in ("COMPRA", "VENTA"):
            if (
                self.doc_tributario_tipo is None
                or self.doc_tributario_tipo == "NA"
                or not self.doc_tributario_folio
            ):
                raise ValueError(
                    f"Voucher de {self.tipo} requiere doc_tributario_tipo + folio"
                )

        # 4. REVERSO requiere reversal_of
        if self.tipo == "REVERSO" and self.reversal_of is None:
            raise ValueError("Voucher de REVERSO requiere reversal_of")

        # 5. Líneas con cuenta de balance puro pueden tener proyecto/area NULL,
        #    pero el resto debería traer ambos. La validación fina (cuenta es
        #    de balance puro?) la hace el endpoint con consulta a DB.

        return self


class VoucherUpdate(BaseModel):
    """PATCH /vouchers/{id} — solo se permite mientras DRAFT (validado en endpoint).

    Status NO se cambia con PATCH — usar acciones específicas:
      POST /vouchers/{id}/submit   → DRAFT → PENDING
      POST /vouchers/{id}/reject   → PENDING → REJECTED
      POST /vouchers/{id}/void     → cualquier estado activo → VOID
    """

    glosa: str | None = Field(default=None, min_length=5, max_length=500)
    fecha_documento: date | None = None
    fecha_contable: date | None = None
    fecha_ejecucion: date | None = None
    contraparte_rut: str | None = None
    contraparte_nombre: str | None = None
    contraparte_tipo: ContraparteTipo | None = None
    doc_tributario_tipo: DocTributarioTipo | None = None
    doc_tributario_folio: str | None = None
    banco: str | None = None
    banco_cuenta_alias: str | None = None


class VoucherRead(BaseModel):
    """GET /vouchers/{id} — voucher con todas sus relaciones cargadas."""

    model_config = ConfigDict(from_attributes=True)

    voucher_id: int
    codigo: str
    empresa_codigo: str
    tipo: VoucherTipo
    status: VoucherStatus
    fecha_documento: date
    fecha_contable: date
    fecha_ejecucion: date | None
    glosa: str
    total_debit: Decimal
    total_credit: Decimal
    moneda: Moneda
    exchange_rate: Decimal | None
    contraparte_rut: str | None
    contraparte_nombre: str | None
    contraparte_tipo: ContraparteTipo | None
    doc_tributario_tipo: DocTributarioTipo | None
    doc_tributario_folio: str | None
    doc_tributario_sii_track_id: str | None
    banco: str | None
    banco_cuenta_alias: str | None
    movimiento_id: int | None
    threshold_aplicado: bool
    reversal_of: int | None
    reversed_by: int | None
    nubox_folio: str | None
    nubox_synced_at: datetime | None
    nubox_status: str | None
    rejection_reason: str | None
    void_reason: str | None
    created_by: str | None
    requested_by: str | None
    # V5++ ola CE — origen (manual/nubox_form/ai_import/csv/etc); NULL=legacy
    source: str | None = None
    created_at: datetime
    updated_at: datetime
    lines: list[VoucherLineRead]


class VoucherListItem(BaseModel):
    """GET /vouchers — vista de lista, sin líneas."""

    model_config = ConfigDict(from_attributes=True)

    voucher_id: int
    codigo: str
    empresa_codigo: str
    tipo: VoucherTipo
    status: VoucherStatus
    fecha_contable: date
    glosa: str
    total_debit: Decimal
    total_credit: Decimal
    moneda: Moneda
    contraparte_nombre: str | None
    threshold_aplicado: bool
    # V5++ ola CE — Origen del voucher para mostrar badge en la lista
    source: str | None = None
    created_at: datetime
    # Round 104 — proyecto contable dominante (de la primera línea con
    # proyecto_codigo no null). Permite mostrar en la lista de vouchers a
    # qué proyecto corresponde sin tener que abrir el detalle.
    proyecto_dominante: str | None = None


# =====================================================================
# Attachments
# =====================================================================


class VoucherAttachmentCreate(BaseModel):
    tipo: AttachmentTipo
    file_name: str = Field(min_length=1, max_length=200)
    dropbox_path: str = Field(min_length=1, max_length=500)
    file_hash: str | None = Field(default=None, max_length=64)
    mime_type: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)


class VoucherAttachmentRead(VoucherAttachmentCreate):
    model_config = ConfigDict(from_attributes=True)
    attachment_id: int
    voucher_id: int
    uploaded_by: str | None
    uploaded_at: datetime


class BulkPdfRequest(BaseModel):
    """Body de `POST /vouchers/bulk-pdf` — descarga ZIP con PDFs de varios vouchers.

    Cap defensivo de 50 elementos para no saturar Dropbox / la pool DB durante
    el cierre mensual. Si la operativa necesita más, se mueve a job async.
    """

    voucher_ids: list[int] = Field(..., min_length=1, max_length=50)
    include_attachments: bool = True
