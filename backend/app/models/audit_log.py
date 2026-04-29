"""Modelo `audit.action_log` (V3 fase 8 — audit log per-action).

Trazabilidad granular: cada mutación que pasa por la API queda con una
fila acá con quién, cuándo, qué entidad, qué cambió (diff JSON antes/
después), IP y user-agent. La inserción es best-effort (try/except en el
service) — nunca debe romper la mutación si falla el insert.

Schema `audit` ya existe (lo usan `audit.etl_runs` y `audit.rejected_rows`).

Nota sobre `entity_id`: lo guardamos como TEXT (no int/uuid concreto)
porque las entidades del sistema mezclan tipos: `oc_id` int, `f29_id`
int, `documento_id` int, `codigo` str (empresas), `empresa_codigo` str
(en sync de F29 batch), `suscripcion_id` int, etc. Centralizar en TEXT
permite filtrar uniformemente desde la UI.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ActionLog(Base):
    __tablename__ = "action_log"
    __table_args__ = (
        Index(
            "idx_action_log_entity",
            "entity_type",
            "entity_id",
            "created_at",
        ),
        Index("idx_action_log_user", "user_id", "created_at"),
        Index("idx_action_log_created", "created_at"),
        Index("idx_action_log_action", "action", "created_at"),
        {"schema": "audit"},
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    user_email: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str] = mapped_column(Text, nullable=False)
    entity_label: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    diff_before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    diff_after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
