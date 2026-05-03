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


# ─── V5 fase 1 — AI tools (tool calling) ────────────────────────────────


class AskRequest(BaseModel):
    """Una pregunta one-shot al asistente con tool calling habilitado."""

    question: str = Field(min_length=1, max_length=4000)
    write_mode: bool = Field(
        default=False,
        description=(
            "Si True, Claude puede mutar datos (marcar entregables). "
            "El frontend debe pedir confirmación explícita antes de "
            "habilitarlo."
        ),
    )


class AskToolCall(BaseModel):
    tool: str
    input: dict[str, object] = Field(default_factory=dict)
    output_preview: str = ""


class AskTokens(BaseModel):
    input: int = 0
    output: int = 0


class AskResponse(BaseModel):
    """Respuesta completa de `POST /ai/ask`."""

    answer: str
    tool_calls: list[AskToolCall] = Field(default_factory=list)
    iterations: int = 0
    tokens: AskTokens = Field(default_factory=AskTokens)


# ─── V5 fase 2 — AI Auto-Acta ───────────────────────────────────────────


class ActaGenerateRequest(BaseModel):
    """Pide a Claude que genere un draft de acta CV."""

    empresa: str | None = None  # Si null, acta general; si CSL/RHO/etc, scoped


class ActaDataSummary(BaseModel):
    ytd_total: int = 0
    ytd_entregados: int = 0
    tasa_cumplimiento: float = 0.0
    vencidos_count: int = 0
    proximos_30d_count: int = 0


class ActaGenerateResponse(BaseModel):
    """Markdown del acta + metadata para el frontend."""

    markdown: str
    generated_at: datetime
    empresa: str | None = None
    tokens: AskTokens = Field(default_factory=AskTokens)
    data_summary: ActaDataSummary = Field(default_factory=ActaDataSummary)


# ─── V5 fase 3 — AI Insights (anomaly detection) ────────────────────────


class AiInsight(BaseModel):
    """Un insight generado por la AI sobre patrones o anomalías."""

    severity: str  # critical / warning / info / positive
    title: str
    body: str
    recommendation: str = ""
    tags: list[str] = Field(default_factory=list)


class InsightsResponse(BaseModel):
    insights: list[AiInsight] = Field(default_factory=list)
    generated_at: datetime
    tokens: AskTokens = Field(default_factory=AskTokens)
    raw_response: str | None = None  # debug si JSON parse falló
    persisted_count: int = 0


class AiInsightRead(BaseModel):
    """Insight persistido en BD con metadata + estado per-admin."""

    insight_id: int
    severity: str
    title: str
    body: str
    recommendation: str
    tags: list[str] = Field(default_factory=list)
    read_at: datetime | None = None
    dismissed_at: datetime | None = None
    generated_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class AiInsightUpdate(BaseModel):
    """PATCH parcial para marcar leído / dismiss."""

    read: bool | None = None
    dismissed: bool | None = None


class ExecutiveSummaryResponse(BaseModel):
    """Resumen narrativo del portfolio (1-2 líneas) para CEO Dashboard."""

    summary: str
    generated_at: datetime
    tokens: AskTokens = Field(default_factory=AskTokens)


# ---------------------------------------------------------------------------
# V4 fase 8.2 — Secretaria AI de Tareas
# ---------------------------------------------------------------------------


class SecretariaBriefResponse(BaseModel):
    """Brief de la Secretaria AI: 5 bullets accionables del día.

    `cached=True` indica que la respuesta vino del cache de 30min (el
    frontend puede mostrar un indicador "actualizado hace X").
    """

    bullets: list[str] = Field(default_factory=list)
    raw_text: str
    model: str
    cached: bool = False
    generated_at: datetime
