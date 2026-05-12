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

from fastapi import APIRouter, HTTPException, Response, status
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
    # V5++ ola AT — vouchers pending para que cada user vea cuántos esperan
    # su acción (DRAFT propios + PENDING en empresas que aprueba)
    voucher_drafts_mine: int = 0
    voucher_pending_approvals: int = 0


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


async def _count_voucher_drafts_mine(db: AsyncSession, user_id: str) -> int:
    """V5++ ola AT: cuántos vouchers DRAFT creó este user (debe completarlos)."""
    try:
        return int(
            await db.scalar(
                text(
                    """
                    SELECT COUNT(*) FROM core.vouchers
                    WHERE status = 'DRAFT'
                      AND created_by = CAST(:uid AS UUID)
                    """
                ),
                {"uid": user_id},
            )
            or 0
        )
    except Exception:
        return 0


async def _count_voucher_pending_approvals(db: AsyncSession, user_id: str) -> int:
    """V5++ ola AT: vouchers PENDING en empresas donde el user tiene rol
    aprobador (GG o DIRECTOR). Solo cuenta los que el user NO firmó todavía.

    Pseudo-lógica:
        vouchers WHERE status='PENDING'
          AND empresa_codigo IN (empresas donde user tiene GG o DIRECTOR)
          AND voucher_id NOT IN (los que el user ya firmó como GG o DIRECTOR)
    """
    try:
        return int(
            await db.scalar(
                text(
                    """
                    SELECT COUNT(DISTINCT v.voucher_id)
                    FROM core.vouchers v
                    JOIN core.user_company_roles ucr
                        ON ucr.empresa_codigo = v.empresa_codigo
                       AND ucr.user_id = CAST(:uid AS UUID)
                       AND ucr.active = TRUE
                       AND ucr.role IN ('GG', 'DIRECTOR')
                    WHERE v.status = 'PENDING'
                      AND NOT EXISTS (
                          SELECT 1 FROM core.voucher_approvals va
                          WHERE va.voucher_id = v.voucher_id
                            AND va.approver_user_id = CAST(:uid AS UUID)
                            AND va.decision = 'APPROVED'
                      )
                    """
                ),
                {"uid": user_id},
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
    (
        unread,
        obligations,
        entregables,
        mailbox,
        drafts_mine,
        pending_approvals,
    ) = await asyncio.gather(
        _count_unread_notifications(db, user_id),
        _count_critical_obligations(db),
        _count_critical_entregables(db),
        _count_mailbox_pending(db),
        _count_voucher_drafts_mine(db, user_id),
        _count_voucher_pending_approvals(db, user_id),
    )
    return SidebarStateResponse(
        unread_notifications=unread,
        critical_obligations=obligations,
        critical_entregables=entregables,
        mailbox_pending=mailbox,
        voucher_drafts_mine=drafts_mine,
        voucher_pending_approvals=pending_approvals,
    )


# =====================================================================
# V5++ ola AI — GET /me/empresas
# =====================================================================


@router.get("/empresas")
async def list_my_empresas(
    user: CurrentUser,
    db: DBSession,
    response: Response,
) -> dict:
    """V5++ ola AI + CB: empresas a las que el current user tiene acceso.

    Útil para el frontend:
      - Pre-seleccionar empresa default al crear voucher (si tiene solo 1)
      - Limitar selector de empresa al universo permitido
      - Mostrar "Mis Empresas" widget en dashboard
      - Mostrar scope info (admin badge, count, etc.)

    V5++ ola AR: Cache 5min stale-while-revalidate 60s. Los roles cambian
    rara vez, y el scope cache TTL ya es 60s en backend.

    V5++ ola CB: agrega `scope_summary` con info estructurada para UI:
      - total: count de empresas accesibles
      - is_global: alias de is_admin
      - roles_summary: agregación de roles únicos del user
    """
    response.headers["Cache-Control"] = "private, max-age=300, stale-while-revalidate=60"
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
        empresas = [{**dict(r), "roles": ["admin"]} for r in rows]
        return {
            "is_admin": True,
            "empresas": empresas,
            "scope_summary": {
                "total": len(empresas),
                "is_global": True,
                "roles_summary": ["admin"],
                "display_label": (
                    "Admin global · acceso a todas las empresas"
                    if len(empresas) > 0
                    else "Sin empresas activas"
                ),
            },
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
    empresas = [dict(r) for r in rows]

    # Construir summary de roles únicos en todas las empresas
    all_roles: set[str] = set()
    for e in empresas:
        for r in (e.get("roles") or []):
            all_roles.add(r)

    display_label: str
    if len(empresas) == 0:
        display_label = "Sin empresas asignadas — contactá al admin"
    elif len(empresas) == 1:
        display_label = (
            f"{empresas[0]['codigo']} · "
            f"{', '.join(empresas[0].get('roles') or [])}"
        )
    else:
        codes = ", ".join(e["codigo"] for e in empresas[:3])
        suffix = f" (+{len(empresas) - 3} más)" if len(empresas) > 3 else ""
        display_label = f"{codes}{suffix}"

    return {
        "is_admin": False,
        "empresas": empresas,
        "scope_summary": {
            "total": len(empresas),
            "is_global": False,
            "roles_summary": sorted(all_roles),
            "display_label": display_label,
        },
    }

