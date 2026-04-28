"""Modelo `core.ai_conversations` — V3 fase 3 (AI Asistente por empresa).

Una conversación pertenece a un único `(user_id, empresa_codigo)`. El backend
filtra por `user_id == me.sub` para garantizar que cada usuario sólo vea sus
propias conversaciones.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class AiConversation(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    conversation_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    messages: Mapped[list[AiMessage]] = relationship(
        "AiMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AiMessage.created_at",
        lazy="selectin",
    )


# Forward-ref import to avoid circular import at module load.
from app.models.ai_message import AiMessage  # noqa: E402
