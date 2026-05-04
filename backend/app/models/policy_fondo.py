"""Modelo `core.policies_fondo` — Políticas internas del FIP CEHTA (V5).

Distinto de `core.legal_documents` (que es por empresa portfolio) —
estas son políticas del fondo: reglamento interno, manual UAF, código
de ética, política PEP, etc. Sin FK a empresas.

Migración: alembic/versions/0029_policies_fondo.py.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PolicyFondo(Base):
    __tablename__ = "policies_fondo"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    policy_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    fecha_aprobacion: Mapped[date] = mapped_column(Date, nullable=False)
    fecha_vigencia_desde: Mapped[date | None] = mapped_column(Date)
    fecha_proxima_revision: Mapped[date | None] = mapped_column(Date)
    aprobado_por: Mapped[str | None] = mapped_column(Text)
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    hash_sha256: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(
        Text, server_default="vigente", nullable=False
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, server_default="{}", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
