"""Modelo `app.saved_views` (V3 fase 11 — Saved filters per user).

Cada usuario puede guardar combinaciones nombradas de filtros para las
páginas list (OCs, F29, trabajadores, proveedores, legal, fondos) y
recuperarlas con un click. Un view "pinned" sale arriba en el dropdown
del menu.

La tabla vive en schema `app` (separado de `core` que mapea Excel /
operativo). El JSON `filters` es libre — cada página decide su propio
shape — pero el `page` es un enum cerrado para que el frontend tipee el
dropdown correctamente.

Ownership: cada query pasa por `WHERE user_id = ?`. El repo no
expone helpers que escapen este check (privacy invariant).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SavedView(Base):
    __tablename__ = "saved_views"
    __table_args__ = (
        Index("idx_saved_views_user_page", "user_id", "page"),
        Index(
            "idx_saved_views_user_pinned",
            "user_id",
            postgresql_where="is_pinned = true",
        ),
        {"schema": "app"},
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), nullable=False, index=True
    )
    page: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    filters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
