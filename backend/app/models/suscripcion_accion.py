"""Modelo SuscripcionAccion — `core.suscripciones_acciones`.

Recibos de suscripción de acciones del FIP CEHTA ESG (instrumento de
inversión privado). Cada registro es un recibo emitido a un inversionista,
firmado o pendiente de firma, con monto en CLP y opcionalmente UF.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SuscripcionAccion(Base):
    __tablename__ = "suscripciones_acciones"
    __table_args__ = {"schema": "core"}

    suscripcion_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(
        Text,
        ForeignKey("core.empresas.codigo"),
        nullable=False,
    )
    fecha_recibo: Mapped[date] = mapped_column(Date, nullable=False)
    acciones_pagadas: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    monto_uf: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    monto_clp: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    contrato_ref: Mapped[str | None] = mapped_column(Text)
    recibo_url: Mapped[str | None] = mapped_column(Text)
    firmado: Mapped[bool] = mapped_column(Boolean, server_default="false")
    fecha_firma: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
