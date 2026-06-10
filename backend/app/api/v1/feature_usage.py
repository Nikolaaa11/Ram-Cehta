"""R152PPPPP · Endpoint de análisis de uso de features.

GET /api/v1/admin/feature-usage — devuelve ranking de endpoints por uso.
Solo admins.

Uso esperado: 1 vez por semana revisar qué endpoints están en el bottom.
Si hay endpoints con 0 hits en 30 días, son candidatos a:
    1. Eliminar el código
    2. Apagar con feature flag
    3. Investigar por qué nadie lo usa (¿está roto? ¿no descubierto?)

Devuelve:
{
  "top_20": [
    {"path": "/api/v1/vouchers", "hits": 1234, "unique_users": 8, ...},
    ...
  ],
  "bottom_20": [
    {"path": "/api/v1/secretaria-ai/...", "hits": 0, ...},  ← candidato apagar
    ...
  ],
  "buffer_stats": {"buffer_size": 12, ...},
  "window": "30 days"
}
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.usage_tracking_middleware import get_buffer_stats

router = APIRouter(prefix="/admin", tags=["admin-feature-usage"])


@router.get("/feature-usage", summary="Ranking de uso por endpoint (admin)")
async def feature_usage(
    user: CurrentUser,
    db: DBSession,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict:
    # R152RRRRR — Patrón Annotated estándar del codebase.
    """Top 20 + Bottom 20 endpoints por hits en últimos N días.

    Args:
        days: ventana de análisis (1-365). Default 30.
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo admins pueden ver métricas de uso de features.",
        )

    # R152RRRRR — Construir SQL como string puro y envolverlo en text()
    # una sola vez por query. NO usar str(text(...)) — el comportamiento
    # de TextClause.__str__ no está garantizado a devolver el SQL crudo
    # y puede romper en futuras versiones de SQLAlchemy.
    base_select = """
        SELECT path,
               COUNT(*) AS hits,
               COUNT(DISTINCT user_id) AS unique_users,
               AVG(duration_ms)::INT AS avg_duration_ms,
               MAX(duration_ms) AS max_duration_ms,
               SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS errors_5xx,
               SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) AS errors_4xx
        FROM core.feature_usage
        WHERE created_at > NOW() - (:days || ' days')::INTERVAL
        GROUP BY path
    """

    # Top — los más usados.
    top = (
        await db.execute(
            text(base_select + " ORDER BY hits DESC LIMIT 20"),
            {"days": days},
        )
    ).fetchall()

    # Bottom — los menos usados (candidatos a apagar).
    bottom = (
        await db.execute(
            text(base_select + " ORDER BY hits ASC LIMIT 20"),
            {"days": days},
        )
    ).fetchall()

    # Total general — para contexto.
    totals = (
        await db.execute(
            text(
                """SELECT COUNT(*) AS total_requests,
                          COUNT(DISTINCT path) AS unique_endpoints,
                          COUNT(DISTINCT user_id) AS unique_users
                   FROM core.feature_usage
                   WHERE created_at > NOW() - (:days || ' days')::INTERVAL"""
            ),
            {"days": days},
        )
    ).first()

    def _serialize(row) -> dict:
        return {
            "path": row[0],
            "hits": row[1],
            "unique_users": row[2],
            "avg_duration_ms": row[3],
            "max_duration_ms": row[4],
            "errors_5xx": row[5],
            "errors_4xx": row[6],
        }

    return {
        "window_days": days,
        "totals": {
            "total_requests": totals[0] if totals else 0,
            "unique_endpoints": totals[1] if totals else 0,
            "unique_users": totals[2] if totals else 0,
        },
        "top_20_most_used": [_serialize(r) for r in top],
        "bottom_20_least_used": [_serialize(r) for r in bottom],
        "buffer_stats": get_buffer_stats(),
        "note": (
            "Endpoints en bottom_20 con hits=0 son candidatos a eliminar. "
            "Endpoints con muchos errors_5xx requieren investigación urgente. "
            "Endpoints con avg_duration_ms > 1000 son lentos."
        ),
    }
