"""Modelo `core.fondo_actas` — Actas formales del FIP CEHTA (V5).

Distinto de `core.legal_documents` con `categoria='acta'` (que es por
empresa portfolio) — estas son actas del fondo: Directorio AFIS,
Comité de Inversión, Asamblea de LPs, Comités de Vigilancia y Riesgo.
Sin FK a empresas.

Migración: alembic/versions/0031_fondo_actas.py.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FondoActa(Base):
    __tablename__ = "fondo_actas"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    acta_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    tipo_organo: Mapped[str] = mapped_column(Text, nullable=False)
    numero_acta: Mapped[int] = mapped_column(Integer, nullable=False)
    fecha_reunion: Mapped[date] = mapped_column(Date, nullable=False)
    lugar: Mapped[str | None] = mapped_column(Text)
    quorum: Mapped[int | None] = mapped_column(Integer)
    quorum_total: Mapped[int | None] = mapped_column(Integer)
    presidente: Mapped[str | None] = mapped_column(Text)
    secretario: Mapped[str | None] = mapped_column(Text)
    asistentes: Mapped[list[Any]] = mapped_column(
        JSONB, server_default="[]", nullable=False
    )
    temario: Mapped[str | None] = mapped_column(Text)
    acuerdos: Mapped[list[Any]] = mapped_column(
        JSONB, server_default="[]", nullable=False
    )
    dropbox_path: Mapped[str | None] = mapped_column(Text)
    hash_sha256: Mapped[str | None] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(
        Text, server_default="borrador", nullable=False
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
