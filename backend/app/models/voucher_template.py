"""Modelo `core.voucher_templates` — V5++ ola AB.

Plantillas reutilizables para vouchers recurrentes (sueldos, arriendos,
servicios mensuales). Las líneas se guardan como JSONB porque cada
plantilla es self-contained y no tiene cardinalidad alta.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class VoucherTemplate(Base):
    __tablename__ = "voucher_templates"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    template_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    codigo: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    glosa_default: Mapped[str] = mapped_column(Text, nullable=False)
    moneda: Mapped[str] = mapped_column(Text, server_default="CLP", nullable=False)

    # JSONB con array de líneas:
    # [{"line_number": 1, "cuenta_codigo": "5-01-...", "proyecto_codigo": null,
    #   "area_codigo": "ADM", "debit": "1000000", "credit": "0",
    #   "descripcion": "Sueldo base", "balance_treatment": "GASTO"}, ...]
    lines: Mapped[list[dict]] = mapped_column(JSONB, nullable=False)

    contraparte_rut: Mapped[str | None] = mapped_column(Text)
    contraparte_nombre: Mapped[str | None] = mapped_column(Text)
    contraparte_tipo: Mapped[str | None] = mapped_column(Text)
    doc_tributario_tipo: Mapped[str | None] = mapped_column(Text)

    activo: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    use_count: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
