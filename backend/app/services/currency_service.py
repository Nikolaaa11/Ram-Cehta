"""CurrencyService — V4 fase 1 (Currency conversion UF/CLP/USD).

Convierte montos entre CLP, UF y USD usando tasas históricas. Las tasas
se cachean en `core.currency_rates` y se hidratan desde APIs públicas:

* **BCN/CMF Chile** (oficial): `api.cmfchile.cl/api-sbifv3` — requiere
  `BCN_API_KEY`. Endpoint preferido cuando hay key.
* **mindicador.cl** (fallback gratis): `mindicador.cl/api/{indicador}/{date}`
  con formato `dd-MM-YYYY`.

Soft-fail end-to-end: si ambas APIs fallan, `get_uf_rate` devuelve None
y se loggea warning. La UI debe renderear el monto original sin conversión
(no error). Cuando una tasa SI se obtiene, se persiste con
`ON CONFLICT DO NOTHING` para idempotencia bajo concurrencia.

Conversión:
  * CLP↔CLP, UF↔UF, USD↔USD = identidad.
  * X→CLP = amount * rate_clp(X)
  * CLP→X = amount / rate_clp(X)
  * UF↔USD = via CLP (compose: UF→CLP→USD)
"""
from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.models.currency_rate import CurrencyRate
from app.schemas.currency import CurrencyRateRead

log = get_logger(__name__)

# Códigos soportados — mantener match con `app.schemas.currency.CurrencyCode`.
SUPPORTED_CURRENCIES: frozenset[str] = frozenset({"CLP", "UF", "USD"})

# Mapeo de currency_code → indicador en mindicador.cl (fallback gratis).
_MINDICADOR_KEY: dict[str, str] = {
    "UF": "uf",
    "USD": "dolar",
}

# Mapeo de currency_code → recurso en api.cmfchile.cl (BCN oficial).
# La API oficial usa `uf` y `dolar` también, pero es paywall+key.
_BCN_RESOURCE: dict[str, str] = {
    "UF": "uf",
    "USD": "dolar",
}


class CurrencyService:
    def __init__(self, db: AsyncSession, *, http_client: httpx.AsyncClient | None = None) -> None:
        """Permite inyectar un AsyncClient stub en tests para evitar HTTP real.

        En producción, `http_client=None` → cada fetch crea su propio
        client efímero (acceptable para una API que se llama 1x/día).
        """
        self._db = db
        self._http_client = http_client

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_uf_rate(self, date: date_type | None = None) -> Decimal | None:
        """Tasa UF→CLP para `date` (default hoy). Cache-first."""
        return await self._get_rate("UF", date or date_type.today())

    async def get_usd_rate(self, date: date_type | None = None) -> Decimal | None:
        """Tasa USD→CLP para `date` (default hoy). Cache-first."""
        return await self._get_rate("USD", date or date_type.today())

    async def convert(
        self,
        amount: Decimal,
        from_currency: str,
        to_currency: str,
        date: date_type | None = None,
    ) -> Decimal | None:
        """Convierte `amount` de `from_currency` a `to_currency`.

        Devuelve None si alguna tasa requerida no está disponible
        (soft-fail). Identidad (X→X) devuelve `amount` sin tocar.
        """
        from_currency = from_currency.upper()
        to_currency = to_currency.upper()
        if (
            from_currency not in SUPPORTED_CURRENCIES
            or to_currency not in SUPPORTED_CURRENCIES
        ):
            log.warning(
                "convert: currency no soportada (%s → %s)",
                from_currency,
                to_currency,
            )
            return None

        if from_currency == to_currency:
            return amount

        target_date = date or date_type.today()

        # Cualquier conversión la hacemos pasando por CLP como pivote.
        # CLP → CLP fue manejado arriba como identidad.
        if from_currency == "CLP":
            rate = await self._get_rate(to_currency, target_date)
            if rate is None or rate == 0:
                return None
            try:
                return amount / rate
            except (InvalidOperation, ZeroDivisionError):
                return None

        if to_currency == "CLP":
            rate = await self._get_rate(from_currency, target_date)
            if rate is None:
                return None
            return amount * rate

        # X → Y vía CLP (X→CLP, luego CLP→Y).
        rate_from = await self._get_rate(from_currency, target_date)
        rate_to = await self._get_rate(to_currency, target_date)
        if rate_from is None or rate_to is None or rate_to == 0:
            return None
        try:
            in_clp = amount * rate_from
            return in_clp / rate_to
        except (InvalidOperation, ZeroDivisionError):
            return None

    async def bulk_get_rates(
        self,
        start_date: date_type,
        end_date: date_type,
        *,
        currency: str | None = None,
    ) -> list[CurrencyRateRead]:
        """Lista las tasas cacheadas en el rango `[start_date, end_date]`.

        No fetchea APIs externas — solo lee cache. Pensado para charts
        históricos donde basta con lo que ya tenemos. Si `currency` viene
        None, devuelve UF + USD; si viene seteado, filtra por ese código.
        """
        if start_date > end_date:
            return []

        stmt = select(CurrencyRate).where(
            CurrencyRate.date >= start_date,
            CurrencyRate.date <= end_date,
        )
        if currency:
            stmt = stmt.where(CurrencyRate.currency_code == currency.upper())
        stmt = stmt.order_by(CurrencyRate.currency_code, CurrencyRate.date.desc())

        rows = (await self._db.execute(stmt)).scalars().all()
        return [CurrencyRateRead.model_validate(r) for r in rows]

    async def refresh_today(self) -> dict[str, Any]:
        """Refresh manual: fuerza fetch desde APIs externas para HOY.

        Útil para admin "force refresh" cuando el cron no corrió o
        hubo un blip de red. Idempotente: si ya existe la fila para hoy
        con misma fuente, no la duplica.
        """
        today = date_type.today()
        refreshed = 0
        skipped = 0
        errors: list[str] = []
        rates: list[CurrencyRateRead] = []

        for code in ("UF", "USD"):
            try:
                rate = await self._fetch_external(code, today)
                if rate is None:
                    errors.append(f"{code}: ambas APIs fallaron")
                    continue
                value, source = rate
                stored = await self._upsert_rate(code, today, value, source=source)
                if stored is not None:
                    rates.append(CurrencyRateRead.model_validate(stored))
                    refreshed += 1
                else:
                    skipped += 1
            except Exception as exc:
                log.warning("refresh_today fallo para %s: %s", code, exc)
                errors.append(f"{code}: {exc}")

        return {
            "refreshed": refreshed,
            "skipped": skipped,
            "errors": errors,
            "rates": rates,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_rate(
        self, currency_code: str, target_date: date_type
    ) -> Decimal | None:
        """Cache-first lookup. Si no hay cache, fetch + cache + return."""
        currency_code = currency_code.upper()
        if currency_code == "CLP":
            return Decimal("1")
        if currency_code not in SUPPORTED_CURRENCIES:
            return None

        # Soft-fail si la fecha es absurda (futuro lejano, etc.)
        if not _is_reasonable_date(target_date):
            log.warning("Fecha fuera de rango razonable: %s", target_date)
            return None

        # 1) Cache.
        cached = await self._read_cache(currency_code, target_date)
        if cached is not None:
            return cached

        # 2) Fetch externo.
        result = await self._fetch_external(currency_code, target_date)
        if result is None:
            return None
        value, source = result

        # 3) Persist (best-effort; si falla, devolvemos el value igual).
        try:
            await self._upsert_rate(
                currency_code, target_date, value, source=source
            )
        except Exception as exc:
            log.warning(
                "No se pudo cachear tasa %s/%s: %s",
                currency_code,
                target_date,
                exc,
            )
        return value

    async def _read_cache(
        self, currency_code: str, target_date: date_type
    ) -> Decimal | None:
        stmt = (
            select(CurrencyRate.rate_clp)
            .where(
                CurrencyRate.currency_code == currency_code,
                CurrencyRate.date == target_date,
            )
            .limit(1)
        )
        return await self._db.scalar(stmt)

    async def _upsert_rate(
        self,
        currency_code: str,
        target_date: date_type,
        rate_clp: Decimal,
        *,
        source: str = "bcn",
    ) -> CurrencyRate | None:
        """INSERT ... ON CONFLICT DO NOTHING. Devuelve la fila final
        (la nueva si insertó, o la existente si ya estaba)."""
        await self._db.execute(
            text(
                """
                INSERT INTO core.currency_rates
                    (currency_code, date, rate_clp, source)
                VALUES
                    (:code, :date, :rate, :source)
                ON CONFLICT (currency_code, date) DO NOTHING
                """
            ),
            {
                "code": currency_code,
                "date": target_date,
                "rate": rate_clp,
                "source": source,
            },
        )
        await self._db.commit()
        # Re-read para obtener la fila (puede ser la nuestra o una previa).
        stmt = select(CurrencyRate).where(
            CurrencyRate.currency_code == currency_code,
            CurrencyRate.date == target_date,
        )
        return await self._db.scalar(stmt)

    async def _fetch_external(
        self, currency_code: str, target_date: date_type
    ) -> tuple[Decimal, str] | None:
        """Tries BCN first (if api_key set), then mindicador. Returns
        (value, source) or None if both fail."""
        # 1) BCN/CMF si tenemos API key
        if settings.bcn_api_key:
            try:
                value = await self._fetch_bcn(currency_code, target_date)
                if value is not None:
                    return (value, "bcn")
            except Exception as exc:
                log.warning(
                    "BCN fetch fallo para %s/%s: %s",
                    currency_code,
                    target_date,
                    exc,
                )

        # 2) Fallback gratis: mindicador.cl
        try:
            value = await self._fetch_mindicador(currency_code, target_date)
            if value is not None:
                return (value, "mindicador")
        except Exception as exc:
            log.warning(
                "mindicador fetch fallo para %s/%s: %s",
                currency_code,
                target_date,
                exc,
            )

        return None

    async def _fetch_bcn(
        self, currency_code: str, target_date: date_type
    ) -> Decimal | None:
        resource = _BCN_RESOURCE.get(currency_code)
        if not resource:
            return None
        url = (
            f"https://api.cmfchile.cl/api-sbifv3/recursos_api/{resource}/"
            f"{target_date.year}/{target_date.month}/dias/{target_date.day}"
            f"?apikey={settings.bcn_api_key}&formato=json"
        )
        async with self._client() as client:
            resp = await client.get(url, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
        # CMF responde con {"UFs": [{"Valor": "39.500,00", "Fecha": "..."}]}
        # o {"Dolares": [...]}. Buscamos la primera key array.
        return _extract_bcn_value(data)

    async def _fetch_mindicador(
        self, currency_code: str, target_date: date_type
    ) -> Decimal | None:
        key = _MINDICADOR_KEY.get(currency_code)
        if not key:
            return None
        # mindicador formato: dd-MM-YYYY
        formatted = target_date.strftime("%d-%m-%Y")
        url = f"https://mindicador.cl/api/{key}/{formatted}"
        async with self._client() as client:
            resp = await client.get(url, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
        # mindicador responde con {"serie": [{"fecha": "...", "valor": 39500.0}]}
        return _extract_mindicador_value(data)

    def _client(self) -> httpx.AsyncClient:
        """Si nos inyectaron un client en tests, lo reusamos (no se cierra
        en `__aexit__`). Si no, creamos uno efímero."""
        if self._http_client is not None:
            return _NoCloseClient(self._http_client)
        return httpx.AsyncClient()


# =====================================================================
# Helpers libres (testeables sin DB)
# =====================================================================


def _is_reasonable_date(d: date_type) -> bool:
    """Filtro defensivo: ni 1900, ni 2100. La UF existe desde 1967 y
    APIs externas no devuelven nada anterior a ~2010."""
    today = date_type.today()
    earliest = date_type(2000, 1, 1)
    # Permitimos hasta 7 días en el futuro (fines de semana, feriados).
    latest = date_type(today.year + 1, today.month, today.day) if False else today
    # Pequeño margen futuro para timezone slop:
    from datetime import timedelta

    latest = today + timedelta(days=7)
    return earliest <= d <= latest


def _extract_bcn_value(data: dict[str, Any]) -> Decimal | None:
    """CMF format: {"UFs": [{"Valor": "39.500,12", "Fecha": "2026-04-29"}]}
    o {"Dolares": [...]}. La key cambia con el indicador."""
    if not isinstance(data, dict):
        return None
    for v in data.values():
        if isinstance(v, list) and v:
            entry = v[0]
            if isinstance(entry, dict) and "Valor" in entry:
                raw = str(entry["Valor"])
                # Chile: "39.500,12" → "39500.12"
                normalized = raw.replace(".", "").replace(",", ".")
                try:
                    return Decimal(normalized)
                except (InvalidOperation, ValueError):
                    return None
    return None


def _extract_mindicador_value(data: dict[str, Any]) -> Decimal | None:
    """mindicador.cl format: {"serie": [{"fecha":"...", "valor": 39500.0}]}"""
    if not isinstance(data, dict):
        return None
    serie = data.get("serie")
    if not isinstance(serie, list) or not serie:
        return None
    entry = serie[0]
    if not isinstance(entry, dict):
        return None
    valor = entry.get("valor")
    if valor is None:
        return None
    try:
        return Decimal(str(valor))
    except (InvalidOperation, ValueError):
        return None


class _NoCloseClient:
    """Wrapper que evita cerrar un AsyncClient inyectado por tests cuando
    se usa como `async with`. El test es dueño del lifecycle del client."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def __aenter__(self) -> httpx.AsyncClient:
        return self._client

    async def __aexit__(self, *exc_info: object) -> None:
        return None


# Convenience date utility — re-exposed for tests/router que necesitan la
# fecha "today" pero quieren freezable via monkeypatch en service module.
def today() -> date_type:
    return datetime.now().date()
