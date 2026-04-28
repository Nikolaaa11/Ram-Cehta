"""Servicio de chat — RAG sobre la KB empresa-scoped y streaming via Anthropic.

Pipeline por mensaje:
1. Embed del query del usuario (`embed_text`).
2. Vector search en `core.ai_documents` filtrado por `empresa_codigo`,
   ranking por distancia coseno (`<=>` de pgvector). Top-k = 10 por default.
3. Construcción del system prompt con el contexto + reglas.
4. Llamada a Claude (`messages.stream`) con la conversación previa + user msg.
5. Yield incremental de los deltas como Server-Sent Events (`data: {...}\\n\\n`).
6. Al cerrar el stream, persistencia del par (user, assistant) en DB con
   `citations` (lista de chunks usados).

Decisiones notables:
- **System prompt** escrito en español, conciso, con regla "no inventes":
  forzamos al modelo a responder "no tengo info" si el contexto no cubre la
  pregunta. Crítico para confianza del usuario en un dominio financiero.
- **Citations**: incluimos sólo los chunks efectivamente vistos (top-k post-rank);
  el usuario decide si los abre. No pedimos al LLM que cite explícitamente —
  esa lógica vive del lado de presentación (tooltip con snippet).
- **Streaming protocol**: SSE con frames `{"type": "content_delta", "text": "..."}`.
  Al cerrar enviamos `{"type": "done", "message_id": N, "citations": [...]}` —
  el frontend usa eso para confirmar persistencia.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.ai_conversation import AiConversation
from app.models.ai_message import AiMessage
from app.services.ai_embedding_service import (
    EmbeddingNotConfigured,
    embed_text,
    vector_literal,
)

log = structlog.get_logger(__name__)


SYSTEM_PROMPT_TEMPLATE = """Eres el AI Asistente de Cehta Capital para la empresa {empresa}.

REGLAS:
- Responde SIEMPRE en español neutro.
- Solo respondes con base en el CONTEXTO provisto debajo. Si la respuesta no
  está ahí, responde literalmente: "No tengo información sobre eso en la base
  de conocimiento de {empresa}."
- Cita la fuente cuando sea posible mencionando el nombre del archivo
  (ej: "según el contrato 2025-03.pdf...").
- Sé conciso, directo, sin disclaimers innecesarios.
- Si la pregunta es ambigua, pide clarificación antes de inventar.

CONTEXTO:
{context}
"""


class AiChatNotConfigured(Exception):  # noqa: N818
    """`ANTHROPIC_API_KEY` ausente en el entorno backend."""


def _anthropic_client() -> Any:
    if not settings.anthropic_api_key:
        raise AiChatNotConfigured("ANTHROPIC_API_KEY no configurado en backend")
    from anthropic import AsyncAnthropic

    return AsyncAnthropic(api_key=settings.anthropic_api_key)


# ---------------------------------------------------------------------------
# Vector search
# ---------------------------------------------------------------------------


async def vector_search(
    db: AsyncSession,
    empresa_codigo: str,
    query_embedding: list[float],
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """Top-k chunks por similitud coseno (`<=>`) en `core.ai_documents`."""
    sql = text(
        """
        SELECT chunk_id, source_path, source_id, chunk_index, content,
               1 - (embedding <=> CAST(:q AS vector)) AS similarity
        FROM core.ai_documents
        WHERE empresa_codigo = :empresa
        ORDER BY embedding <=> CAST(:q AS vector)
        LIMIT :k
        """
    )
    result = await db.execute(
        sql,
        {
            "q": vector_literal(query_embedding),
            "empresa": empresa_codigo,
            "k": top_k,
        },
    )
    rows = result.mappings().all()
    return [dict(r) for r in rows]


def build_context(chunks: list[dict[str, Any]]) -> str:
    """Formatea chunks como bloques numerados con referencia al archivo."""
    if not chunks:
        return "(No hay documentos indexados todavía para esta empresa.)"
    parts = []
    for i, c in enumerate(chunks, start=1):
        src = c.get("source_id") or c.get("source_path") or "?"
        parts.append(f"[{i}] {src}\n{c['content']}")
    return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Streaming chat
# ---------------------------------------------------------------------------


def _sse_frame(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def chat_stream(
    *,
    db: AsyncSession,
    conversation: AiConversation,
    user_message: str,
) -> AsyncIterator[str]:
    """Async generator que yieldea SSE frames y persiste user + assistant al final."""
    # 1. Persistir user message YA (para que aparezca aún si el LLM falla)
    user_msg = AiMessage(
        conversation_id=conversation.conversation_id,
        role="user",
        content=user_message,
    )
    db.add(user_msg)
    await db.flush()
    await db.commit()

    # 2. Embed + vector search
    try:
        query_emb = await embed_text(user_message)
    except EmbeddingNotConfigured as exc:
        yield _sse_frame({"type": "error", "detail": str(exc)})
        return

    chunks = await vector_search(
        db, conversation.empresa_codigo, query_emb, top_k=settings.ai_max_context_chunks
    )
    citations = [
        {
            "chunk_id": int(c["chunk_id"]),
            "source_path": c.get("source_path"),
            "snippet": (c["content"][:200] + "...") if len(c["content"]) > 200 else c["content"],
        }
        for c in chunks
    ]

    # 3. Cargar historial (todos menos el último user msg, que ya está en `user_message`)
    history_q = text(
        """
        SELECT role, content
        FROM core.ai_messages
        WHERE conversation_id = :cid AND message_id < :mid
        ORDER BY created_at ASC
        """
    )
    history_rows = (
        await db.execute(history_q, {"cid": conversation.conversation_id, "mid": user_msg.message_id})
    ).mappings().all()
    messages_for_claude: list[dict[str, str]] = []
    for r in history_rows:
        if r["role"] in ("user", "assistant"):
            messages_for_claude.append({"role": r["role"], "content": r["content"]})
    messages_for_claude.append({"role": "user", "content": user_message})

    # 4. Stream desde Claude
    try:
        client = _anthropic_client()
    except AiChatNotConfigured as exc:
        yield _sse_frame({"type": "error", "detail": str(exc)})
        return

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        empresa=conversation.empresa_codigo,
        context=build_context(chunks),
    )

    yield _sse_frame({"type": "citations", "citations": citations})

    assistant_text = ""
    tokens_used = 0
    try:
        async with client.messages.stream(
            model=settings.ai_chat_model,
            max_tokens=settings.ai_max_response_tokens,
            system=system_prompt,
            messages=messages_for_claude,
        ) as stream:
            async for chunk in stream.text_stream:
                assistant_text += chunk
                yield _sse_frame({"type": "content_delta", "text": chunk})
            final = await stream.get_final_message()
            if hasattr(final, "usage") and final.usage:
                tokens_used = (
                    getattr(final.usage, "input_tokens", 0)
                    + getattr(final.usage, "output_tokens", 0)
                )
    except Exception as exc:  # noqa: BLE001
        log.error("ai.chat.stream_failed", error=str(exc))
        yield _sse_frame({"type": "error", "detail": f"LLM error: {exc}"})
        return

    # 5. Persistir assistant message + bump conversation.updated_at
    assistant_msg = AiMessage(
        conversation_id=conversation.conversation_id,
        role="assistant",
        content=assistant_text or "(respuesta vacía)",
        citations=citations,
        tokens_used=tokens_used or None,
        model=settings.ai_chat_model,
    )
    db.add(assistant_msg)

    # Si la conversación no tiene título, derivarlo del primer mensaje user.
    if not conversation.title:
        conversation.title = user_message[:80]

    await db.flush()
    await db.commit()

    yield _sse_frame(
        {
            "type": "done",
            "message_id": assistant_msg.message_id,
            "citations": citations,
            "tokens_used": tokens_used,
        }
    )
