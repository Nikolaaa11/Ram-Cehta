"""Modelo SQLAlchemy mínimo para `core.areas`.

Existe solo para resolver la FK `voucher_lines.area_codigo` →
`core.areas.codigo`. Sin este modelo, SQLAlchemy ORM no puede ordenar
las tablas para INSERT y crashea con `NoReferencedTableError`.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Area(Base):
    __tablename__ = "areas"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    codigo: Mapped[str] = mapped_column(Text, primary_key=True)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    activa: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
