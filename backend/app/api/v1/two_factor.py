"""Endpoints de 2FA TOTP (V4 fase 2 — 2FA TOTP for admin role).

5 endpoints bajo el prefix `/me/2fa`:
  - GET    /me/2fa/status                       estado del 2FA del usuario
  - POST   /me/2fa/enroll                        genera secret + QR + backup codes
  - POST   /me/2fa/verify                        confirma con un código (TOTP o backup)
  - POST   /me/2fa/disable                       desactiva (requiere code)
  - POST   /me/2fa/regenerate-backup-codes       genera 10 nuevos (consume code)

Cualquier usuario autenticado puede activar 2FA en su propia cuenta. Los
admins están "encouraged" via banner en el frontend; el enforcement
"hard" solo aplica a 4 endpoints high-impact (ver `current_admin_with_2fa`
en `app.api.deps`).

NUNCA loggear `secret` ni `backup_codes` en claro.
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.schemas.two_factor import (
    BackupCodesResponse,
    DisableRequest,
    EnrollResponse,
    StatusResponse,
    VerifyRequest,
)
from app.services import totp_service

router = APIRouter()


async def _get_row(db, user_id: str) -> dict | None:
    row = (
        await db.execute(
            text(
                "SELECT user_id::text AS user_id, secret, enabled, "
                "backup_codes, enabled_at, created_at, updated_at "
                "FROM app.user_2fa WHERE user_id = :uid"
            ),
            {"uid": user_id},
        )
    ).mappings().first()
    return dict(row) if row else None


def _remaining(backup_codes: list[str] | None) -> int:
    """Cuántos slots de backup_codes siguen activos (no consumidos)."""
    if not backup_codes:
        return 0
    return sum(1 for c in backup_codes if c)


@router.get("/2fa/status", response_model=StatusResponse)
async def status_2fa(user: CurrentUser, db: DBSession) -> StatusResponse:
    row = await _get_row(db, user.sub)
    if row is None:
        return StatusResponse(enabled=False, enabled_at=None, backup_codes_remaining=0)
    return StatusResponse(
        enabled=bool(row["enabled"]),
        enabled_at=row["enabled_at"],
        backup_codes_remaining=_remaining(row.get("backup_codes")),
    )


@router.post("/2fa/enroll", response_model=EnrollResponse)
async def enroll_2fa(user: CurrentUser, db: DBSession) -> EnrollResponse:
    """Genera secret + QR + backup codes; persiste con `enabled=false`.

    - Si ya hay enrollment con `enabled=false` → regenera (allow retry).
    - Si ya hay enrollment con `enabled=true`  → 409 (debe disable primero).
    """
    existing = await _get_row(db, user.sub)
    if existing and existing["enabled"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "2FA ya está activo. Usá /me/2fa/disable o "
                "/me/2fa/regenerate-backup-codes."
            ),
        )

    secret = totp_service.generate_secret()
    raw_codes = totp_service.generate_backup_codes(10)
    hashed = [totp_service.hash_backup_code(c) for c in raw_codes]

    if existing is None:
        await db.execute(
            text(
                """
                INSERT INTO app.user_2fa
                    (user_id, secret, enabled, backup_codes, enabled_at)
                VALUES
                    (:uid, :secret, false, :codes, NULL)
                """
            ),
            {"uid": user.sub, "secret": secret, "codes": hashed},
        )
    else:
        await db.execute(
            text(
                """
                UPDATE app.user_2fa
                   SET secret = :secret,
                       enabled = false,
                       enabled_at = NULL,
                       backup_codes = :codes,
                       updated_at = now()
                 WHERE user_id = :uid
                """
            ),
            {"uid": user.sub, "secret": secret, "codes": hashed},
        )
    await db.commit()

    email = user.email or user.sub
    provisioning = totp_service.provisioning_uri(secret, email)
    return EnrollResponse(
        secret=secret,
        provisioning_uri=provisioning,
        qr_url=totp_service.qr_url_for(provisioning),
        backup_codes=raw_codes,
    )


@router.post("/2fa/verify", response_model=StatusResponse)
async def verify_2fa(
    user: CurrentUser, db: DBSession, body: VerifyRequest
) -> StatusResponse:
    """Confirma posesión del autenticador. Si OK, `enabled=true`."""
    row = await _get_row(db, user.sub)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay enrollment 2FA. Llamá /me/2fa/enroll primero.",
        )

    code = body.code.strip().upper()
    valid = False
    consumed_idx: int | None = None

    # TOTP de 6 dígitos.
    if code.isdigit() and len(code) == 6:
        valid = totp_service.verify_code(row["secret"], code)
    else:
        # Backup code XXXX-XXXX.
        consumed_idx = totp_service.verify_backup_code(
            list(row.get("backup_codes") or []), code
        )
        valid = consumed_idx is not None

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código inválido",
        )

    # Persistir: enabled=true (idempotente) + consumir backup si aplica.
    new_codes = list(row.get("backup_codes") or [])
    if consumed_idx is not None:
        new_codes[consumed_idx] = ""

    enabled_at = row["enabled_at"] or datetime.now(UTC)
    await db.execute(
        text(
            """
            UPDATE app.user_2fa
               SET enabled = true,
                   enabled_at = :enabled_at,
                   backup_codes = :codes,
                   updated_at = now()
             WHERE user_id = :uid
            """
        ),
        {
            "uid": user.sub,
            "enabled_at": enabled_at,
            "codes": new_codes,
        },
    )
    await db.commit()

    return StatusResponse(
        enabled=True,
        enabled_at=enabled_at,
        backup_codes_remaining=_remaining(new_codes),
    )


@router.post("/2fa/disable", response_model=StatusResponse)
async def disable_2fa(
    user: CurrentUser, db: DBSession, body: DisableRequest
) -> StatusResponse:
    """Desactiva 2FA — borra la fila. Requiere code válido como gate."""
    row = await _get_row(db, user.sub)
    if row is None or not row["enabled"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="2FA no está activo",
        )

    code = body.code.strip().upper()
    valid = False
    if code.isdigit() and len(code) == 6:
        valid = totp_service.verify_code(row["secret"], code)
    else:
        valid = (
            totp_service.verify_backup_code(
                list(row.get("backup_codes") or []), code
            )
            is not None
        )

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código inválido",
        )

    await db.execute(
        text("DELETE FROM app.user_2fa WHERE user_id = :uid"),
        {"uid": user.sub},
    )
    await db.commit()

    return StatusResponse(enabled=False, enabled_at=None, backup_codes_remaining=0)


@router.post("/2fa/regenerate-backup-codes", response_model=BackupCodesResponse)
async def regenerate_backup_codes(
    user: CurrentUser, db: DBSession
) -> BackupCodesResponse:
    """Regenera los 10 backup codes. Requiere 2FA activo.

    Los códigos anteriores quedan completamente invalidados.
    """
    row = await _get_row(db, user.sub)
    if row is None or not row["enabled"]:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="2FA no está activo. Activalo primero con /me/2fa/enroll.",
        )

    raw_codes = totp_service.generate_backup_codes(10)
    hashed = [totp_service.hash_backup_code(c) for c in raw_codes]

    await db.execute(
        text(
            "UPDATE app.user_2fa SET backup_codes = :codes, updated_at = now() "
            "WHERE user_id = :uid"
        ),
        {"uid": user.sub, "codes": hashed},
    )
    await db.commit()

    return BackupCodesResponse(backup_codes=raw_codes)
