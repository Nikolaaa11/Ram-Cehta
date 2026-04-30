"""Schemas Pydantic para Portfolio Consolidado USD (V4 fase 4).

Vista cross-empresa para LP reporting (Limited Partners denominados en USD).
Agrega los saldos de las 9 empresas del FIP CEHTA y los convierte a CLP/USD/UF
usando `CurrencyService`.

Soft-fail: si `CurrencyService` no tiene rate disponible para hoy, los campos
`total_usd` / `total_uf` y los `saldo_usd` por empresa vienen `None`. La UI
debe caer a CLP-only sin romper.

Mantener sincronizado con `frontend/lib/api/schema.ts` (tipos manual).
"""
from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class EmpresaPortfolioRow(BaseModel):
    """Una fila de la tabla por empresa.

    `saldo_native` es el saldo en la moneda donde realmente vive la cuenta
    (`currency_native`). Para casi todas las empresas hoy es CLP, pero el
    schema queda preparado para cuando alguien tenga cuenta en USD o UF.
    """

    empresa_codigo: str
    razon_social: str
    saldo_native: Decimal
    currency_native: str  # "CLP" / "UF" / "USD"
    saldo_clp: Decimal
    saldo_usd: Decimal | None = None  # None si no hay rate disponible
    percent_of_portfolio: Decimal  # 0.0 a 100.0


class CurrencyBreakdownItem(BaseModel):
    """Donut: cuánto del portafolio está en cada moneda.

    `total_clp` es la suma equivalente en CLP de las cuentas en esa moneda.
    `percent` es el porcentaje sobre el total CLP del portafolio (0 a 100).
    """

    currency: str  # "CLP" / "UF" / "USD"
    total_clp: Decimal
    percent: Decimal


class MonthlyPoint(BaseModel):
    """Punto del trend de saldo total por mes."""

    periodo: str           # "MM_YY"
    fecha_inicio: date_type
    total_clp: Decimal
    total_usd: Decimal | None = None  # None si no había USD rate ese día


class RatesUsed(BaseModel):
    """Tasas usadas para los cálculos. Útil para el tooltip de los KPIs."""

    uf_clp: Decimal | None = None
    usd_clp: Decimal | None = None
    date: date_type


class PortfolioConsolidated(BaseModel):
    """Vista consolidada del portafolio cross-empresa.

    Estructura optimizada para que la UI pueda renderear todo el dashboard
    `/portafolio` con una sola request.
    """

    generated_at: datetime
    total_clp: Decimal
    total_usd: Decimal | None = None  # None si no hay USD rate hoy
    total_uf: Decimal | None = None   # None si no hay UF rate hoy
    empresas: list[EmpresaPortfolioRow]
    currency_breakdown: list[CurrencyBreakdownItem]
    monthly_trend: list[MonthlyPoint]
    rates_used: RatesUsed
    warnings: list[str] = Field(default_factory=list)
