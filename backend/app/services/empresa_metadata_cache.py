"""V5++ ola AF — Cache de metadata de empresas.

La tabla `core.empresas` se consulta MUCHAS veces por request:
  - assert_empresa_access valida que la empresa esté activa
  - create_voucher verifica empresa+activa
  - reportes contables joinan razon_social

Con 6 empresas, hits son sub-ms incluso sin cache. Pero la query implica
ida-y-vuelta a Postgres. Cacheando in-process eliminamos 100% del overhead.

TTL: 5 minutos. Si una empresa se desactiva, el cambio se ve en <5min.
Para cambios urgentes (raro), llamar `invalidate_empresa_cache()`.

Estructura cacheada:
    {
        "EVOQUE": {
            "codigo": "EVOQUE",
            "razon_social": "Evoque SpA",
            "rut": "76.111.222-3",
            "activo": True,
        },
        ...
    }
"""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)


_CACHE: dict[str, dict[str, Any]] | None = None
_CACHE_LOADED_AT: float = 0.0
_CACHE_TTL = 300.0  # 5 min


async def _load_all(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """Carga todas las empresas a memoria."""
    rows = (await db.execute(
        text(
            """
            SELECT codigo, razon_social, rut, activo, direccion
            FROM core.empresas
            """
        )
    )).mappings().all()
    return {r["codigo"]: dict(r) for r in rows}


async def get_empresa_metadata(
    db: AsyncSession, codigo: str
) -> dict[str, Any] | None:
    """Devuelve metadata de una empresa por código. None si no existe."""
    global _CACHE, _CACHE_LOADED_AT
    now = time.time()

    if _CACHE is None or (now - _CACHE_LOADED_AT) > _CACHE_TTL:
        try:
            _CACHE = await _load_all(db)
            _CACHE_LOADED_AT = now
        except Exception as exc:  # noqa: BLE001
            log.warning("empresa_cache_load_failed", error=str(exc))
            return None

    return _CACHE.get(codigo)


async def is_empresa_active(db: AsyncSession, codigo: str) -> bool:
    """Helper: True si la empresa existe y está activa."""
    meta = await get_empresa_metadata(db, codigo)
    return bool(meta and meta.get("activo"))


async def get_all_active_codes(db: AsyncSession) -> list[str]:
    """Devuelve códigos de todas las empresas activas (cached)."""
    global _CACHE, _CACHE_LOADED_AT
    now = time.time()

    if _CACHE is None or (now - _CACHE_LOADED_AT) > _CACHE_TTL:
        _CACHE = await _load_all(db)
        _CACHE_LOADED_AT = now

    return [
        codigo for codigo, meta in _CACHE.items() if meta.get("activo")
    ]


def invalidate_empresa_cache() -> None:
    """Borra la cache. Llamar después de cambiar empresa activo flag o
    crear una empresa nueva. Las próximas 5 lecturas refrescan desde DB."""
    global _CACHE, _CACHE_LOADED_AT
    _CACHE = None
    _CACHE_LOADED_AT = 0.0
