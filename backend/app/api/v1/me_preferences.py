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
