"""Modelo `core.lps` — pipeline de Limited Partners (V4 fase 9).

Master list de inversionistas. Pipeline → cualificado → activo. Cada uno
puede tener múltiples informes generados en `app.informes_lp`.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from decimal import Decimal

from sqlalchemy import ARRAY, BigInteger, Date, DateTime, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Lp(Base):
    __tablename__ = "lps"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    lp_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    apellido: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text, unique=True)
    telefono: Mapped[str | None] = mapped_column(Text)
    empresa: Mapped[str | None] = mapped_column(Text)
    rol: Mapped[str | None] = mapped_column(Text)

    estado: Mapped[str] = mapped_column(
        Text, server_default="pipeline", nullable=False
    )
    primer_contacto: Mapped[date | None] = mapped_column(Date)

    perfil_inversor: Mapped[str | None] = mapped_column(Text)
    intereses: Mapped[list[str] | None] = mapped_column(JSONB, server_default="[]")
    relationship_owner: Mapped[str | None] = mapped_column(Text)

    aporte_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    aporte_actual: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    empresas_invertidas: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text), server_default="{}"
    )

    notas: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column(
        "metadata", JSONB, server_default="{}"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
