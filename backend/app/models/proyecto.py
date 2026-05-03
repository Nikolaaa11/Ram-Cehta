"""Modelos `core.proyectos_empresa`, `core.hitos`, `core.riesgos` (V3 fase 5).

Sección Avance + Gantt: cada empresa puede tener múltiples proyectos.
Cada proyecto tiene hitos (Gantt dots) y registro de riesgos. Riesgos
pueden ser cross-proyecto (sólo `empresa_codigo`) o estar atados a un
proyecto.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ProyectoEmpresa(Base):
    __tablename__ = "proyectos_empresa"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    proyecto_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    fecha_inicio: Mapped[date | None] = mapped_column(Date)
    fecha_fin_estimada: Mapped[date | None] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(Text, server_default="en_progreso", nullable=False)
    progreso_pct: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    owner_email: Mapped[str | None] = mapped_column(Text)
    dropbox_roadmap_path: Mapped[str | None] = mapped_column(Text)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Hito(Base):
    __tablename__ = "hitos"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    hito_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    proyecto_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("core.proyectos_empresa.proyecto_id", ondelete="CASCADE"), nullable=False
    )
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    fecha_planificada: Mapped[date | None] = mapped_column(Date)
    fecha_completado: Mapped[date | None] = mapped_column(Date)
    estado: Mapped[str] = mapped_column(Text, server_default="pendiente", nullable=False)
    orden: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    progreso_pct: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    deliverable_url: Mapped[str | None] = mapped_column(Text)
    # V4 fase 8.2: encargado para Secretaria AI + Kanban Upcoming Tasks.
    # Nullable porque hitos legacy/manuales no tienen encargado registrado.
    encargado: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Riesgo(Base):
    __tablename__ = "riesgos"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    riesgo_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    proyecto_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.proyectos_empresa.proyecto_id", ondelete="CASCADE")
    )
    empresa_codigo: Mapped[str | None] = mapped_column(
        Text, ForeignKey("core.empresas.codigo")
    )
    titulo: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    severidad: Mapped[str] = mapped_column(Text, server_default="media", nullable=False)
    probabilidad: Mapped[str] = mapped_column(Text, server_default="media", nullable=False)
    estado: Mapped[str] = mapped_column(Text, server_default="abierto", nullable=False)
    owner_email: Mapped[str | None] = mapped_column(Text)
    mitigacion: Mapped[str | None] = mapped_column(Text)
    fecha_identificado: Mapped[date] = mapped_column(Date, server_default=func.current_date(), nullable=False)
    fecha_cierre: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
