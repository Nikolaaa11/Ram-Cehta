"""AI Asistente endpoints (V3 fase 3).

Todos los endpoints filtran por `user_id == me.sub` para que cada usuario sólo
acceda a SUS conversaciones (privacy-by-default). El acceso a empresas no
está restringido en V3 — todos los roles pueden chatear con cualquier empresa.

El endpoint `/chat` devuelve un Server-Sent Events stream para que el frontend
muestre la respuesta en tiempo real (UX tipo ChatGPT).
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.integration_repository import IntegrationRepository
from app.models.ai_conversation import AiConversation
from app.models.ai_message import AiMessage
from app.schemas.ai import (
    ChatRequest,
    ConversationCreate,
    ConversationRead,
    IndexStatus,
    IndexTriggerResponse,
    MessageRead,
)
from app.services.ai_chat_service import chat_stream
from app.services.ai_indexing_service import KB_ROOT_TEMPLATE, index_dropbox_folder
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

router = APIRouter()


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


@router.get(
    "/conversations",
    response_model=list[ConversationRead],
    dependencies=[Depends(require_scope("ai:read"))],
)
async def list_conversations(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=1, max_length=64)],
) -> list[ConversationRead]:
    """Lista las conversaciones del usuario actual en una empresa."""
    stmt = (
        select(AiConversation)
        .where(
            AiConversation.user_id == user.sub,
            AiConversation.empresa_codigo == empresa_codigo,
        )
        .order_by(AiConversation.updated_at.desc())
    )
    result = await db.scalars(stmt)
    return [ConversationRead.model_validate(c) for c in result.all()]


@router.post(
    "/conversations",
    response_model=ConversationRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def create_conversation(
    user: CurrentUser,
    db: DBSession,
    body: ConversationCreate,
) -> ConversationRead:
    conv = AiConversation(
        user_id=user.sub,
        empresa_codigo=body.empresa_codigo,
        title=body.title,
    )
    db.add(conv)
    await db.flush()
    await db.commit()
    await db.refresh(conv)
    return ConversationRead.model_validate(conv)


async def _get_user_conversation(
    db: DBSession, user: AuthenticatedUser, conversation_id: int
) -> AiConversation:
    """Devuelve la conv asegurando ownership; 404 si no es del user actual."""
    stmt = select(AiConversation).where(
        AiConversation.conversation_id == conversation_id,
        AiConversation.user_id == user.sub,
    )
    conv = (await db.scalars(stmt)).first()
    if conv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Conversación no encontrada"
        )
    return conv


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
    dependencies=[Depends(require_scope("ai:read"))],
)
async def list_messages(
    user: CurrentUser,
    db: DBSession,
    conversation_id: int,
) -> list[MessageRead]:
    conv = await _get_user_conversation(db, user, conversation_id)
    stmt = (
        select(AiMessage)
        .where(AiMessage.conversation_id == conv.conversation_id)
        .order_by(AiMessage.created_at.asc())
    )
    result = await db.scalars(stmt)
    return [MessageRead.model_validate(m) for m in result.all()]


@router.post(
    "/conversations/{conversation_id}/chat",
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def chat(
    user: CurrentUser,
    db: DBSession,
    conversation_id: int,
    body: ChatRequest,
) -> StreamingResponse:
    """Envía un mensaje y devuelve un stream SSE con la respuesta del LLM.

    Frames:
    - `{"type": "citations", "citations": [...]}` — al inicio, post vector search.
    - `{"type": "content_delta", "text": "..."}` — N veces durante stream.
    - `{"type": "done", "message_id": N, "citations": [...], "tokens_used": N}`.
    - `{"type": "error", "detail": "..."}` — en caso de fallo.
    """
    conv = await _get_user_conversation(db, user, conversation_id)

    return StreamingResponse(
        chat_stream(db=db, conversation=conv, user_message=body.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable nginx/Fly proxy buffering.
        },
    )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def delete_conversation(
    user: CurrentUser,
    db: DBSession,
    conversation_id: int,
) -> Response:
    conv = await _get_user_conversation(db, user, conversation_id)
    await db.delete(conv)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Indexing (admin)
# ---------------------------------------------------------------------------


@router.post(
    "/index/{empresa_codigo}",
    response_model=IndexTriggerResponse,
    dependencies=[Depends(require_scope("ai:index"))],
)
async def trigger_index(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> IndexTriggerResponse:
    """Re-indexa la KB Dropbox de la empresa. Admin-only."""
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — usar /dropbox/connect primero",
        )
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    result = await index_dropbox_folder(
        db=db, dropbox=dbx, empresa_codigo=empresa_codigo
    )
    await db.commit()
    return IndexTriggerResponse(**result)


@router.get(
    "/index/{empresa_codigo}/status",
    response_model=IndexStatus,
    dependencies=[Depends(require_scope("ai:read"))],
)
async def index_status(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> IndexStatus:
    """Cuenta de chunks + última indexación + lista de fuentes."""
    sql = text(
        """
        SELECT COUNT(*) AS total,
               MAX(indexed_at) AS last_indexed_at,
               ARRAY_AGG(DISTINCT source_id) FILTER (WHERE source_id IS NOT NULL) AS sources
        FROM core.ai_documents
        WHERE empresa_codigo = :e
        """
    )
    row: Any = (await db.execute(sql, {"e": empresa_codigo})).mappings().first()
    return IndexStatus(
        empresa_codigo=empresa_codigo,
        chunk_count=int(row["total"] or 0) if row else 0,
        last_indexed_at=row["last_indexed_at"] if row else None,
        sources=list(row["sources"] or []) if row else [],
    )


@router.get(
    "/index/{empresa_codigo}/folder-hint",
    dependencies=[Depends(require_scope("ai:read"))],
)
async def folder_hint(
    user: CurrentUser,
    empresa_codigo: str,
) -> dict[str, str]:
    """Devuelve la ruta canónica de la KB en Dropbox (utility para frontend)."""
    return {"folder_path": KB_ROOT_TEMPLATE.format(empresa=empresa_codigo)}
