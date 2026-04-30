"""Modelo `core.currency_rates` (V4 fase 1 — Currency conversion UF/CLP/USD).

Cada fila almacena el valor de una moneda (UF, USD) expresado en CLP para
una fecha concreta. La tabla actúa como cache local: cada vez que el
servicio necesita convertir, primero busca aquí y solo si no encuentra
sale a la API externa (BCN / mindicador). Esto evita martillar APIs
externas y deja la app funcional incluso offline.

Constraints clave:
- UNIQUE (currency_code, date) → idempotencia. Una fecha = una tasa por
  moneda. Source decide quién ganó (bcn > mindicador > fallback manual).
- Indice (currency_code, date DESC) → "latest rate" en O(log n) sin
  full scan.

Ownership: la tabla vive en schema `core` porque es data financiera
operacional (no per-user, no app-level state).
"""
from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, Index, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CurrencyRate(Base):
    __tablename__ = "currency_rates"
    __table_args__ = (
        UniqueConstraint(
            "currency_code", "date", name="uq_currency_rates_code_date"
        ),
        Index(
            "idx_currency_rates_code_date_desc",
            "currency_code",
            "date",
        ),
        {"schema": "core"},
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    currency_code: Mapped[str] = mapped_column(String(8), nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    rate_clp: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="bcn")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
