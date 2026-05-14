"""Modelo SQLAlchemy mínimo para `core.plan_cuentas`.

Existe solo para que `VoucherLine.cuenta_codigo` y otras FKs puedan
resolverse en el metadata. La lógica CRUD del plan de cuentas vive en
los services (`plan_cuentas_import_service`, etc.) que usan SQL directo.

Sin este modelo, SQLAlchemy lanza `NoReferencedTableError` al hacer
flush/commit en cualquier voucher (incluso si la FK es NULL).
"""
from __future__ import annotations

from sqlalchemy import Boolean, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PlanCuenta(Base):
    __tablename__ = "plan_cuentas"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    codigo: Mapped[str] = mapped_column(Text, primary_key=True)
    nivel: Mapped[int] = mapped_column(Integer, nullable=False)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    imputable: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    activa: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
