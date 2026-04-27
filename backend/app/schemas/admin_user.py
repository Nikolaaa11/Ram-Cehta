"""Schemas para administración de usuarios + roles (admin only)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

AppRole = Literal["admin", "finance", "viewer"]

# Regex pragmático para email (no validamos DNS para no agregar dep
# `email-validator`; auth.users tiene el correo verificado).
_EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserRoleRead(BaseModel):
    user_id: str
    email: str | None
    app_role: AppRole
    assigned_at: datetime
    assigned_by: str | None

    model_config = {"from_attributes": True}


class UserRoleAssignRequest(BaseModel):
    """POST /admin/users — asigna un rol al usuario identificado por email.

    El email debe existir en `auth.users` (Supabase). Si no existe, el
    endpoint responde 404 indicando que primero se debe crear vía Dashboard.
    """

    email: str = Field(..., pattern=_EMAIL_RE, max_length=320)
    app_role: AppRole = Field(..., description="Rol canónico: admin|finance|viewer")

    @field_validator("email", mode="before")
    @classmethod
    def _normalize_email(cls, v: str | None) -> str | None:
        return v.strip().lower() if isinstance(v, str) else v


class UserRoleUpdateRequest(BaseModel):
    """PATCH /admin/users/{user_id}/role — cambia rol de un usuario existente."""

    app_role: AppRole
