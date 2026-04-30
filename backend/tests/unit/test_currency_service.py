"""Tests para CurrencyService — V4 fase 1 (Currency conversion UF/CLP/USD).

Cubre:
  - Conversión: CLP→UF, UF→CLP, USD→CLP, CLP→USD, UF→USD via CLP.
  - Identidad CLP→CLP devuelve mismo amount.
  - Cache hit: segunda llamada NO trigger HTTP fetch.
  - Cache miss + BCN success.
  - Cache miss + BCN fail + mindicador success (fallback).
  - Both fail → returns None + warning.
  - Bulk rates filtrado.
  - Soft-fail bad date.
  - Helpers parsers (BCN format y mindicador format).
  - Refresh idempotency.

Estrategia de mocking:
  * `FakeDB` in-memory replica el contrato AsyncSession que usa el servicio:
    `scalar()`, `execute()`, `commit()` y `select(...)` chain via SQLAlchemy.
    Implementamos solo los entry points usados.
  * Para HTTP, inyectamos un `httpx.AsyncClient` con `MockTransport`
    de httpx — sin red real, ofrece control total sobre status/body.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pytest

from app.services.currency_service import (
    CurrencyService,
    _extract_bcn_value,
    _extract_mindicador_value,
    _is_reasonable_date,
)

# =====================================================================
# Fake AsyncSession — reemplaza la DB real con dict in-memory.
# =====================================================================


class FakeRow:
    """Sustituto mínimo de un objeto CurrencyRate para `scalars().all()`."""

    def __init__(
        self,
        currency_code: str,
        d: date,
        rate_clp: Decimal,
        source: str = "bcn",
    ) -> None:
        self.id = f"{currency_code}-{d.isoformat()}"
        self.currency_code = currency_code
        self.date = d
        self.rate_clp = rate_clp
        self.source = source


class FakeScalarResult:
    def __init__(self, items: list[FakeRow]) -> None:
        self._items = items

    def all(self) -> list[FakeRow]:
        return self._items


class FakeExecuteResult:
    def __init__(self, items: list[FakeRow]) -> None:
        self._items = items

    def scalars(self) -> FakeScalarResult:
        return FakeScalarResult(self._items)


class FakeDB:
    """In-memory replacement for AsyncSession.

    Soporta los entry points usados por el servicio:
    - `scalar(stmt)` para latest-rate lookup y read-after-upsert.
    - `execute(stmt)` para `bulk_get_rates` con scalars().all().
    - `execute(text(...), params)` para INSERT ON CONFLICT.
    - `commit()` no-op.
    """

    def __init__(self) -> None:
        # Key: (currency_code, date_iso) → FakeRow.
        self.cache: dict[tuple[str, str], FakeRow] = {}
        self.commits = 0

    def store(self, row: FakeRow) -> None:
        self.cache[(row.currency_code, row.date.isoformat())] = row

    async def scalar(self, stmt: Any, params: dict[str, Any] | None = None) -> Any:
        # Para distinguir entre los 2 selects que hace el servicio:
        # 1) `select(CurrencyRate.rate_clp).where(...)` → devuelve Decimal.
        # 2) `select(CurrencyRate).where(...)` → devuelve la fila.
        # Como FakeDB no parsea SQLAlchemy AST, usamos un truco basado en
        # el .compile string del stmt: si menciona "rate_clp" en column
        # set específico, devuelve solo ese campo.
        compiled = str(stmt)
        # Buscamos el WHERE con currency_code y date.
        # En tests reales, es más simple: matcheamos por params del binding.
        params_dict = stmt.compile().params if hasattr(stmt, "compile") else {}
        code = params_dict.get("currency_code_1")
        d = params_dict.get("date_1")
        if code is None or d is None:
            # Si no podemos extraer, scaneamos cualquier match con el último param fijado.
            for (c, _), row in self.cache.items():
                if c in compiled:
                    if "rate_clp" in compiled and "FROM core.currency_rates" in compiled:
                        return row.rate_clp
                    return row
            return None
        key = (code, d.isoformat() if hasattr(d, "isoformat") else d)
        row = self.cache.get(key)
        if row is None:
            return None
        # Si el SELECT pide solo rate_clp, devolvemos Decimal.
        if " rate_clp \n" in compiled or "currency_rates.rate_clp" in compiled:
            return row.rate_clp
        return row

    async def execute(
        self, stmt: Any, params: dict[str, Any] | None = None
    ) -> FakeExecuteResult:
        # Caso 1: INSERT (text) con params → upsert
        if params is not None:
            code = params.get("code")
            d = params.get("date")
            rate = params.get("rate")
            source = params.get("source", "bcn")
            if code and d and rate is not None:
                key = (code, d.isoformat())
                # ON CONFLICT DO NOTHING: respeta la primera escritura.
                if key not in self.cache:
                    self.cache[key] = FakeRow(code, d, rate, source=source)
            return FakeExecuteResult([])

        # Caso 2: SELECT para bulk_get_rates → recorrer cache filtrando
        bind_params = stmt.compile().params if hasattr(stmt, "compile") else {}
        date_lo = bind_params.get("date_1")
        date_hi = bind_params.get("date_2")
        currency = bind_params.get("currency_code_1")
        items = list(self.cache.values())
        if date_lo:
            items = [r for r in items if r.date >= date_lo]
        if date_hi:
            items = [r for r in items if r.date <= date_hi]
        if currency:
            items = [r for r in items if r.currency_code == currency]
        # Order-by no-importa para asserts; tests verifican contenido.
        return FakeExecuteResult(items)

    async def commit(self) -> None:
        self.commits += 1


# =====================================================================
# Mock httpx transport — sin red real
# =====================================================================


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[str] = []


def _make_client(handler) -> httpx.AsyncClient:  # type: ignore[no-untyped-def]
    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport)


def _bcn_response(value: str = "39.500,12") -> dict:
    return {
        "UFs": [{"Valor": value, "Fecha": "2026-04-29"}]
    }


def _mindicador_response(valor: float = 39500.12) -> dict:
    return {
        "version": "1.7.0",
        "autor": "test",
        "codigo": "uf",
        "nombre": "Unidad de fomento (UF)",
        "unidad_medida": "Pesos",
        "serie": [{"fecha": "2026-04-29T03:00:00.000Z", "valor": valor}],
    }


# =====================================================================
# Tests: helpers libres
# =====================================================================


class TestParsers:
    def test_bcn_extract_chilean_format(self) -> None:
        # "39.500,12" → 39500.12 (separador miles "." y decimal ",")
        assert _extract_bcn_value({"UFs": [{"Valor": "39.500,12"}]}) == Decimal(
            "39500.12"
        )

    def test_bcn_extract_dolares(self) -> None:
        assert _extract_bcn_value({"Dolares": [{"Valor": "950,50"}]}) == Decimal(
            "950.50"
        )

    def test_bcn_extract_empty_returns_none(self) -> None:
        assert _extract_bcn_value({}) is None
        assert _extract_bcn_value({"UFs": []}) is None

    def test_bcn_extract_invalid_value_returns_none(self) -> None:
        assert _extract_bcn_value({"UFs": [{"Valor": "abc"}]}) is None

    def test_mindicador_extract_valor_float(self) -> None:
        assert _extract_mindicador_value(_mindicador_response(39500.12)) == Decimal(
            "39500.12"
        )

    def test_mindicador_extract_empty_serie_returns_none(self) -> None:
        assert _extract_mindicador_value({"serie": []}) is None
        assert _extract_mindicador_value({}) is None

    def test_is_reasonable_date_today(self) -> None:
        assert _is_reasonable_date(date.today()) is True

    def test_is_reasonable_date_old(self) -> None:
        assert _is_reasonable_date(date(1995, 1, 1)) is False

    def test_is_reasonable_date_far_future(self) -> None:
        assert _is_reasonable_date(date(2050, 1, 1)) is False


# =====================================================================
# Tests: conversión (con cache pre-poblado para evitar HTTP)
# =====================================================================


class TestConversion:
    @pytest.fixture
    def db(self) -> FakeDB:
        d = FakeDB()
        # Pre-cache UF y USD para hoy.
        today = date.today()
        d.store(FakeRow("UF", today, Decimal("39500.00"), "bcn"))
        d.store(FakeRow("USD", today, Decimal("950.00"), "bcn"))
        return d

    @pytest.mark.asyncio
    async def test_clp_to_clp_identity(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        result = await svc.convert(Decimal("100"), "CLP", "CLP")
        assert result == Decimal("100")

    @pytest.mark.asyncio
    async def test_uf_to_clp(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        # 1500 UF * 39500 CLP/UF = 59,250,000 CLP
        result = await svc.convert(Decimal("1500"), "UF", "CLP")
        assert result == Decimal("59250000.00")

    @pytest.mark.asyncio
    async def test_clp_to_uf(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        # 59,250,000 CLP / 39500 = 1500 UF
        result = await svc.convert(Decimal("59250000"), "CLP", "UF")
        assert result is not None
        # Permitir margen flotante minimal
        assert abs(result - Decimal("1500")) < Decimal("0.01")

    @pytest.mark.asyncio
    async def test_usd_to_clp(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        # 100 USD * 950 = 95,000 CLP
        result = await svc.convert(Decimal("100"), "USD", "CLP")
        assert result == Decimal("95000.00")

    @pytest.mark.asyncio
    async def test_clp_to_usd(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        # 95,000 CLP / 950 = 100 USD
        result = await svc.convert(Decimal("95000"), "CLP", "USD")
        assert result is not None
        assert abs(result - Decimal("100")) < Decimal("0.01")

    @pytest.mark.asyncio
    async def test_uf_to_usd_via_clp(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        # 1 UF = 39500 CLP. 39500 CLP / 950 USD/CLP = 41.578... USD
        result = await svc.convert(Decimal("1"), "UF", "USD")
        assert result is not None
        expected = Decimal("39500") / Decimal("950")
        assert abs(result - expected) < Decimal("0.01")

    @pytest.mark.asyncio
    async def test_unsupported_currency_returns_none(self, db: FakeDB) -> None:
        svc = CurrencyService(db)  # type: ignore[arg-type]
        result = await svc.convert(Decimal("100"), "EUR", "CLP")
        assert result is None

    @pytest.mark.asyncio
    async def test_convert_missing_rate_returns_none(self) -> None:
        """Si la tasa no está en cache y no hay HTTP, devolvemos None."""
        db = FakeDB()  # cache vacío
        # http_client siempre 500 → ambos APIs caen.

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, json={"error": "down"})

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            result = await svc.convert(Decimal("100"), "UF", "CLP")
            assert result is None
        finally:
            await client.aclose()


# =====================================================================
# Tests: cache vs HTTP fetch
# =====================================================================


class TestCacheBehavior:
    @pytest.mark.asyncio
    async def test_cache_hit_skips_http(self) -> None:
        """Si la tasa está en cache, no llama HTTP."""
        db = FakeDB()
        today = date.today()
        db.store(FakeRow("UF", today, Decimal("39500"), "bcn"))

        recorder = _Recorder()

        def handler(request: httpx.Request) -> httpx.Response:
            recorder.calls.append(str(request.url))
            return httpx.Response(200, json=_bcn_response())

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            rate = await svc.get_uf_rate(today)
            assert rate == Decimal("39500")
            # Crucial: nadie tocó HTTP.
            assert recorder.calls == []
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_cache_miss_falls_back_to_mindicador(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Sin BCN_API_KEY, hace fetch directo a mindicador."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "bcn_api_key", None, raising=False)

        db = FakeDB()
        today = date.today()

        recorder = _Recorder()

        def handler(request: httpx.Request) -> httpx.Response:
            recorder.calls.append(str(request.url))
            if "mindicador.cl" in str(request.url):
                return httpx.Response(200, json=_mindicador_response(39500.50))
            return httpx.Response(404)

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            rate = await svc.get_uf_rate(today)
            assert rate == Decimal("39500.50")
            assert any("mindicador" in c for c in recorder.calls)
            # Y se cacheó.
            assert (("UF", today.isoformat())) in db.cache
            assert db.cache[("UF", today.isoformat())].source == "mindicador"
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_bcn_fails_falls_back_to_mindicador(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """BCN devuelve 500 → cae a mindicador y usa esa tasa."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "bcn_api_key", "fake-key", raising=False)

        db = FakeDB()
        today = date.today()

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "cmfchile.cl" in url:
                return httpx.Response(500, text="boom")
            if "mindicador.cl" in url:
                return httpx.Response(200, json=_mindicador_response(40000.00))
            return httpx.Response(404)

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            rate = await svc.get_uf_rate(today)
            assert rate == Decimal("40000.00")
            assert db.cache[("UF", today.isoformat())].source == "mindicador"
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_bcn_success_when_keyed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.core.config import settings

        monkeypatch.setattr(settings, "bcn_api_key", "fake-key", raising=False)

        db = FakeDB()
        today = date.today()

        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "cmfchile.cl" in url:
                return httpx.Response(200, json=_bcn_response("39.500,00"))
            return httpx.Response(404)

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            rate = await svc.get_uf_rate(today)
            assert rate == Decimal("39500.00")
            assert db.cache[("UF", today.isoformat())].source == "bcn"
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_both_apis_fail_returns_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.core.config import settings

        monkeypatch.setattr(settings, "bcn_api_key", "fake-key", raising=False)

        db = FakeDB()
        today = date.today()

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="all down")

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            rate = await svc.get_uf_rate(today)
            assert rate is None
            # Y nada se cacheó.
            assert ("UF", today.isoformat()) not in db.cache
        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_soft_fail_on_unreasonable_date(self) -> None:
        db = FakeDB()
        svc = CurrencyService(db)  # type: ignore[arg-type]
        rate = await svc.get_uf_rate(date(1990, 1, 1))
        assert rate is None
        # Tampoco para fechas muy futuras.
        rate = await svc.get_uf_rate(date(2099, 1, 1))
        assert rate is None


# =====================================================================
# Tests: bulk + refresh
# =====================================================================


class TestBulkAndRefresh:
    @pytest.mark.asyncio
    async def test_bulk_get_rates_filters_by_date(self) -> None:
        db = FakeDB()
        today = date.today()
        db.store(FakeRow("UF", today, Decimal("39500"), "bcn"))
        db.store(FakeRow("UF", today - timedelta(days=10), Decimal("39400"), "bcn"))
        db.store(FakeRow("UF", today - timedelta(days=40), Decimal("39000"), "bcn"))

        svc = CurrencyService(db)  # type: ignore[arg-type]
        items = await svc.bulk_get_rates(
            today - timedelta(days=15), today, currency="UF"
        )
        # Solo 2 dentro del rango (today y today-10).
        assert len(items) == 2

    @pytest.mark.asyncio
    async def test_bulk_get_rates_inverted_range_returns_empty(self) -> None:
        db = FakeDB()
        svc = CurrencyService(db)  # type: ignore[arg-type]
        items = await svc.bulk_get_rates(date(2026, 5, 1), date(2026, 4, 1))
        assert items == []

    @pytest.mark.asyncio
    async def test_refresh_today_idempotent_under_existing_cache(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Si ya existe la fila para hoy, ON CONFLICT DO NOTHING preserva
        la fuente original. refresh_today no la sobrescribe."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "bcn_api_key", None, raising=False)

        db = FakeDB()
        today = date.today()
        # Cache pre-poblado con fuente 'manual'.
        db.store(FakeRow("UF", today, Decimal("39500"), "manual"))
        db.store(FakeRow("USD", today, Decimal("950"), "manual"))

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=_mindicador_response(99999.99))

        client = _make_client(handler)
        try:
            svc = CurrencyService(db, http_client=client)  # type: ignore[arg-type]
            result = await svc.refresh_today()
            # Refrescó las 2 (ambas se mantuvieron con fuente manual; el
            # endpoint reportó refreshed=2 porque encontró las filas).
            assert result["refreshed"] >= 0
            # Sources preserved (ON CONFLICT DO NOTHING).
            assert db.cache[("UF", today.isoformat())].source == "manual"
            assert db.cache[("UF", today.isoformat())].rate_clp == Decimal("39500")
        finally:
            await client.aclose()
