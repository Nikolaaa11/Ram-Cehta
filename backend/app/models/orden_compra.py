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
    # Plazo de ENTREGA de los bienes/servicios — distinto del plazo de pago.
    # Las OC reales llevan ambos ("Cond. de Pago: 30% anticipo" y
    # "Plazo de Entrega: No aplica") y el PDF los imprime en filas separadas.
    plazo_entrega: Mapped[str | None] = mapped_column(Text)
    observaciones: Mapped[str | None] = mapped_column(Text)
    # Encargado del proveedor a quien va dirigida la OC ("Atte. Señor/a" en
    # el PDF). Snapshot al crear/editar — no se re-deriva del catálogo
    # proveedor_contactos, así una OC ya emitida no cambia de destinatario
    # si el proveedor actualiza sus contactos después.
    atte_nombre: Mapped[str | None] = mapped_column(Text)
    atte_cargo: Mapped[str | None] = mapped_column(Text)
    proveedor_contacto_id: Mapped[int | None] = mapped_column(Integer)
    # FACTURA | FACTURA_EXENTA | BOLETA | HONORARIOS — mismo catálogo que
    # core.vouchers.doc_tributario_tipo, para que el mapeo OC→voucher sea la
    # identidad. FACTURA_EXENTA no es "FACTURA con 0%": la exenta no da
    # crédito fiscal y se declara en otra línea del F29/RCV.
    tipo_documento: Mapped[str] = mapped_column(Text, server_default="FACTURA")
    iva_porcentaje: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), server_default="19.00"
    )
    # Retención de segunda categoría (Art. 74 N°2 LIR). Sólo HONORARIOS
    # retiene. La tasa se GUARDA, no se re-deriva de core.tax_config: si el
    # SII la sube en 2027, las OC de 2026 tienen que seguir mostrando 15,25%.
    # 0 es un valor legítimo — nunca `x or Decimal(...)` sobre este campo.
    retencion_porcentaje: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), server_default="0"
    )
    retencion_monto: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), server_default="0"
    )
    # PLATA QUE SALE = total - retencion_monto. `total` conserva su
    # semántica histórica (neto + iva) porque lo consumen hitos, exports,
    # webhooks y el PDF; redefinirlo habría cambiado el significado en diez
    # lugares a la vez. NOT NULL sin server_default a propósito: quien
    # inserta tiene que calcularlo, un 0 por omisión sería un monto falso.
    total_a_pagar: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
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
