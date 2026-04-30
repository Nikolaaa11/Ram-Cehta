"""Modelo `app.user_preferences` (V4 fase 4 — onboarding tour for first-time users).

Tabla key-value genérica per-user. La PK es compuesta `(user_id, key)`, lo
que permite que cada usuario tenga N preferencias sin duplicar filas y que
el lookup por `(user_id, key)` sea O(log n).

Diseño:
- `value` es JSONB: acepta cualquier shape (dict / list / bool / str / int /
  float / null). El callsite es responsable de mantener consistencia de
  schema por key.
- Sin FK a `auth.users` (Supabase live en otro schema/RLS); la cleanup la
  hace el delete cascade del user role en `core.user_roles` cuando un admin
  remueve un usuario.
- `key` es ASCII corto (≤64). Convención para evitar colisiones: prefijar
  por feature, e.g. `onboarding_tour`, `dashboard_layout`, `theme`.

Casos de uso planeados:
- `onboarding_tour` — `{completed: bool, current_step: int}` (esta fase).
- `theme` — `"light" | "dark" | "system"` (futuro).
- `digest_frequency` — `"daily" | "weekly" | "off"` (futuro).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserPreference(Base):
    __tablename__ = "user_preferences"
    __table_args__ = ({"schema": "app"},)

    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
