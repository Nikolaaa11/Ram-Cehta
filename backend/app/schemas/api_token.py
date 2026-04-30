"""Schemas para Public API tokens.

Diseño:
- Cada token se emite a un user (admin) y "actúa como" ese user — hereda
  sus scopes via ROLE_SCOPES. Esto evita inventar un permission system
  paralelo.
- El token raw se devuelve UNA SOLA VEZ al crear (`POST` returns 201 con
  el token). Después solo `token_hint` (primeros 12 chars).
- Soporta expiración opcional y revocación.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ApiTokenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    expires_at: datetime | None = None  # None = nunca expira


class ApiTokenRead(BaseModel):
    id: str
    name: str
    description: str | None
    token_hint: str  # "cak_AbCd1234…"
    created_by: str | None
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime

    @property
    def status(self) -> Literal["active", "expired", "revoked"]:
        if self.revoked_at:
            return "revoked"
        if self.expires_at and self.expires_at < datetime.now(tz=self.expires_at.tzinfo):
            return "expired"
        return "active"


class ApiTokenWithSecret(ApiTokenRead):
    """Devuelto SOLO al crear — incluye el token crudo una sola vez."""

    token: str  # crudo `cak_xxxxx...`; no recuperable después
