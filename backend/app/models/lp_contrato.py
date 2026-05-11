"""Modelo LpContrato — `core.lp_contratos` (V5++ ola AL).

Contratos de suscripción de cuotas del FIP CEHTA ESG.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LpContrato(Base):
    __tablename__ = "lp_contratos"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    contrato_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    fondo_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )

    # Suscriptor
    suscriptor_nombre: Mapped[str] = mapped_column(Text, nullable=False)
    suscriptor_rut: Mapped[str] = mapped_column(Text, nullable=False)
    representante_nombre: Mapped[str | None] = mapped_column(Text)
    representante_rut: Mapped[str | None] = mapped_column(Text)
    domicilio: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)

    # Contrato
    tipo_contrato: Mapped[str] = mapped_column(Text, nullable=False)  # PROMESA | DEFINITIVO
    serie: Mapped[str] = mapped_column(Text, nullable=False)  # A | B
    fecha_contrato: Mapped[date] = mapped_column(Date, nullable=False)
    notaria: Mapped[str | None] = mapped_column(Text)
    codigo_verificacion: Mapped[str | None] = mapped_column(Text)

    # Montos
    cantidad_cuotas: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    valor_por_cuota_uf: Mapped[Decimal] = mapped_column(
        Numeric(18, 4), nullable=False, server_default="350"
    )
    uf_comprometidas: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    monto_clp: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    uf_value_at_signing: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))

    # Cláusulas
    multa_mora_pct: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), server_default="5.00"
    )
    indemnizacion_pct: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), server_default="50.00"
    )
    forma_pago: Mapped[str | None] = mapped_column(Text)

    # Estado
    estado: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="PROMETIDO"
    )
    fecha_suscripcion: Mapped[date | None] = mapped_column(Date)
    fecha_pago: Mapped[date | None] = mapped_column(Date)
    voucher_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.vouchers.voucher_id")
    )

    # Docs
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    observaciones: Mapped[str | None] = mapped_column(Text)

    # Audit
    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
