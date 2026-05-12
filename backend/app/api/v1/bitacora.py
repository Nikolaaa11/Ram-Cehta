"""V5++ ola AO — Bitácora: vista unificada de actividad por usuario.

Combina los 2 audit trails que ya existen:
    1. audit.http_mutations (Ola AE) — TODO POST/PATCH/PUT/DELETE
    2. audit.action_log (Ola V3 fase 8) — diffs entity-level (vouchers, OCs, etc)

Y los expone en endpoints más amigables para UI tipo timeline:
    GET /bitacora/user/{email}        — toda la actividad de un usuario
    GET /bitacora/empresa/{codigo}    — toda la actividad sobre una empresa
    GET /bitacora/timeline            — feed cronológico unificado
    GET /bitacora/summary             — stats globales

La UI /admin/bitacora consume estos endpoints. Solo admins ven todo;
los users ven solo SU propia actividad (sin email param = self).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser

router = APIRouter()


@router.get("/timeline")
async def bitacora_timeline(
    user: CurrentUser,
    db: DBSession,
    user_email: str | None = Query(default=None),
    since_hours: int = Query(default=72, ge=1, le=720),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    """V5++ ola AO: timeline cronológico unificado.

    Combina action_log (entity diffs) + http_mutations (cada request HTTP).
    Si el user no es admin, solo ve su propia actividad.

    Cada item del timeline tiene:
        timestamp, source ('action'|'http'), user_email, action,
        entity_type, entity_id, summary, status_code (si http)
    """
    # Filtro user: si no es admin, fuerza self
    if not user.is_admin:
        user_email = user.email

    params = {"hours": str(since_hours), "limit": limit}

    where_action = "WHERE created_at > now() - (:hours || ' hours')::INTERVAL"
    where_http = "WHERE timestamp > now() - (:hours || ' hours')::INTERVAL"

    if user_email:
        where_action += " AND user_email = :email"
        where_http += " AND user_email = :email"
        params["email"] = user_email

    # action_log entries
    actions = (await db.execute(
        text(
            f"""
            SELECT
                'action' as source,
                created_at as timestamp,
                user_email,
                action,
                entity_type,
                entity_id,
                entity_label,
                summary,
                NULL::INTEGER as status_code,
                NULL::TEXT as path,
                NULL::INTEGER as latency_ms
            FROM audit.action_log
            {where_action}
            ORDER BY created_at DESC
            LIMIT :limit
            """  # noqa: S608
        ),
        params,
    )).mappings().all()

    # http_mutations entries (excluyendo paths internos ruidosos)
    https = (await db.execute(
        text(
            f"""
            SELECT
                'http' as source,
                timestamp,
                user_email,
                method as action,
                NULL::TEXT as entity_type,
                NULL::TEXT as entity_id,
                NULL::TEXT as entity_label,
                CONCAT(method, ' ', path, ' → ', status_code) as summary,
                status_code,
                path,
                latency_ms
            FROM audit.http_mutations
            {where_http}
              AND path NOT LIKE '/api/v1/events/%'
              AND path NOT LIKE '/api/v1/auth/refresh%'
            ORDER BY timestamp DESC
            LIMIT :limit
            """  # noqa: S608
        ),
        params,
    )).mappings().all()

    # Merge y ordenar por timestamp DESC
    combined = list(actions) + list(https)
    combined.sort(key=lambda r: r["timestamp"], reverse=True)
    combined = combined[:limit]

    return {
        "user_email_filter": user_email,
        "window_hours": since_hours,
        "total": len(combined),
        "items": [dict(r) for r in combined],
    }


@router.get("/user/{email}")
async def bitacora_per_user(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    email: str,
    since_days: int = Query(default=30, ge=1, le=180),
) -> dict:
    """V5++ ola AO: estadísticas + timeline de un usuario específico.

    Solo admins (audit:read). Devuelve:
        - Total acciones en N días
        - Breakdown por tipo de acción
        - Empresas tocadas (cantidad distinct)
        - Top entity_types editados
        - Últimas 50 acciones detalladas
    """
    params = {"email": email, "days": str(since_days)}

    # Stats agregados
    counters = (await db.execute(
        text(
            """
            SELECT
                COUNT(*) FILTER (WHERE TRUE) as total_actions,
                COUNT(*) FILTER (WHERE action = 'create') as creates,
                COUNT(*) FILTER (WHERE action = 'update') as updates,
                COUNT(*) FILTER (WHERE action = 'delete') as deletes,
                COUNT(DISTINCT entity_type) as distinct_entity_types,
                MIN(created_at) as first_action,
                MAX(created_at) as last_action
            FROM audit.action_log
            WHERE user_email = :email
              AND created_at > now() - (:days || ' days')::INTERVAL
            """
        ),
        params,
    )).mappings().first()

    # Breakdown por entity_type
    by_entity = (await db.execute(
        text(
            """
            SELECT entity_type, COUNT(*) as n
            FROM audit.action_log
            WHERE user_email = :email
              AND created_at > now() - (:days || ' days')::INTERVAL
            GROUP BY entity_type
            ORDER BY n DESC
            """
        ),
        params,
    )).mappings().all()

    # HTTP stats
    http_stats = (await db.execute(
        text(
            """
            SELECT
                COUNT(*) as http_requests,
                COUNT(*) FILTER (WHERE status_code >= 400) as errors,
                COUNT(*) FILTER (WHERE latency_ms > 1000) as slow_requests,
                ROUND(AVG(latency_ms)) as avg_latency_ms
            FROM audit.http_mutations
            WHERE user_email = :email
              AND timestamp > now() - (:days || ' days')::INTERVAL
            """
        ),
        params,
    )).mappings().first()

    # Últimas 50 acciones
    recent = (await db.execute(
        text(
            """
            SELECT
                created_at, action, entity_type, entity_id,
                entity_label, summary
            FROM audit.action_log
            WHERE user_email = :email
              AND created_at > now() - (:days || ' days')::INTERVAL
            ORDER BY created_at DESC
            LIMIT 50
            """
        ),
        params,
    )).mappings().all()

    return {
        "user_email": email,
        "window_days": since_days,
        "counters": dict(counters) if counters else {},
        "http_stats": dict(http_stats) if http_stats else {},
        "by_entity_type": [dict(r) for r in by_entity],
        "recent_actions": [dict(r) for r in recent],
    }


@router.get("/empresa/{codigo}")
async def bitacora_per_empresa(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    codigo: str,
    since_days: int = Query(default=30, ge=1, le=180),
) -> dict:
    """V5++ ola AO + CB: actividad sobre una empresa específica con scope check.

    Útil para revisión por empresa: "¿qué se hizo en EVOQUE este mes?"
    Busca en entity_label o en el diff JSONB un match con la empresa.
    """
    # V5++ ola CB: scope check (además del audit:read rol-based)
    from app.services.empresa_scope_service import assert_empresa_access
    await assert_empresa_access(user, db, codigo)
    params = {"codigo": codigo, "days": str(since_days)}

    # action_log filtrando por menciones de la empresa
    # (es una heurística: matchear codigo en entity_label, summary, o JSONB)
    actions = (await db.execute(
        text(
            """
            SELECT
                created_at, user_email, action, entity_type, entity_id,
                entity_label, summary
            FROM audit.action_log
            WHERE created_at > now() - (:days || ' days')::INTERVAL
              AND (
                entity_label ILIKE :pat OR
                summary ILIKE :pat OR
                diff_before::TEXT ILIKE :pat OR
                diff_after::TEXT ILIKE :pat
              )
            ORDER BY created_at DESC
            LIMIT 200
            """
        ),
        {**params, "pat": f"%{codigo}%"},
    )).mappings().all()

    # Stats por user que tocó esta empresa
    by_user = (await db.execute(
        text(
            """
            SELECT user_email, COUNT(*) as n
            FROM audit.action_log
            WHERE created_at > now() - (:days || ' days')::INTERVAL
              AND user_email IS NOT NULL
              AND (
                entity_label ILIKE :pat OR
                summary ILIKE :pat OR
                diff_before::TEXT ILIKE :pat OR
                diff_after::TEXT ILIKE :pat
              )
            GROUP BY user_email
            ORDER BY n DESC
            """
        ),
        {**params, "pat": f"%{codigo}%"},
    )).mappings().all()

    return {
        "empresa_codigo": codigo,
        "window_days": since_days,
        "total_actions": len(actions),
        "by_user": [dict(r) for r in by_user],
        "actions": [dict(r) for r in actions],
    }


@router.get("/summary")
async def bitacora_summary(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    since_days: int = Query(default=7, ge=1, le=90),
) -> dict:
    """Vista 360° de la actividad del sistema en los últimos N días."""
    params = {"days": str(since_days)}

    # Top users por volumen
    top_users = (await db.execute(
        text(
            """
            SELECT user_email, COUNT(*) as actions
            FROM audit.action_log
            WHERE created_at > now() - (:days || ' days')::INTERVAL
              AND user_email IS NOT NULL
            GROUP BY user_email
            ORDER BY actions DESC
            LIMIT 15
            """
        ),
        params,
    )).mappings().all()

    # Top entity types
    top_entities = (await db.execute(
        text(
            """
            SELECT entity_type, COUNT(*) as n
            FROM audit.action_log
            WHERE created_at > now() - (:days || ' days')::INTERVAL
            GROUP BY entity_type
            ORDER BY n DESC
            LIMIT 10
            """
        ),
        params,
    )).mappings().all()

    # Actividad por día (timeline para gráfico)
    daily = (await db.execute(
        text(
            """
            SELECT
                DATE(created_at) as dia,
                COUNT(*) as actions
            FROM audit.action_log
            WHERE created_at > now() - (:days || ' days')::INTERVAL
            GROUP BY DATE(created_at)
            ORDER BY dia DESC
            """
        ),
        params,
    )).mappings().all()

    # Totales
    totals = (await db.execute(
        text(
            """
            SELECT
                (SELECT COUNT(*) FROM audit.action_log
                 WHERE created_at > now() - (:days || ' days')::INTERVAL) as actions_total,
                (SELECT COUNT(*) FROM audit.http_mutations
                 WHERE timestamp > now() - (:days || ' days')::INTERVAL) as http_total,
                (SELECT COUNT(DISTINCT user_email) FROM audit.action_log
                 WHERE created_at > now() - (:days || ' days')::INTERVAL
                   AND user_email IS NOT NULL) as users_active
            """
        ),
        params,
    )).mappings().first()

    return {
        "window_days": since_days,
        "totals": dict(totals) if totals else {},
        "top_users": [dict(r) for r in top_users],
        "top_entities": [dict(r) for r in top_entities],
        "daily_breakdown": [dict(r) for r in daily],
    }
