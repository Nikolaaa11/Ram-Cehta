"""Servicio de embeddings — wraps OpenAI `text-embedding-3-small`.

Decisiones:
- Modelo: `text-embedding-3-small` (1536 dims, $0.02 por 1M tokens). Es el sweet
  spot calidad/costo para QA empresarial; `large` (3072 dims) duplica el storage
  por chunk y la mejora marginal no justifica el costo en V3.
- Batching: la API soporta hasta 2048 inputs por request, pero para evitar
  payloads gigantes y rate-limit transient errors, hard-cap interno en 100.
- Fallback explícito: si `OPENAI_API_KEY` no está seteado, lanzamos
  `EmbeddingNotConfigured` y el handler HTTP traduce a 503 con mensaje claro.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import structlog

from app.core.config import settings

if TYPE_CHECKING:  # pragma: no cover
    from openai import AsyncOpenAI

log = structlog.get_logger(__name__)

EMBEDDING_BATCH_SIZE = 100


class EmbeddingNotConfigured(Exception):  # noqa: N818 — alineado con DropboxNotConfigured
    """`OPENAI_API_KEY` ausente en el entorno backend."""


def _client() -> "AsyncOpenAI":
    if not settings.openai_api_key:
        raise EmbeddingNotConfigured(
            "OPENAI_API_KEY no configurado en backend (requerido para embeddings)"
        )
    # Import perezoso para que el módulo no rompa al importarse en entornos
    # sin la dependencia instalada (p.ej. CI mínimo).
    from openai import AsyncOpenAI

    return AsyncOpenAI(api_key=settings.openai_api_key)


async def embed_text(text: str) -> list[float]:
    """Embedding único — uso típico: query del usuario en chat."""
    client = _client()
    resp = await client.embeddings.create(
        model=settings.ai_embedding_model,
        input=text,
    )
    return list(resp.data[0].embedding)


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embeddings batched — uso típico: indexación de documentos.

    Itera en lotes de `EMBEDDING_BATCH_SIZE` para evitar payloads excesivos.
    Mantiene el orden de entrada → fundamental para mapear a chunks.
    """
    if not texts:
        return []
    client = _client()
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBEDDING_BATCH_SIZE):
        batch = texts[i : i + EMBEDDING_BATCH_SIZE]
        resp = await client.embeddings.create(
            model=settings.ai_embedding_model,
            input=batch,
        )
        out.extend(list(item.embedding) for item in resp.data)
        log.debug("ai.embed_batch", batch_size=len(batch), processed=i + len(batch))
    return out


def vector_literal(embedding: list[float]) -> str:
    """Serializa un vector a literal aceptado por pgvector ('[0.1,0.2,...]')."""
    return "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"
