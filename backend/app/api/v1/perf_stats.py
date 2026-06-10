"""R152NNNNN · Endpoint de observabilidad de performance.

GET /api/v1/admin/perf-stats — devuelve métricas live de caches in-memory
y connection pool. Solo accesible para admins.

Útil para:
    - Verificar hit-rate del cache de catálogos tras un deploy.
    - Detectar dogpile (muchos misses en poco tiempo).
    - Ver si el pool de DB está saturado bajo carga.

Ejemplo respuesta:
{
  "catalog_cache": {"entries": 11},
  "empresa_scope_cache": {"size": 23, "fresh": 23, "stale": 0, ...},
  "db_pool": {
    "size": 3, "checked_in": 2, "checked_out": 1, "overflow": 0
  }
}
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser
from app.core.catalog_cache import get_cache_stats as catalog_stats
from app.core.database import engine
from app.services.empresa_scope_service import get_cache_stats as scope_stats

router = APIRouter(prefix="/admin", tags=["admin"])


def _pool_stats() -> dict[str, int | str]:
    """Stats del connection pool de SQLAlchemy.

    NullPool no tiene métricas — devuelve 'mode': 'nullpool'. QueuePool
    expone size(), checkedin(), checkedout(), overflow().
    """
    pool = engine.pool
    pool_class = pool.__class__.__name__
    if pool_class == "NullPool":
        return {"mode": "nullpool", "note": "No pool — each request opens a fresh connection"}
    try:
        return {
            "mode": pool_class,
            "size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception as exc:  # noqa: BLE001
        return {"mode": pool_class, "error": str(exc)}


@router.get("/perf-stats", summary="Métricas de caches + DB pool (admin)")
async def perf_stats(user: CurrentUser) -> dict:
    # R152RRRRR — Patrón Annotated estándar del codebase. NO usar
    # `user: AuthenticatedUser = Depends(CurrentUser)` porque CurrentUser
    # ya es un Annotated[AuthenticatedUser, Depends(current_user)].
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admins pueden ver métricas de performance.",
        )

    return {
        "catalog_cache": catalog_stats(),
        "empresa_scope_cache": scope_stats(),
        "db_pool": _pool_stats(),
    }
