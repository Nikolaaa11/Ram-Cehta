"""Modelo `core.lp_documents` — Vault de documentos por LP (V5).

Cada Limited Partner del FIP tiene un set de documentos legales y
operativos: contrato de suscripción, KYC, DDQ, side letters, recibos
de aporte, formularios tributarios W-8/W-9, DNI/pasaporte, poder
notarial, etc.

A diferencia de `policies_fondo` (políticas del fondo, sin FK), estos
documentos están atados a un LP específico vía FK `lp_id` con CASCADE
on delete: si se borra el LP, su vault se va con él.

Migración: alembic/versions/0030_lp_documents.py.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LpDocument(Base):
    __tablename__ = "lp_documents"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    lp_doc_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lp_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.lps.lp_id", ondelete="CASCADE"),
        nullable=False,
    )
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_firma: Mapped[date | None] = mapped_column(Date)
    fecha_vigencia_hasta: Mapped[date | None] = mapped_column(Date)
    monto_clp: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    hash_sha256: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(
        Text, server_default="vigente", nullable=False
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, server_default="{}", nullable=False
    )
    uploaded_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
