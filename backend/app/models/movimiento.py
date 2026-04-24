from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Integer, Numeric, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Movimiento(Base):
    __tablename__ = "movimientos"
    __table_args__ = {"schema": "core"}

    movimiento_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    natural_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)

    fecha: Mapped[date] = mapped_column(Date, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)

    abono: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    egreso: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    saldo_contable: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    saldo_cehta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    saldo_corfo: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    concepto_general: Mapped[str | None] = mapped_column(Text)
    concepto_detallado: Mapped[str | None] = mapped_column(Text)
    tipo_egreso: Mapped[str | None] = mapped_column(Text)
    fuente: Mapped[str | None] = mapped_column(Text)
    proyecto: Mapped[str | None] = mapped_column(Text)
    banco: Mapped[str | None] = mapped_column(Text)

    real_proyectado: Mapped[str | None] = mapped_column(Text)
    anio: Mapped[int] = mapped_column(Integer, nullable=False)
    periodo: Mapped[str] = mapped_column(Text, nullable=False)
    empresa_codigo: Mapped[str] = mapped_column(Text, nullable=False)

    iva_credito_fiscal: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")
    iva_debito_fiscal: Mapped[Decimal] = mapped_column(Numeric(18, 2), server_default="0")

    tipo_documento: Mapped[str | None] = mapped_column(Text)
    numero_documento: Mapped[str | None] = mapped_column(Text)
    hipervinculo: Mapped[str | None] = mapped_column(Text)

    run_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
