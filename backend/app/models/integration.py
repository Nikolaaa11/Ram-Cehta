"""Modelo Integration — `core.integrations`.

Persiste tokens OAuth (access_token, refresh_token) por proveedor externo
(Dropbox inicialmente, Gmail/Drive/etc. en el futuro). Single-tenant en V3:
una integración activa por proveedor (la cuenta corporativa de Cehta).

`metadata_` mapea la columna `metadata` (alias en Python para no chocar con
`Base.metadata` de SQLAlchemy).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import ARRAY, BigInteger, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = {"schema": "core"}  # noqa: RUF012 — patrón estándar SQLAlchemy

    integration_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    account_info: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    scopes: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    connected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
