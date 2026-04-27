"""Modelos `core.trabajadores` y `core.trabajador_documentos` — V3 HR.

Decisiones:
- `Trabajador` es **empresa-scoped**: `empresa_codigo` es FK a `core.empresas`
  y la UNIQUE constraint vive en `(empresa_codigo, rut)` (un mismo RUT puede
  aparecer en varias empresas del portafolio).
- `dropbox_folder` guarda la ruta absoluta en Dropbox (single-tenant); se
  setea al crear y se rota cuando un trabajador pasa a `inactivo` (movimiento
  de `Activos/` → `Inactivos/`).
- `documentos` carga `lazy="selectin"` para evitar el footgun N+1 al serializar
  un `Trabajador` con su listado.
- `metadata_` mapea la columna `metadata` (alias en Python para no chocar con
  `Base.metadata` de SQLAlchemy) — mismo patrón usado en `Integration`.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Trabajador(Base):
    __tablename__ = "trabajadores"
    __table_args__ = {"schema": "core"}  # noqa: RUF012 — patrón estándar SQLAlchemy

    trabajador_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    nombre_completo: Mapped[str] = mapped_column(Text, nullable=False)
    rut: Mapped[str] = mapped_column(Text, nullable=False)
    cargo: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    telefono: Mapped[str | None] = mapped_column(Text)
    fecha_ingreso: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_egreso: Mapped[date | None] = mapped_column(Date)
    sueldo_bruto: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    tipo_contrato: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text, server_default="activo", nullable=False)
    dropbox_folder: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    documentos: Mapped[list[TrabajadorDocumento]] = relationship(
        "TrabajadorDocumento",
        back_populates="trabajador",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TrabajadorDocumento(Base):
    __tablename__ = "trabajador_documentos"
    __table_args__ = {"schema": "core"}  # noqa: RUF012 — patrón estándar SQLAlchemy

    documento_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trabajador_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.trabajadores.trabajador_id", ondelete="CASCADE"),
        nullable=False,
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    nombre_archivo: Mapped[str] = mapped_column(Text, nullable=False)
    dropbox_path: Mapped[str] = mapped_column(Text, nullable=False)
    tamano_bytes: Mapped[int | None] = mapped_column(BigInteger)
    uploaded_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)

    trabajador: Mapped[Trabajador] = relationship(
        "Trabajador", back_populates="documentos"
    )
