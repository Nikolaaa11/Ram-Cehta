"""Modelo `core.legal_documents` — Legal Vault por empresa (V3 fase 3+4).

Decisiones:
- Empresa-scoped: FK a `core.empresas(codigo)` y siempre se filtra por código.
- `dropbox_path` puede ser null (documento creado con sólo metadatos);
  el binario vive en Dropbox: `/Cehta Capital/01-Empresas/{codigo}/03-Legal/`.
- `metadata_` mapea la columna `metadata` (alias en Python para no chocar con
  `Base.metadata`) — mismo patrón que `Integration` / `TrabajadorDocumento`.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LegalDocument(Base):
    __tablename__ = "legal_documents"
    __table_args__ = {"schema": "core"}  # noqa: RUF012 — patrón estándar SQLAlchemy

    documento_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    categoria: Mapped[str] = mapped_column(Text, nullable=False)
    subcategoria: Mapped[str | None] = mapped_column(Text)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    contraparte: Mapped[str | None] = mapped_column(Text)
    fecha_emision: Mapped[date | None] = mapped_column(Date)
    fecha_vigencia_desde: Mapped[date | None] = mapped_column(Date)
    fecha_vigencia_hasta: Mapped[date | None] = mapped_column(Date)
    monto: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    moneda: Mapped[str | None] = mapped_column(Text)
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(Text, server_default="vigente", nullable=False)
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    uploaded_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
