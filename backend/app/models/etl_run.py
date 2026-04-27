"""Modelo EtlRun — `audit.etl_runs`.

Trazabilidad de cada corrida ETL del Excel madre. Inmutable desde la app:
solo lectura para admins (Disciplina Auditoría).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EtlRun(Base):
    __tablename__ = "etl_runs"
    __table_args__ = {"schema": "audit"}

    run_id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_file: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str | None] = mapped_column(Text)
    rows_extracted: Mapped[int | None] = mapped_column(Integer)
    rows_loaded: Mapped[int | None] = mapped_column(Integer)
    rows_rejected: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    triggered_by: Mapped[str | None] = mapped_column(Text, server_default="scheduled")
