"""Modelo `core.ai_documents` — V3 fase 3.

Cada fila es un *chunk* de un documento de la knowledge base de una empresa,
con su embedding (vector(1536) en Postgres) y metadata. La búsqueda por
similitud se hace via SQL crudo en `ai_chat_service.vector_search` (con
operador `<=>` de pgvector) en lugar de mapearlo en el ORM — más simple
y nos evita una dependencia hard de `pgvector.sqlalchemy` en el modelo.

La columna `embedding` queda mapeada como `Text` opaco a nivel ORM; el
service convierte `list[float] -> str` (literal `'[0.1, 0.2, ...]'::vector`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AiDocument(Base):
    __tablename__ = "ai_documents"
    __table_args__ = {"schema": "core"}  # noqa: RUF012

    chunk_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    empresa_codigo: Mapped[str] = mapped_column(
        Text, ForeignKey("core.empresas.codigo"), nullable=False
    )
    source_type: Mapped[str] = mapped_column(Text, nullable=False)
    source_path: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[str | None] = mapped_column(Text)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # `embedding` no se mapea en el ORM — se maneja con SQL crudo en el service.
    metadata_: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    indexed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
