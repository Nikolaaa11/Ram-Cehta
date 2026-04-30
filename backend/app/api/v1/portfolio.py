"""Portfolio Consolidado USD — V4 fase 4.

GET /api/v1/portfolio/consolidated agrega los saldos de las 9 empresas del
FIP CEHTA y los convierte a CLP/USD/UF para LP reporting (Limited Partners
denominados en USD).

Diseño:
- Reutilizamos la SQL del CEO consolidated: el CTE `WITH ult AS (...)` con
  DISTINCT ON (empresa_codigo, banco) sobre `core.movimientos` filtrando
  `real_proyectado='Real'`. Es la misma fuente de verdad que ya usa el
  Dashboard CEO — evitamos divergencia de saldos entre vistas.
- `CurrencyService` da las tasas UF/USD del día. Si una falla, soft-fail:
  el `total_usd` (o el campo correspondiente) viene `None` y se loggea un
  `warning` que la UI muestra como banner.
- `monthly_trend`: agrega saldos por mes durante los últimos 12 meses.
  Para cada mes, tomamos el último saldo conocido por empresa+banco y
  sumamos. La conversión a USD usa la tasa USD del último día del mes
  (best-effort: si no hay tasa para ese día, intenta cache, sino None).

Auth: cualquier usuario autenticado (read-only). No expone PII más allá
de los datos que ya están en `/dashboard/ceo-consolidated`.
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.schemas.portfolio import (
    CurrencyBreakdownItem,
    EmpresaPortfolioRow,
    MonthlyPoint,
    PortfolioConsolidated,
    RatesUsed,
)
from app.services.currency_service import CurrencyService

log = logging.getLogger(__name__)
router = APIRouter()

ZERO = Decimal("0")
_ONE_DAY = timedelta(days=1)


# =====================================================================
# Helpers puros (testeables sin DB)
# =====================================================================
def compute_percentages(
    empresa_saldos_clp: list[tuple[str, Decimal]],
) -> dict[str, Decimal]:
    """Devuelve {empresa_codigo: percent} basado en saldos CLP.

    El total nunca debería ser 0 en producción, pero protegemos para
    evitar ZeroDivisionError. Los porcentajes suman 100% modulo rounding.
    Empresas con saldo 0 reciben 0%.
    """
    total: Decimal = ZERO
    for _, s in empresa_saldos_clp:
        total = total + s
    if total == 0:
        return {codigo: ZERO for codigo, _ in empresa_saldos_clp}
    return {
        codigo: (saldo / total * Decimal(100)).quantize(Decimal("0.01"))
        for codigo, saldo in empresa_saldos_clp
    }


def compute_currency_breakdown(
    rows: list[EmpresaPortfolioRow],
) -> list[CurrencyBreakdownItem]:
    """Agrupa por `currency_native` sumando los `saldo_clp` equivalentes.

    Devuelve una lista ordenada por total_clp descendente. Los porcentajes
    suman 100% modulo rounding.
    """
    grouped: dict[str, Decimal] = {}
    for r in rows:
        grouped[r.currency_native] = grouped.get(r.currency_native, ZERO) + r.saldo_clp

    total: Decimal = ZERO
    for v in grouped.values():
        total = total + v
    out: list[CurrencyBreakdownItem] = []
    for currency, total_clp in grouped.items():
        pct = (
            (total_clp / total * Decimal(100)).quantize(Decimal("0.01"))
            if total > 0
            else ZERO
        )
        out.append(
            CurrencyBreakdownItem(
                currency=currency,
                total_clp=total_clp,
                percent=pct,
            )
        )
    out.sort(key=lambda it: it.total_clp, reverse=True)
    return out


def last_day_of_month(year: int, month: int) -> date:
    """Devuelve el último día del mes (28-31)."""
    if month == 12:
        return date(year, 12, 31)
    # Primer día del siguiente mes - 1 día.
    return date(year, month + 1, 1) - _ONE_DAY


def months_back(today: date, n: int = 12) -> list[tuple[int, int]]:
    """Lista de (year, month) para los últimos N meses inclusive.

    El último elemento es el mes actual; el primero es n-1 meses atrás.
    """
    out: list[tuple[int, int]] = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


def periodo_label(year: int, month: int) -> str:
    """Devuelve "MM_YY" para un (year, month)."""
    return f"{month:02d}_{year % 100:02d}"


# =====================================================================
# GET /portfolio/consolidated
# =====================================================================
@router.get("/consolidated", response_model=PortfolioConsolidated)
async def portfolio_consolidated(
    user: CurrentUser, db: DBSession
) -> PortfolioConsolidated:
    """Vista consolidada del portafolio en CLP/USD/UF.

    Agrega los saldos de las 9 empresas del FIP CEHTA y los convierte a
    USD/UF usando las tasas del día. Soft-fail: si las tasas no están
    disponibles, los campos USD/UF vienen `None` y la respuesta incluye
    un warning para que la UI muestre solo CLP.
    """
    today = date.today()
    warnings: list[str] = []

    # ----- Tasas del día (soft-fail) ------------------------------------
    svc = CurrencyService(db)
    try:
        uf_rate = await svc.get_uf_rate(today)
    except Exception as exc:
        log.warning("portfolio.uf_rate_failed: %s", exc)
        uf_rate = None
    try:
        usd_rate = await svc.get_usd_rate(today)
    except Exception as exc:
        log.warning("portfolio.usd_rate_failed: %s", exc)
        usd_rate = None

    if usd_rate is None or usd_rate == 0:
        warnings.append(
            "No hay tasa USD disponible para hoy. Los totales en USD vienen "
            "como null — la UI muestra solo CLP."
        )
    if uf_rate is None or uf_rate == 0:
        warnings.append("No hay tasa UF disponible para hoy.")

    # ----- Saldos por empresa (mismo patrón que /dashboard/ceo-consolidated) -
    # Asumimos que todos los saldos almacenados son en CLP (situación actual:
    # no hay cuentas en USD/UF cargadas). Cuando se carguen, agregar columna
    # `currency` a `core.movimientos` y este código la lee per-row.
    empresa_rows: list = []
    try:
        empresa_rows = list(
            (
                await db.execute(
                    text("""
                        WITH ult AS (
                            SELECT DISTINCT ON (empresa_codigo, banco)
                                empresa_codigo, banco,
                                COALESCE(saldo_contable, 0) AS saldo_contable
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND saldo_contable IS NOT NULL
                            ORDER BY empresa_codigo, banco,
                                     fecha DESC, movimiento_id DESC
                        ),
                        agg AS (
                            SELECT empresa_codigo,
                                   SUM(saldo_contable) AS saldo
                            FROM ult
                            GROUP BY empresa_codigo
                        )
                        SELECT
                            e.codigo,
                            e.razon_social,
                            COALESCE(a.saldo, 0) AS saldo
                        FROM core.empresas e
                        LEFT JOIN agg a ON a.empresa_codigo = e.codigo
                        WHERE e.activo = true
                        ORDER BY e.codigo
                    """)
                )
            ).fetchall()
        )
    except Exception as exc:
        log.exception("portfolio.empresas_query_failed: %s", exc)
        warnings.append(f"Error consultando saldos por empresa: {exc}")

    # Saldos para cálculo de % (en CLP).
    saldos_clp: list[tuple[str, Decimal]] = [
        (r[0], Decimal(r[2] or 0)) for r in empresa_rows
    ]
    pct_map = compute_percentages(saldos_clp)

    empresas: list[EmpresaPortfolioRow] = []
    for r in empresa_rows:
        codigo = r[0]
        razon = r[1]
        saldo_clp = Decimal(r[2] or 0)
        # Today: todas las cuentas viven en CLP (currency_native='CLP').
        # Cuando agreguen cuentas en USD/UF, este es el lugar para detectar.
        currency_native = "CLP"
        saldo_native = saldo_clp

        if usd_rate is not None and usd_rate > 0:
            saldo_usd: Decimal | None = (saldo_clp / usd_rate).quantize(
                Decimal("0.01")
            )
        else:
            saldo_usd = None

        empresas.append(
            EmpresaPortfolioRow(
                empresa_codigo=codigo,
                razon_social=razon,
                saldo_native=saldo_native,
                currency_native=currency_native,
                saldo_clp=saldo_clp,
                saldo_usd=saldo_usd,
                percent_of_portfolio=pct_map.get(codigo, ZERO),
            )
        )

    total_clp: Decimal = ZERO
    for e in empresas:
        total_clp = total_clp + e.saldo_clp
    total_usd: Decimal | None
    if usd_rate is not None and usd_rate > 0:
        total_usd = (total_clp / usd_rate).quantize(Decimal("0.01"))
    else:
        total_usd = None
    total_uf: Decimal | None
    if uf_rate is not None and uf_rate > 0:
        total_uf = (total_clp / uf_rate).quantize(Decimal("0.0001"))
    else:
        total_uf = None

    # ----- Currency breakdown (donut) ----------------------------------
    breakdown = compute_currency_breakdown(empresas)

    # ----- Monthly trend (12 meses) ------------------------------------
    monthly_trend: list[MonthlyPoint] = []
    try:
        # Para cada mes, tomamos el último saldo conocido al cierre del mes.
        # Query: sum sobre DISTINCT ON (empresa, banco) con fecha <= fin_mes.
        for year, month in months_back(today, 12):
            fin_mes = last_day_of_month(year, month)
            row = (
                await db.execute(
                    text("""
                        WITH ult AS (
                            SELECT DISTINCT ON (empresa_codigo, banco)
                                empresa_codigo, banco,
                                COALESCE(saldo_contable, 0) AS saldo
                            FROM core.movimientos
                            WHERE real_proyectado = 'Real'
                              AND saldo_contable IS NOT NULL
                              AND fecha <= :fin_mes
                            ORDER BY empresa_codigo, banco,
                                     fecha DESC, movimiento_id DESC
                        )
                        SELECT COALESCE(SUM(saldo), 0) AS total
                        FROM ult
                    """),
                    {"fin_mes": fin_mes},
                )
            ).fetchone()
            mes_clp = Decimal(row[0] or 0) if row else ZERO

            # Best-effort USD para ese mes: usa la tasa cacheada del último
            # día del mes. Si no hay, devuelve None (la UI cae a CLP).
            mes_usd: Decimal | None = None
            try:
                rate = await svc.get_usd_rate(fin_mes)
                if rate is not None and rate > 0:
                    mes_usd = (mes_clp / rate).quantize(Decimal("0.01"))
            except Exception as exc:
                log.warning(
                    "portfolio.monthly_usd_rate_failed mes=%s-%s: %s",
                    year,
                    month,
                    exc,
                )

            monthly_trend.append(
                MonthlyPoint(
                    periodo=periodo_label(year, month),
                    fecha_inicio=date(year, month, 1),
                    total_clp=mes_clp,
                    total_usd=mes_usd,
                )
            )
    except Exception as exc:
        log.exception("portfolio.monthly_trend_failed: %s", exc)
        warnings.append(f"Error construyendo trend mensual: {exc}")

    return PortfolioConsolidated(
        generated_at=datetime.now(tz=UTC),
        total_clp=total_clp,
        total_usd=total_usd,
        total_uf=total_uf,
        empresas=empresas,
        currency_breakdown=breakdown,
        monthly_trend=monthly_trend,
        rates_used=RatesUsed(
            uf_clp=uf_rate,
            usd_clp=usd_rate,
            date=today,
        ),
        warnings=warnings,
    )
