from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class OrdenCompra(Base):
    __tablename__ = "ordenes_compra"
    __table_args__ = {"schema": "core"}

    oc_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    numero_oc: Mapped[str] = mapped_column(Text, nullable=False)
    empresa_codigo: Mapped[str] = mapped_column(Text, nullable=False)
    proveedor_id: Mapped[int | None] = mapped_column(Integer)
    fecha_emision: Mapped[date] = mapped_column(Date, nullable=False)
    validez_dias: Mapped[int] = mapped_column(Integer, server_default="30")
    moneda: Mapped[str] = mapped_column(Text, server_default="CLP")
    neto: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    iva: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    forma_pago: Mapped[str | None] = mapped_column(Text)
    plazo_pago: Mapped[str | None] = mapped_column(Text)
    observaciones: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text, server_default="emitida")
    pdf_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    items: Mapped[list[OrdenCompraDetalle]] = relationship(
        "OrdenCompraDetalle",
        back_populates="orden_compra",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class OrdenCompraDetalle(Base):
    __tablename__ = "ordenes_compra_detalle"
    __table_args__ = {"schema": "core"}

    detalle_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    oc_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("core.ordenes_compra.oc_id", ondelete="CASCADE"),
        nullable=False,
    )
    item: Mapped[int] = mapped_column(Integer, nullable=False)
    descripcion: Mapped[str] = mapped_column(Text, nullable=False)
    precio_unitario: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    total_linea: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    orden_compra: Mapped[OrdenCompra] = relationship(
        "OrdenCompra", back_populates="items"
    )
