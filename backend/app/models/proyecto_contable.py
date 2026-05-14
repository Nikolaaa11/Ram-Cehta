"""Modelo SQLAlchemy mínimo para `core.proyectos_contables`.

Existe solo para resolver la FK `voucher_lines.proyecto_codigo` →
`core.proyectos_contables.codigo`. Sin este modelo en el metadata,
SQLAlchemy lanza `NoReferencedTableError` al hacer commit de cualquier
voucher (la sort_tables() del ORM necesita todas las tablas FK-referenced
en el metadata, incluso si el valor del campo es NULL).

La lógica CRUD vive en `app/api/v1/proyectos_contables.py` con SQL directo.
"""
from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ProyectoContable(Base):
    __tablename__ = "proyectos_contables"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    codigo: Mapped[str] = mapped_column(Text, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
