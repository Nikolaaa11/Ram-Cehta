"""Schemas Pydantic para 2FA TOTP (V4 fase 2)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class EnrollResponse(BaseModel):
    """Respuesta de `POST /me/2fa/enroll` — única vez que el secret y los
    backup codes salen del backend. El frontend los muestra al usuario y
    los descarta. Si el usuario los pierde, hay que regenerar."""

    secret: str = Field(..., description="Base32 — para entry manual en el autenticador")
    provisioning_uri: str = Field(..., description="otpauth:// — formato QR")
    qr_url: str = Field(..., description="URL del PNG del QR para mostrar en <img>")
    backup_codes: list[str] = Field(
        ..., description="10 códigos one-time, formato XXXX-XXXX. Mostrar UNA SOLA VEZ."
    )


class VerifyRequest(BaseModel):
    """Request para `POST /me/2fa/verify` y `POST /me/2fa/disable`.

    `code` acepta:
    - 6 dígitos (TOTP del autenticador)
    - 9 chars formato `XXXX-XXXX` (backup code one-time)
    """

    code: str = Field(..., min_length=6, max_length=9)


class StatusResponse(BaseModel):
    """Estado del 2FA del usuario logueado."""

    enabled: bool
    enabled_at: datetime | None = None
    backup_codes_remaining: int = 0


class DisableRequest(VerifyRequest):
    """Mismo shape que VerifyRequest — el code es el final auth gate."""


class BackupCodesResponse(BaseModel):
    """Respuesta de `POST /me/2fa/regenerate-backup-codes`."""

    backup_codes: list[str] = Field(
        ..., description="10 códigos nuevos one-time. Los anteriores quedan invalidados."
    )
