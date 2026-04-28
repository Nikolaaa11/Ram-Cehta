"""Modelo `core.ai_messages` — V3 fase 3.

Cada mensaje pertenece a una conversación y tiene un `role` (`user`,
`assistant`, `system`). `citations` es un JSONB con la lista de chunk_ids
referenciados por el assistant (se hidrata en el frontend como badges).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AiMessage(Base):
    __tablename__ = "ai_messages"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    message_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.ai_conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    model: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    conversation: Mapped[Any] = relationship(
        "AiConversation", back_populates="messages"
    )
