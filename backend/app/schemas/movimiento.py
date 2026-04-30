from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class MovimientoRead(BaseModel):
    movimiento_id: int
    fecha: date
    descripcion: str | None
    abono: Decimal
    egreso: Decimal
    saldo_contable: Decimal | None
    saldo_cehta: Decimal | None
    saldo_corfo: Decimal | None
    concepto_general: str | None
    concepto_detallado: str | None
    tipo_egreso: str | None
    fuente: str | None
    proyecto: str | None
    banco: str | None
    real_proyectado: str | None
    anio: int
    periodo: str
    empresa_codigo: str
    iva_credito_fiscal: Decimal
    iva_debito_fiscal: Decimal
    tipo_documento: str | None
    numero_documento: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MovimientoManualCreate(BaseModel):
    """Payload para registrar un movimiento manual fuera del ETL.

    Casos de uso: ajustes contables, transferencias inversor, correcciones
    one-off que no vienen del Excel madre. Persiste con `real_proyectado='real'`
    y un `natural_key` con prefijo `manual_` para distinguir del ETL en audit.

    El `periodo` y `anio` se auto-derivan de `fecha` (formato MM_YY) si no se
    pasan, igual que hace el ETL.
    """

    fecha: date
    empresa_codigo: str = Field(..., min_length=1, max_length=20)
    descripcion: str = Field(..., min_length=1, max_length=500)
    abono: Decimal = Field(default=Decimal("0"), ge=0)
    egreso: Decimal = Field(default=Decimal("0"), ge=0)
    concepto_general: str | None = Field(None, max_length=120)
    concepto_detallado: str | None = Field(None, max_length=240)
    tipo_egreso: str | None = Field(None, max_length=120)
    fuente: str | None = Field(None, max_length=120)
    proyecto: str | None = Field(None, max_length=120)
    banco: str | None = Field(None, max_length=120)
    tipo_documento: str | None = Field(None, max_length=60)
    numero_documento: str | None = Field(None, max_length=120)

    @model_validator(mode="after")
    def _validate_amounts(self) -> "MovimientoManualCreate":
        if self.abono == 0 and self.egreso == 0:
            raise ValueError(
                "Al menos uno de `abono` o `egreso` debe ser > 0"
            )
        if self.abono > 0 and self.egreso > 0:
            raise ValueError(
                "No podés tener abono Y egreso en el mismo movimiento — "
                "creá dos separados si necesitás ambos"
            )
        return self

    def derived_periodo(self) -> str:
        """`MM_YY` derivado de `fecha` — mismo formato que el ETL."""
        return f"{self.fecha.month:02d}_{self.fecha.year % 100:02d}"

    def derived_anio(self) -> int:
        return self.fecha.year
