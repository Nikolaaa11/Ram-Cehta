"""Modelo `core.calendar_events` (V3 fase 5 — Calendario).

Eventos del reglamento (F29 mensual, reportes LP, comités) + ad-hoc.
`auto_generado=True` cuando lo creó un agente; `False` cuando lo creó
un humano via UI.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    event_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    titulo: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    empresa_codigo: Mapped[str | None] = mapped_column(
        Text, ForeignKey("core.empresas.codigo")
    )
    fecha_inicio: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fecha_fin: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    todo_el_dia: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    recurrencia: Mapped[str | None] = mapped_column(Text)
    notificar_dias_antes: Mapped[int] = mapped_column(
        Integer, server_default="3", nullable=False
    )
    notificar_emails: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    auto_generado: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    completado: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
