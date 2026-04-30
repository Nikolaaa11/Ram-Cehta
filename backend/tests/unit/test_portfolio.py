"""Tests para Portfolio Consolidado USD (V4 fase 4).

Cubre:
- `compute_percentages`: porcentajes suman 100% modulo rounding,
  edge case total=0, single empresa, distribución multi-empresa.
- `compute_currency_breakdown`: agrupa por currency_native, suma 100%,
  ordenado descendente.
- `last_day_of_month`: 28-31, edge cases (febrero leap, diciembre).
- `months_back`: orden cronológico, 12 elementos, cruza de año.
- `periodo_label`: formato MM_YY.
- Test de integración (endpoint via FakeDB con saldos pre-cargados):
  totales = suma de empresas, breakdown sums to total_clp,
  monthly_trend tiene 12 puntos, soft-fail cuando no hay rates.

Mockeamos DB y CurrencyService — no se hace HTTP real ni se toca PG.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from app.api.v1.portfolio import (
    compute_currency_breakdown,
    compute_percentages,
    last_day_of_month,
    months_back,
    periodo_label,
)
from app.schemas.portfolio import (
    EmpresaPortfolioRow,
)

# =====================================================================
# Tests: compute_percentages
# =====================================================================


class TestComputePercentages:
    def test_empty(self) -> None:
        assert compute_percentages([]) == {}

    def test_total_zero_returns_zeros(self) -> None:
        result = compute_percentages([("A", Decimal("0")), ("B", Decimal("0"))])
        assert result == {"A": Decimal("0"), "B": Decimal("0")}

    def test_single_empresa_is_100pct(self) -> None:
        result = compute_percentages([("A", Decimal("1000000"))])
        assert result["A"] == Decimal("100.00")

    def test_two_equal_empresas(self) -> None:
        result = compute_percentages(
            [("A", Decimal("500")), ("B", Decimal("500"))]
        )
        assert result["A"] == Decimal("50.00")
        assert result["B"] == Decimal("50.00")

    def test_porcentajes_suman_100_modulo_rounding(self) -> None:
        # 9 empresas con saldos arbitrarios — los % suman ~100%.
        saldos = [
            ("EMP1", Decimal("123456")),
            ("EMP2", Decimal("78901")),
            ("EMP3", Decimal("450000")),
            ("EMP4", Decimal("12000")),
            ("EMP5", Decimal("999999")),
            ("EMP6", Decimal("345")),
            ("EMP7", Decimal("888")),
            ("EMP8", Decimal("1234567")),
            ("EMP9", Decimal("65432")),
        ]
        result = compute_percentages(saldos)
        total_pct = sum(result.values(), Decimal("0"))
        # Tolerancia por quantize a 0.01 sobre 9 buckets.
        assert abs(total_pct - Decimal("100")) < Decimal("0.10")

    def test_negative_saldo_handled(self) -> None:
        # Saldo negativo (sobregiro) — % puede ser negativo, no rompe.
        result = compute_percentages(
            [("A", Decimal("-100")), ("B", Decimal("200"))]
        )
        # Total = 100, A = -100%, B = 200%
        assert result["A"] == Decimal("-100.00")
        assert result["B"] == Decimal("200.00")


# =====================================================================
# Tests: compute_currency_breakdown
# =====================================================================


def _make_row(
    codigo: str, saldo_clp: Decimal, currency: str = "CLP"
) -> EmpresaPortfolioRow:
    return EmpresaPortfolioRow(
        empresa_codigo=codigo,
        razon_social=f"Empresa {codigo}",
        saldo_native=saldo_clp,
        currency_native=currency,
        saldo_clp=saldo_clp,
        saldo_usd=None,
        percent_of_portfolio=Decimal("0"),
    )


class TestCurrencyBreakdown:
    def test_empty(self) -> None:
        assert compute_currency_breakdown([]) == []

    def test_all_clp(self) -> None:
        rows = [
            _make_row("A", Decimal("1000")),
            _make_row("B", Decimal("3000")),
        ]
        out = compute_currency_breakdown(rows)
        assert len(out) == 1
        assert out[0].currency == "CLP"
        assert out[0].total_clp == Decimal("4000")
        assert out[0].percent == Decimal("100.00")

    def test_mixed_currencies_sum_total_and_100pct(self) -> None:
        rows = [
            _make_row("A", Decimal("4000"), "CLP"),
            _make_row("B", Decimal("3000"), "USD"),
            _make_row("C", Decimal("3000"), "UF"),
        ]
        out = compute_currency_breakdown(rows)
        # 3 buckets distintos.
        assert len(out) == 3
        # Suma total_clp = 10000.
        suma = sum((it.total_clp for it in out), Decimal("0"))
        assert suma == Decimal("10000")
        # Suma % = 100%.
        suma_pct = sum((it.percent for it in out), Decimal("0"))
        assert abs(suma_pct - Decimal("100")) < Decimal("0.05")

    def test_orden_descendente(self) -> None:
        rows = [
            _make_row("A", Decimal("100"), "USD"),
            _make_row("B", Decimal("9000"), "CLP"),
            _make_row("C", Decimal("500"), "UF"),
        ]
        out = compute_currency_breakdown(rows)
        # Order descendente por total_clp.
        assert [it.currency for it in out] == ["CLP", "UF", "USD"]


# =====================================================================
# Tests: last_day_of_month / months_back / periodo_label
# =====================================================================


class TestDateHelpers:
    def test_last_day_january(self) -> None:
        assert last_day_of_month(2026, 1) == date(2026, 1, 31)

    def test_last_day_february_non_leap(self) -> None:
        assert last_day_of_month(2026, 2) == date(2026, 2, 28)

    def test_last_day_february_leap(self) -> None:
        assert last_day_of_month(2024, 2) == date(2024, 2, 29)

    def test_last_day_december(self) -> None:
        assert last_day_of_month(2026, 12) == date(2026, 12, 31)

    def test_last_day_april(self) -> None:
        # 30 días.
        assert last_day_of_month(2026, 4) == date(2026, 4, 30)

    def test_months_back_count(self) -> None:
        out = months_back(date(2026, 4, 29), 12)
        assert len(out) == 12

    def test_months_back_chronological(self) -> None:
        out = months_back(date(2026, 4, 29), 12)
        # Último elemento es el mes actual.
        assert out[-1] == (2026, 4)
        # Primer elemento es 11 meses atrás.
        assert out[0] == (2025, 5)

    def test_months_back_cross_year(self) -> None:
        out = months_back(date(2026, 2, 15), 6)
        assert len(out) == 6
        # Debería incluir 2025 también.
        years = {y for y, _ in out}
        assert 2025 in years
        assert 2026 in years

    def test_periodo_label_padding(self) -> None:
        assert periodo_label(2026, 1) == "01_26"
        assert periodo_label(2026, 12) == "12_26"
        assert periodo_label(2025, 7) == "07_25"


# =====================================================================
# Tests: integración con FakeDB + CurrencyService mockeado
# =====================================================================


class FakeFetchOne:
    def __init__(self, value: Any) -> None:
        self._value = value

    def __getitem__(self, idx: int) -> Any:
        if isinstance(self._value, list | tuple):
            return self._value[idx]
        return self._value


class FakeExecuteResult:
    """Emula `await db.execute(...)` con `.fetchall()` y `.fetchone()`."""

    def __init__(self, rows: list[tuple] | tuple | None = None) -> None:
        if rows is None:
            self._rows: list[tuple] = []
            self._single: tuple | None = None
        elif isinstance(rows, list):
            self._rows = rows
            self._single = rows[0] if rows else None
        else:
            self._rows = [rows]
            self._single = rows

    def fetchall(self) -> list[tuple]:
        return self._rows

    def fetchone(self) -> tuple | None:
        return self._single


class FakePortfolioDB:
    """Mock de AsyncSession para el endpoint /portfolio/consolidated.

    Diferencia los queries por el contenido del SQL (text("...")):
    - Si menciona "FROM core.empresas" + "LEFT JOIN agg" → empresa_rows.
    - Si menciona "fecha <= :fin_mes" → monthly trend (fila singleton).
    - Si menciona "FROM core.currency_rates" → cache de tasas.
    """

    def __init__(
        self,
        empresa_rows: list[tuple],
        monthly_total_clp: Decimal,
        rates_cache: dict[tuple[str, str], Decimal] | None = None,
    ) -> None:
        self.empresa_rows = empresa_rows
        self.monthly_total_clp = monthly_total_clp
        self.rates_cache = rates_cache or {}

    async def execute(
        self, stmt: Any, params: dict[str, Any] | None = None
    ) -> FakeExecuteResult:
        sql = str(stmt)
        if "fecha <= :fin_mes" in sql:
            # Monthly trend query.
            return FakeExecuteResult([(self.monthly_total_clp,)])
        if "core.empresas" in sql and "LEFT JOIN agg" in sql:
            return FakeExecuteResult(self.empresa_rows)
        # INSERT ON CONFLICT (currency cache write) — no-op.
        return FakeExecuteResult([])

    async def scalar(
        self, stmt: Any, params: dict[str, Any] | None = None
    ) -> Any:
        # Reads cache de currency rates. Buscamos por params del bind.
        bind_params = stmt.compile().params if hasattr(stmt, "compile") else {}
        code = bind_params.get("currency_code_1")
        d = bind_params.get("date_1")
        if code is None or d is None:
            return None
        key = (code, d.isoformat() if hasattr(d, "isoformat") else d)
        return self.rates_cache.get(key)

    async def commit(self) -> None:
        pass


class TestPortfolioEndpoint:
    @pytest.mark.asyncio
    async def test_total_clp_equals_sum_of_empresas(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        empresa_rows = [
            ("EMP1", "Empresa Uno", Decimal("100000000")),
            ("EMP2", "Empresa Dos", Decimal("250000000")),
            ("EMP3", "Empresa Tres", Decimal("50000000")),
        ]
        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=empresa_rows,
            monthly_total_clp=Decimal("400000000"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        # Currency service necesita las tasas — las inyectamos directo en cache.
        # Pre-poblamos la cache para todas las fechas que el monthly trend va a tocar.
        for y, m in months_back(today, 12):
            fin_mes = last_day_of_month(y, m)
            db.rates_cache[("USD", fin_mes.isoformat())] = Decimal("950")

        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        # Total CLP debe igualar la suma de empresas.
        suma_empresas = sum(
            (e.saldo_clp for e in result.empresas), Decimal("0")
        )
        assert result.total_clp == suma_empresas
        assert result.total_clp == Decimal("400000000")

    @pytest.mark.asyncio
    async def test_percent_sums_to_100(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        empresa_rows = [
            ("A", "A", Decimal("1000")),
            ("B", "B", Decimal("2000")),
            ("C", "C", Decimal("3000")),
            ("D", "D", Decimal("4000")),
        ]
        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=empresa_rows,
            monthly_total_clp=Decimal("10000"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        suma_pct = sum(
            (e.percent_of_portfolio for e in result.empresas), Decimal("0")
        )
        # Tolerancia por quantize a 0.01.
        assert abs(suma_pct - Decimal("100")) < Decimal("0.05")

    @pytest.mark.asyncio
    async def test_currency_breakdown_sums_to_total_clp(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        empresa_rows = [
            ("A", "A", Decimal("100")),
            ("B", "B", Decimal("200")),
        ]
        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=empresa_rows,
            monthly_total_clp=Decimal("300"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        suma_breakdown = sum(
            (it.total_clp for it in result.currency_breakdown), Decimal("0")
        )
        assert suma_breakdown == result.total_clp

    @pytest.mark.asyncio
    async def test_monthly_trend_has_12_points(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=[("A", "A", Decimal("100"))],
            monthly_total_clp=Decimal("100"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        assert len(result.monthly_trend) == 12

    @pytest.mark.asyncio
    async def test_soft_fail_no_usd_rate_returns_null_total_usd(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Si CurrencyService no tiene rate para hoy y APIs externas fallan,
        total_usd viene None y se incluye un warning."""
        from app.api.v1.portfolio import portfolio_consolidated

        # Patch CurrencyService para que no haga HTTP fetch.
        from app.services import currency_service as cs_module

        async def fake_fetch(self, code, target_date):  # type: ignore[no-untyped-def]
            return None

        monkeypatch.setattr(cs_module.CurrencyService, "_fetch_external", fake_fetch)

        empresa_rows = [("A", "A", Decimal("1000"))]
        # Cache vacío — no hay tasas.
        db = FakePortfolioDB(
            empresa_rows=empresa_rows,
            monthly_total_clp=Decimal("1000"),
            rates_cache={},
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        assert result.total_usd is None
        assert result.total_uf is None
        # Warning generado.
        assert any("USD" in w for w in result.warnings)
        # Pero el saldo en CLP funciona.
        assert result.total_clp == Decimal("1000")

    @pytest.mark.asyncio
    async def test_empresa_saldo_usd_calculated_when_rate_available(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        empresa_rows = [("A", "Empresa A", Decimal("950000"))]
        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=empresa_rows,
            monthly_total_clp=Decimal("950000"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        # 950000 / 950 = 1000.00 USD
        assert result.empresas[0].saldo_usd == Decimal("1000.00")

    @pytest.mark.asyncio
    async def test_rates_used_populated(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=[("A", "A", Decimal("1000"))],
            monthly_total_clp=Decimal("1000"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        assert result.rates_used.usd_clp == Decimal("950")
        assert result.rates_used.uf_clp == Decimal("39500")
        assert result.rates_used.date == today

    @pytest.mark.asyncio
    async def test_generated_at_recent(self) -> None:
        from app.api.v1.portfolio import portfolio_consolidated

        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=[("A", "A", Decimal("1"))],
            monthly_total_clp=Decimal("1"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        before = datetime.now(tz=UTC).timestamp()
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]
        after = datetime.now(tz=UTC).timestamp()

        # generated_at debe estar en la ventana del request.
        gen_ts = result.generated_at.timestamp()
        # Tolerancia 5 seg.
        assert before - 5 <= gen_ts <= after + 5

    @pytest.mark.asyncio
    async def test_empty_portfolio_does_not_crash(self) -> None:
        """Sin empresas activas, la respuesta es coherente: 0 totales,
        breakdown vacío, monthly_trend con 12 ceros."""
        from app.api.v1.portfolio import portfolio_consolidated

        today = date.today()
        db = FakePortfolioDB(
            empresa_rows=[],
            monthly_total_clp=Decimal("0"),
            rates_cache={
                ("USD", today.isoformat()): Decimal("950"),
                ("UF", today.isoformat()): Decimal("39500"),
            },
        )
        result = await portfolio_consolidated(user=None, db=db)  # type: ignore[arg-type]

        assert result.total_clp == Decimal("0")
        assert result.empresas == []
        assert result.currency_breakdown == []
        assert len(result.monthly_trend) == 12
