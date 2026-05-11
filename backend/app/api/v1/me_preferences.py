"""Endpoints de preferencias per-user (V4 fase 4 — onboarding tour).

2 endpoints bajo el prefix `/me/preferences`:
  - GET  /me/preferences/{key}  → 200 {key, value} | 404 si no existe
  - PUT  /me/preferences/{key}  → 200 {key, value} (upsert via ON CONFLICT)

Auth: cualquier usuario autenticado. Privacy: cada usuario ve y muta SOLO
sus propias filas — el filtro `WHERE user_id = :uid` lo enforza al SQL.

Diseñado como key-value genérico — el primer consumer es `onboarding_tour`,
pero futuras features pueden reutilizar la misma tabla sin agregar nuevas.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.schemas.user_preference import UserPreferenceRead, UserPreferenceUpdate

router = APIRouter()


# Validación defensiva del key: ASCII corto sin separadores raros para evitar
# que un cliente mal intencionado intente inyectar via path params.
_MAX_KEY_LEN = 64


def _validate_key(key: str) -> None:
    if not key or len(key) > _MAX_KEY_LEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"key debe tener entre 1 y {_MAX_KEY_LEN} caracteres",
        )
    # Permitimos [a-zA-Z0-9_-.]; rechazamos espacios y separadores de path.
    for ch in key:
        if not (ch.isalnum() or ch in "_-."):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="key solo acepta [a-zA-Z0-9_-.]",
            )


@router.get("/preferences/{key}", response_model=UserPreferenceRead)
async def get_preference(
    user: CurrentUser, db: DBSession, key: str
) -> UserPreferenceRead:
    """Devuelve la preferencia del usuario logueado para esta key.

    404 si no existe (no devolvemos `{}` ni `null` — el frontend usa el 404
    como señal explícita de "primera vez" para disparar el onboarding tour).
    """
    _validate_key(key)
    row = (
        await db.execute(
            text(
                "SELECT value FROM app.user_preferences "
                "WHERE user_id = :uid AND key = :key"
            ),
            {"uid": user.sub, "key": key},
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Preferencia '{key}' no existe para este usuario",
        )

    return UserPreferenceRead(key=key, value=row["value"])


@router.put("/preferences/{key}", response_model=UserPreferenceRead)
async def upsert_preference(
    user: CurrentUser,
    db: DBSession,
    key: str,
    payload: UserPreferenceUpdate,
) -> UserPreferenceRead:
    """Upsert: crea o actualiza la preferencia para esta key + user.

    Idempotente: llamar con el mismo body múltiples veces no cambia el
    estado más allá de `updated_at`.
    """
    _validate_key(key)

    # SQLAlchemy + asyncpg pasa dicts como JSONB nativos, pero queremos ser
    # explícitos y serializar nosotros para soportar también valores escalares
    # (str / int / bool) — los pasamos como literales JSON via `::jsonb` cast.
    value_json = json.dumps(payload.value)

    await db.execute(
        text(
            """
            INSERT INTO app.user_preferences (user_id, key, value)
            VALUES (:uid, :key, CAST(:value AS jsonb))
            ON CONFLICT (user_id, key) DO UPDATE
                SET value = EXCLUDED.value,
                    updated_at = now()
            """
        ),
        {"uid": user.sub, "key": key, "value": value_json},
    )
    await db.commit()

    return UserPreferenceRead(key=key, value=payload.value)


# ============================================================================
# Sidebar state composite — V5++ perf
# ============================================================================
#
# Antes: el sidebar disparaba 4-6 queries paralelas en cada page load:
#   - useUnreadCount      → /inbox/unread-count
#   - useCriticalObligationsCount → /calendar/obligations
#   - useCriticalEntregablesCount → /entregables
#   - useMailboxPendingCount      → /admin/mailbox/status
#   - useCatalogoEmpresas         → /catalogos/empresas
#   - useMe                        → /auth/me
# Total: 6 round-trips × ~300ms = 1.8s de cascade en cada navegación.
#
# Después: una sola query agregada en SQL paralelo (asyncio.gather).
# ~250ms total. Frontend usa este endpoint via useSidebarState() y omite
# las 5 queries individuales. SSE sigue invalidando para granularidad.


from pydantic import BaseModel  # noqa: E402

import asyncio  # noqa: E402

from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402


class SidebarStateResponse(BaseModel):
    unread_notifications: int
    critical_obligations: int
    critical_entregables: int
    mailbox_pending: int


async def _count_unread_notifications(db: AsyncSession, user_id: str) -> int:
    try:
        return int(
            await db.scalar(
                text(
                    "SELECT COUNT(*) FROM app.notifications "
                    "WHERE user_id = CAST(:uid AS UUID) AND read_at IS NULL"
                ),
                {"uid": user_id},
            )
            or 0
        )
    except Exception:
        return 0


async def _count_critical_obligations(db: AsyncSession) -> int:
    try:
        return int(
            await db.scalar(
                text(
                    """
                    SELECT (
                        (SELECT COUNT(*) FROM core.f29_obligaciones
                         WHERE estado = 'pendiente' AND fecha_vencimiento <= current_date)
                      + (SELECT COUNT(*) FROM core.f22_obligaciones
                         WHERE estado = 'pendiente' AND fecha_vencimiento <= current_date)
                    )
                    """
                )
            )
            or 0
        )
    except Exception:
        return 0


async def _count_critical_entregables(db: AsyncSession) -> int:
    try:
        return int(
            await db.scalar(
                text(
                    """
                    SELECT COUNT(*) FROM core.entregables
                    WHERE estado IN ('pendiente', 'en_proceso')
                      AND fecha_entrega <= current_date + INTERVAL '5 days'
                    """
                )
            )
            or 0
        )
    except Exception:
        return 0


async def _count_mailbox_pending(db: AsyncSession) -> int:
    try:
        return int(
            await db.scalar(
                text(
                    """
                    SELECT COUNT(*) FROM core.inbox_messages
                    WHERE status IN ('received', 'classified')
                    """
                )
            )
            or 0
        )
    except Exception:
        return 0


@router.get(
    "/sidebar-state",
    response_model=SidebarStateResponse,
)
async def get_sidebar_state(
    user: CurrentUser,
    db: DBSession,
) -> SidebarStateResponse:
    """Estado agregado del sidebar en una sola request.

    Usa asyncio.gather para correr las 4 counts en paralelo dentro de la
    misma transacción. Latencia: ~max(c1, c2, c3, c4) en lugar de
    sum(c1+c2+c3+c4) que serían los 4 endpoints separados.

    Soft-fail per-count: si una tabla no existe (entornos antiguos),
    el helper devuelve 0 sin romper el endpoint.
    """
    user_id = str(user.sub)
    unread, obligations, entregables, mailbox = await asyncio.gather(
        _count_unread_notifications(db, user_id),
        _count_critical_obligations(db),
        _count_critical_entregables(db),
        _count_mailbox_pending(db),
    )
    return SidebarStateResponse(
        unread_notifications=unread,
        critical_obligations=obligations,
        critical_entregables=entregables,
        mailbox_pending=mailbox,
    )


# =====================================================================
# V5++ ola AI — GET /me/empresas
# =====================================================================


@router.get("/empresas")
async def list_my_empresas(
    user: CurrentUser,
    db: DBSession,
) -> dict:
    """V5++ ola AI: empresas a las que el current user tiene acceso.

    Útil para el frontend:
      - Pre-seleccionar empresa default al crear voucher (si tiene solo 1)
      - Limitar selector de empresa al universo permitido
      - Mostrar "Mis Empresas" widget en dashboard

    Devuelve [{ codigo, razon_social, roles: [...] }, ...] o todas si admin.
    """
    if user.is_admin:
        # Admin global → devuelve TODAS las empresas activas con rol 'admin'
        rows = (await db.execute(
            text(
                """
                SELECT codigo, razon_social, rut, activo
                FROM core.empresas
                WHERE activo = TRUE
                ORDER BY codigo
                """
            )
        )).mappings().all()
        return {
            "is_admin": True,
            "empresas": [
                {**dict(r), "roles": ["admin"]} for r in rows
            ],
        }

    # User scoped → solo empresas en core.user_company_roles
    rows = (await db.execute(
        text(
            """
            SELECT
                e.codigo,
                e.razon_social,
                e.rut,
                e.activo,
                ARRAY_AGG(ucr.role ORDER BY ucr.role) as roles
            FROM core.empresas e
            JOIN core.user_company_roles ucr
                ON ucr.empresa_codigo = e.codigo AND ucr.active = TRUE
            WHERE ucr.user_id = :uid AND e.activo = TRUE
            GROUP BY e.codigo, e.razon_social, e.rut, e.activo
            ORDER BY e.codigo
            """
        ),
        {"uid": str(user.sub)},
    )).mappings().all()

    return {
        "is_admin": False,
        "empresas": [dict(r) for r in rows],
    }

