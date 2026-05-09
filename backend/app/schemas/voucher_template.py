"""Schemas Pydantic para voucher_templates (V5++ ola AB).

Reusa los Literals de voucher.py para mantener consistencia:
    VoucherTipo, ContraparteTipo, DocTributarioTipo, Moneda, IvaTratamiento
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.voucher import (
    BalanceTreatment,
    ContraparteTipo,
    DocTributarioTipo,
    IvaTratamiento,
    Moneda,
    VoucherTipo,
)


class TemplateLineCreate(BaseModel):
    """Línea de plantilla — mismo shape que VoucherLineCreate pero sin
    constraint de debit XOR credit (la plantilla puede ser usada con
    distinto monto cada vez)."""

    line_number: int = Field(ge=1)
    cuenta_codigo: str = Field(min_length=1, max_length=20)
    proyecto_codigo: str | None = None
    area_codigo: str | None = Field(default=None, min_length=3, max_length=3)
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)
    descripcion: str | None = None
    iva_tratamiento: IvaTratamiento | None = None
    balance_treatment: BalanceTreatment = "NA"


class VoucherTemplateCreate(BaseModel):
    """POST /vouchers/templates — crea plantilla nueva (manual o desde voucher)."""

    codigo: str = Field(min_length=3, max_length=50, pattern=r"^[A-Z0-9_-]+$")
    nombre: str = Field(min_length=3, max_length=200)
    empresa_codigo: str = Field(min_length=2, max_length=20)
    tipo: VoucherTipo
    glosa_default: str = Field(min_length=5, max_length=500)
    moneda: Moneda = "CLP"
    lines: list[TemplateLineCreate] = Field(min_length=1)

    contraparte_rut: str | None = None
    contraparte_nombre: str | None = None
    contraparte_tipo: ContraparteTipo | None = None
    doc_tributario_tipo: DocTributarioTipo | None = None

    @model_validator(mode="after")
    def _validate_lines(self) -> "VoucherTemplateCreate":
        nums = [line.line_number for line in self.lines]
        if sorted(nums) != list(range(1, len(self.lines) + 1)):
            raise ValueError(
                "line_number debe ser correlativo desde 1 sin saltos ni duplicados"
            )
        return self


class VoucherTemplateUpdate(BaseModel):
    """PATCH /vouchers/templates/{id} — edita plantilla existente."""

    nombre: str | None = Field(default=None, min_length=3, max_length=200)
    glosa_default: str | None = Field(default=None, min_length=5, max_length=500)
    activo: bool | None = None
    lines: list[TemplateLineCreate] | None = None
    contraparte_rut: str | None = None
    contraparte_nombre: str | None = None
    contraparte_tipo: ContraparteTipo | None = None
    doc_tributario_tipo: DocTributarioTipo | None = None


class VoucherTemplateRead(BaseModel):
    """GET /vouchers/templates/{id} — plantilla completa."""

    model_config = ConfigDict(from_attributes=True)

    template_id: int
    codigo: str
    nombre: str
    empresa_codigo: str
    tipo: VoucherTipo
    glosa_default: str
    moneda: Moneda
    lines: list[dict[str, Any]]
    contraparte_rut: str | None
    contraparte_nombre: str | None
    contraparte_tipo: ContraparteTipo | None
    doc_tributario_tipo: DocTributarioTipo | None
    activo: bool
    use_count: int
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime


class VoucherTemplateListItem(BaseModel):
    """GET /vouchers/templates — vista de lista, sin lines."""

    model_config = ConfigDict(from_attributes=True)

    template_id: int
    codigo: str
    nombre: str
    empresa_codigo: str
    tipo: VoucherTipo
    moneda: Moneda
    activo: bool
    use_count: int
    last_used_at: datetime | None


class TemplateUseRequest(BaseModel):
    """POST /vouchers/templates/{id}/use — instancia plantilla como voucher DRAFT.

    El user provee fecha_documento + fecha_contable obligatorias y opcionalmente
    overrides para los montos (si la plantilla tenía debit/credit como placeholder
    a multiplicar). El resto se hereda de la plantilla.
    """

    fecha_documento: str = Field(description="ISO YYYY-MM-DD")
    fecha_contable: str = Field(description="ISO YYYY-MM-DD")
    glosa_override: str | None = Field(
        default=None,
        description=(
            "Si se provee, reemplaza glosa_default. Soporta interpolación: "
            "{mes} {anio} {fecha} se reemplazan automáticamente."
        ),
    )
    multiplier: Decimal | None = Field(
        default=None,
        gt=0,
        description=(
            "Si se provee, multiplica debit/credit de cada línea por este "
            "factor (útil cuando la plantilla tiene montos relativos)."
        ),
    )
    doc_tributario_folio: str | None = None
