"""R152NNNNN · Cache de catálogos semi-estáticos.

Estos catálogos cambian < 1 vez por día pero se consultan cientos de veces:
    - plan_cuentas (212 filas, 82 seq_scans, 14k row reads)
    - proveedores (233 filas, 85 seq_scans, 13k row reads)
    - empresas (10 filas, prácticamente nunca cambian)
    - proyectos_contables (61 filas, 232 seq_scans — flujo de caja)

Estrategia:
    - TTL = 300s (5 minutos). Si un usuario crea un proveedor nuevo,
      tarda hasta 5 min en aparecer en los autocompletes de OTROS
      usuarios. Aceptable — y se puede forzar con invalidate(table).
    - Lazy load: la primera request paga el costo, las siguientes son ~0ms.
    - Footprint estimado: ~250KB total para los 4 catálogos. Despreciable.

Anti-patrón evitado:
    NO uso functools.lru_cache porque:
      a) No expira por tiempo (solo por size).
      b) No respeta async (la query es async).
      c) No tiene métricas ni invalidación selectiva.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)

_CATALOG_TTL_SECONDS = 300

# R152RRRRR — Max entries para evitar crecimiento sin límite si alguien
# pasa empresa_codigo dinámico/inválido y se cachean N entries muertas.
# Con 10 empresas × 4 catálogos × variaciones ~= 50 max esperado.
# Si superamos 200, hay un bug llamando con keys inválidas — vaciamos.
_CACHE_MAX_ENTRIES = 200

# (entry_key) → (expires_at, value)
_cache: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _get_lock(key: str) -> asyncio.Lock:
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    return lock


async def _get_or_load(
    key: str,
    loader: Callable[[], Awaitable[Any]],
    ttl_seconds: int = _CATALOG_TTL_SECONDS,
) -> Any:
    """Patrón cache-aside con doble-check + lock para evitar dogpile."""
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]

    lock = _get_lock(key)
    async with lock:
        cached = _cache.get(key)
        if cached is not None and cached[0] > now:
            return cached[1]

        t0 = time.monotonic()
        value = await loader()
        elapsed_ms = int((time.monotonic() - t0) * 1000)

        # R152RRRRR — Defensa contra crecimiento sin límite. Si el cache
        # superó el max esperado, es que estamos llamando con keys
        # inválidas (típicamente empresa_codigo dinámico desde input
        # del usuario). Vaciamos y loggeamos para investigar.
        if len(_cache) >= _CACHE_MAX_ENTRIES:
            log.warning(
                "catalog_cache.eviction",
                size=len(_cache),
                max=_CACHE_MAX_ENTRIES,
            )
            _cache.clear()
            _locks.clear()

        _cache[key] = (now + ttl_seconds, value)
        if elapsed_ms > 200:
            log.info("catalog_cache.slow_load", key=key, elapsed_ms=elapsed_ms)
        return value


# ---------- Loaders específicos ----------


async def get_plan_cuentas(db: AsyncSession, empresa_codigo: str) -> list[dict]:
    """Plan de cuentas por empresa. Cacheado 5 min."""

    async def _load() -> list[dict]:
        rows = (
            await db.execute(
                text(
                    """SELECT codigo, descripcion, tipo, nivel, padre_codigo, imputable
                       FROM core.plan_cuentas
                       WHERE empresa_codigo = :e
                       ORDER BY codigo"""
                ),
                {"e": empresa_codigo},
            )
        ).fetchall()
        return [
            {
                "codigo": r[0],
                "descripcion": r[1],
                "tipo": r[2],
                "nivel": r[3],
                "padre_codigo": r[4],
                "imputable": bool(r[5]),
            }
            for r in rows
        ]

    return await _get_or_load(f"plan_cuentas:{empresa_codigo}", _load)


async def get_proveedores(db: AsyncSession) -> list[dict]:
    """Proveedores globales (sin filtro empresa). Cacheado 5 min."""

    async def _load() -> list[dict]:
        rows = (
            await db.execute(
                text(
                    """SELECT id, rut, razon_social, email
                       FROM core.proveedores
                       ORDER BY razon_social"""
                )
            )
        ).fetchall()
        return [
            {
                "id": str(r[0]),
                "rut": r[1],
                "razon_social": r[2],
                "email": r[3],
            }
            for r in rows
        ]

    return await _get_or_load("proveedores:all", _load)


async def get_proyectos(db: AsyncSession, empresa_codigo: str) -> list[dict]:
    """Proyectos contables por empresa. Cacheado 5 min."""

    async def _load() -> list[dict]:
        rows = (
            await db.execute(
                text(
                    """SELECT id, codigo, nombre, estado, tipo
                       FROM core.proyectos_contables
                       WHERE empresa_codigo = :e
                       ORDER BY codigo"""
                ),
                {"e": empresa_codigo},
            )
        ).fetchall()
        return [
            {
                "id": str(r[0]),
                "codigo": r[1],
                "nombre": r[2],
                "estado": r[3],
                "tipo": r[4],
            }
            for r in rows
        ]

    return await _get_or_load(f"proyectos:{empresa_codigo}", _load)


# ---------- Invalidación ----------


def invalidate(prefix: str) -> None:
    """Invalida todas las entries cuya key empiece con prefix.

    Ejemplos:
        invalidate("plan_cuentas:")     → invalida plan_cuentas de TODAS empresas
        invalidate("plan_cuentas:RHO")  → solo RHO
        invalidate("proveedores:")      → invalida la única entry de proveedores
    """
    keys_to_remove = [k for k in _cache if k.startswith(prefix)]
    for k in keys_to_remove:
        _cache.pop(k, None)


def invalidate_all() -> None:
    """Vacía el cache entero. Solo para tests o /admin/cache-flush."""
    _cache.clear()


def get_cache_stats() -> dict[str, int]:
    """Para /admin/perf-stats."""
    return {"entries": len(_cache)}
