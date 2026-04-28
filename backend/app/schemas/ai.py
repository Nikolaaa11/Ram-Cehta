"""Schemas Pydantic para el AI Asistente (V3 fase 3)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    empresa_codigo: str = Field(min_length=1, max_length=64)
    title: str | None = Field(default=None, max_length=200)


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    conversation_id: int
    user_id: str
    empresa_codigo: str
    title: str | None
    created_at: datetime
    updated_at: datetime


class Citation(BaseModel):
    chunk_id: int
    source_path: str | None = None
    snippet: str | None = None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    message_id: int
    conversation_id: int
    role: Literal["user", "assistant", "system"]
    content: str
    citations: list[dict[str, Any]] | None = None
    tokens_used: int | None = None
    model: str | None = None
    created_at: datetime


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class IndexStatus(BaseModel):
    empresa_codigo: str
    chunk_count: int
    last_indexed_at: datetime | None
    sources: list[str] = Field(default_factory=list)


class IndexTriggerResponse(BaseModel):
    empresa_codigo: str
    folder_path: str
    files_processed: int
    chunks_created: int
    skipped: list[str] = Field(default_factory=list)
