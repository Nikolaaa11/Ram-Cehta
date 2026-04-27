"""Modelo RejectedRow — `audit.rejected_rows`.

Filas rechazadas por el ETL con razón estructurada. Read-only desde la app.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RejectedRow(Base):
    __tablename__ = "rejected_rows"
    __table_args__ = {"schema": "audit"}

    rejected_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("audit.etl_runs.run_id", ondelete="CASCADE"),
    )
    source_sheet: Mapped[str | None] = mapped_column(Text)
    source_row_num: Mapped[int | None] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text)
    raw_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
