"""Endpoints de currency conversion (V4 fase 1 — UF/CLP/USD).

Cuatro endpoints:
  * `GET /currency/rates`  — lista cache (auth básica).
  * `GET /currency/latest` — UF + USD de hoy en una sola request.
  * `POST /currency/convert` — convierte un monto.
  * `POST /currency/refresh` — fuerza fetch desde APIs (admin only).

Soft-fail end-to-end: si las APIs externas caen, los GETs devuelven
`null` para los campos sin datos en lugar de 5xx. La UI hace fallback
mostrando el monto original sin conversión.
"""
from __future__ import annotations

from datetime import date as date_type
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.currency import (
    ConversionRequest,
    ConversionResult,
    CurrencyRateRead,
    LatestRatesResponse,
    RefreshResult,
)
from app.services.currency_service import CurrencyService

router = APIRouter()


@router.get("/rates", response_model=list[CurrencyRateRead])
async def list_rates(
    user: CurrentUser,
    db: DBSession,
    currency: Annotated[str | None, Query()] = None,
    from_date: Annotated[date_type | None, Query()] = None,
    to_date: Annotated[date_type | None, Query()] = None,
) -> list[CurrencyRateRead]:
    """Lista las tasas cacheadas en el rango (default últimos 30 días).

    Sin auth especial — son datos públicos del Banco Central.
    """
    today = date_type.today()
    if to_date is None:
        to_date = today
    if from_date is None:
        # Default: últimos 30 días.
        from datetime import timedelta

        from_date = to_date - timedelta(days=30)

    svc = CurrencyService(db)
    return await svc.bulk_get_rates(from_date, to_date, currency=currency)


@router.get("/latest", response_model=LatestRatesResponse)
async def latest_rates(
    user: CurrentUser,
    db: DBSession,
) -> LatestRatesResponse:
    """UF + USD de hoy. Soft-fail por moneda: si una falla, viene None."""
    svc = CurrencyService(db)
    today = date_type.today()
    uf = await svc.get_uf_rate(today)
    usd = await svc.get_usd_rate(today)
    return LatestRatesResponse(uf_clp=uf, usd_clp=usd, date=today)


@router.post("/convert", response_model=ConversionResult)
async def convert_amount(
    user: CurrentUser,
    db: DBSession,
    payload: ConversionRequest,
) -> ConversionResult:
    """Convierte un monto entre CLP/UF/USD."""
    svc = CurrencyService(db)
    target_date = payload.date or date_type.today()
    converted = await svc.convert(
        payload.amount,
        payload.from_currency,
        payload.to_currency,
        date=target_date,
    )

    # Para la rate_used, devolvemos la tasa de la moneda no-CLP usada.
    # Si fue UF→USD, mostramos rate de UF (la "primaria" del request).
    rate_used: object = None
    if payload.from_currency == payload.to_currency:
        rate_used = 1
    elif payload.from_currency != "CLP":
        rate_used = await svc._get_rate(
            payload.from_currency, target_date
        )
    else:
        rate_used = await svc._get_rate(
            payload.to_currency, target_date
        )

    return ConversionResult(
        from_amount=payload.amount,
        from_currency=payload.from_currency,
        to_amount=converted,
        to_currency=payload.to_currency,
        rate_used=rate_used,  # type: ignore[arg-type]
        date_used=target_date,
    )


@router.post("/refresh", response_model=RefreshResult)
async def refresh_today(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
) -> RefreshResult:
    """Refresh manual de las tasas de hoy. Admin only (scope `audit:read`).

    Útil cuando el cron diario no corrió o hubo un blip en las APIs.
    """
    svc = CurrencyService(db)
    result = await svc.refresh_today()
    return RefreshResult(**result)
