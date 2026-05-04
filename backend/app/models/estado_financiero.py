"""Modelo `core.estados_financieros` — EEFF de empresas portfolio (V5).

Estados Financieros (Balance, Estado de Resultados, Flujo de Caja,
Cambios de Patrimonio, Consolidados, Notas) por empresa portfolio +
período. FK con CASCADE a `core.empresas(codigo)`.

Distinto de `core.policies_fondo` (políticas del fondo, sin FK a
empresa) y `core.legal_documents` (documentos legales por empresa).

Migración: alembic/versions/0032_estados_financieros.py.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EstadoFinanciero(Base):
    __tablename__ = "estados_financieros"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    ef_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(Text, nullable=False)
    tipo_ef: Mapped[str] = mapped_column(Text, nullable=False)
    periodo_tipo: Mapped[str] = mapped_column(Text, nullable=False)
    periodo: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_corte: Mapped[date] = mapped_column(Date, nullable=False)
    auditado: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    auditor: Mapped[str | None] = mapped_column(Text)
    aprobado_directorio: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    fecha_aprobacion: Mapped[date | None] = mapped_column(Date)
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    hash_sha256: Mapped[str | None] = mapped_column(Text)
    # `metadata` está reservado por Base.metadata en SQLAlchemy declarative —
    # mapeamos al atributo Python `metadata_` pero a la columna SQL `metadata`.
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, server_default="{}", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
