"""Schemas Pydantic para currency conversion (V4 fase 1).

Tres conceptos:
  * `CurrencyRateRead` — una fila de cache con la tasa de una moneda
    en CLP para una fecha. La FE lo usa en charts y debug views.
  * `ConversionRequest` / `ConversionResult` — round-trip del endpoint
    `/currency/convert`. El front siempre recibe la `rate_used` y la
    `date_used` para mostrar trazabilidad ("@ UF $39.500").
  * `LatestRatesResponse` — endpoint hot-path `/currency/latest` que
    devuelve UF + USD del día en una sola respuesta para hidratar el
    contexto global de la app.

Mantener sincronizado con `frontend/lib/api/schema.ts` (tipos manual).
"""
from __future__ import annotations

from datetime import date as date_type
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

# Enum cerrado: cualquier código fuera quiebra Pydantic 422 antes de
# llegar al servicio. Mantener match con `convert()` en service.
CurrencyCode = Literal["CLP", "UF", "USD"]
RateSource = Literal["bcn", "mindicador", "manual", "fallback"]


class CurrencyRateRead(BaseModel):
    currency_code: str
    date: date_type
    rate_clp: Decimal
    source: str

    model_config = {"from_attributes": True}


class ConversionRequest(BaseModel):
    amount: Decimal = Field(..., description="Monto a convertir (cualquier signo).")
    from_currency: CurrencyCode
    to_currency: CurrencyCode
    date: date_type | None = Field(
        default=None,
        description="Fecha de la tasa. Default: hoy.",
    )


class ConversionResult(BaseModel):
    from_amount: Decimal
    from_currency: str
    to_amount: Decimal | None
    to_currency: str
    rate_used: Decimal | None
    date_used: date_type | None


class LatestRatesResponse(BaseModel):
    """Snapshot de UF + USD para hoy. Si alguno no está disponible
    (API caída + sin cache), el campo viene None y la UI hace soft-fail.
    """

    uf_clp: Decimal | None
    usd_clp: Decimal | None
    date: date_type


class RefreshResult(BaseModel):
    """Resultado del refresh manual (POST /currency/refresh)."""

    refreshed: int
    skipped: int
    errors: list[str] = Field(default_factory=list)
    rates: list[CurrencyRateRead] = Field(default_factory=list)
