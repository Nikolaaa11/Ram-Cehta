"""Modelo `core.fondos` (V3 fase 5 — Búsqueda de Fondos)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, Numeric, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Fondo(Base):
    __tablename__ = "fondos"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    fondo_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    pais: Mapped[str | None] = mapped_column(Text)
    region: Mapped[str | None] = mapped_column(Text)
    ticket_min_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    ticket_max_usd: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    sectores: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    stage: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    thesis: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(Text)
    contacto_nombre: Mapped[str | None] = mapped_column(Text)
    contacto_email: Mapped[str | None] = mapped_column(Text)
    contacto_linkedin: Mapped[str | None] = mapped_column(Text)
    estado_outreach: Mapped[str] = mapped_column(
        Text, server_default="no_contactado", nullable=False
    )
    fecha_proximo_contacto: Mapped[date | None] = mapped_column(Date)
    notas: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
