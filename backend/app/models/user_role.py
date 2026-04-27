"""Modelo UserRole — `core.user_roles`.

Mapea `auth.users.id` (Supabase) a un app_role de la matriz canónica RBAC.
El JWT hook custom_access_token_hook inyecta este rol en cada token.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = {"schema": "core"}

    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    app_role: Mapped[str] = mapped_column(Text, nullable=False, server_default="viewer")
    assigned_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
