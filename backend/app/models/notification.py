"""Modelo `app.notifications` (V3 fase 8 — Inbox in-app).

Notificaciones in-app por usuario. Cada fila es una notificación dirigida a
un usuario concreto (`user_id` = `auth.users.id` de Supabase). Los alert
generators producen estas filas a partir de eventos operativos (F29 por
vencer, contratos por vencer, OCs estancadas en pendiente_pago).

Nota arquitectónica: la tabla vive en el schema `app` (separado del schema
`core` que mapea Excel/operativo). `read_at` nullable = unread; al marcarla
leída se setea `read_at = now()`.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("idx_notifications_user_unread", "user_id", "read_at"),
        Index("idx_notifications_user_created", "user_id", "created_at"),
        {"schema": "app"},
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False, server_default="info")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    link: Mapped[str | None] = mapped_column(Text)
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
