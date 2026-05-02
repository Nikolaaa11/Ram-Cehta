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
    ActaGenerateRequest,
    ActaGenerateResponse,
    AiInsightRead,
    AiInsightUpdate,
    AskRequest,
    AskResponse,
    AskTokens,
    AskToolCall,
    ChatRequest,
    ConversationCreate,
    ConversationRead,
    IndexStatus,
    IndexTriggerResponse,
    InsightsResponse,
    MessageRead,
)
from app.services.ai_chat_service import chat_stream
from app.services.ai_indexing_service import KB_ROOT_TEMPLATE, index_dropbox_folder
from app.services.ai_tools_service import (
    AiToolsNotConfiguredError,
    ask,
    ask_stream,
    generate_acta_cv_draft,
    generate_insights,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

router = APIRouter()


# ─── V5 fase 1 — Q&A con tool calling sobre datos estructurados ─────────


@router.post(
    "/ask",
    response_model=AskResponse,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_ask(
    user: CurrentUser,
    db: DBSession,
    body: AskRequest,
) -> AskResponse:
    """Pregunta one-shot al AI sobre entregables / compliance / pipeline.

    Usa Anthropic tool calling: el modelo decide qué tools ejecutar contra
    la base, y devuelve una respuesta consolidada con la traza de calls.

    No persiste conversación (a diferencia de `/chat`) — pensado para
    queries puntuales tipo "qué entregables vencen esta semana?".

    Devuelve 503 si `ANTHROPIC_API_KEY` no está configurado.
    """
    try:
        result = await ask(
            db,
            body.question,
            write_mode=body.write_mode,
            user_id=user.sub,
        )
    except AiToolsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return AskResponse(
        answer=result["answer"],
        tool_calls=[
            AskToolCall(
                tool=tc["tool"],
                input=tc.get("input") or {},
                output_preview=tc.get("output_preview") or "",
            )
            for tc in result.get("tool_calls", [])
        ],
        iterations=result.get("iterations", 0),
        tokens=AskTokens(
            input=result["tokens"]["input"],
            output=result["tokens"]["output"],
        ),
    )


@router.post(
    "/ask/stream",
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_ask_stream(
    user: CurrentUser,
    db: DBSession,
    body: AskRequest,
) -> StreamingResponse:
    """V5 fase 5 — Versión streaming de `/ai/ask`.

    Devuelve un Server-Sent Events stream con frames por cada paso del
    loop de tool calling:
      - `iteration` — al inicio de cada iteración
      - `tool_use` — Claude pide ejecutar una tool (input visible)
      - `tool_result` — la tool devolvió su resultado (preview)
      - `thinking` — texto intermedio que Claude escribe entre tools
      - `answer` — texto final cuando termina
      - `done` — cierre con tokens totales
      - `error` — en caso de fallo

    El frontend lo consume con `EventSource` o `fetch + ReadableStream` y
    renderea cada frame en tiempo real, dando feedback visible al usuario
    de "qué está haciendo Claude".
    """
    return StreamingResponse(
        ask_stream(
            db,
            body.question,
            write_mode=body.write_mode,
            user_id=user.sub,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx/Fly buffering
        },
    )


@router.post(
    "/acta/generate",
    response_model=ActaGenerateResponse,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_generate_acta(
    user: CurrentUser,
    db: DBSession,
    body: ActaGenerateRequest,
) -> ActaGenerateResponse:
    """Genera un draft de acta del Comité de Vigilancia con AI.

    Pull de datos reales (vencidos, próximos, compliance) → context → Claude
    devuelve markdown estructurado de acta lista para revisar y firmar.

    Si `empresa` se pasa, el acta es scoped a esa empresa específica.
    """
    try:
        result = await generate_acta_cv_draft(db, empresa=body.empresa)
    except AiToolsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return ActaGenerateResponse.model_validate(result)


@router.post(
    "/insights/generate",
    response_model=InsightsResponse,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_insights_generate(
    user: CurrentUser,
    db: DBSession,
) -> InsightsResponse:
    """V5 fase 3 — Genera insights proactivos vía Claude.

    Pull consolidado de compliance + workload + templates fallidos +
    concentración → Claude identifica hasta 5 anomalías relevantes.

    Pensado para correr nightly (cron) y persistirse en BD para que el
    operador encuentre los insights en su próxima sesión. En V5.3 inicial,
    se llama on-demand desde el frontend admin.

    Devuelve 503 si `ANTHROPIC_API_KEY` no está configurado.
    """
    try:
        result = await generate_insights(db)
    except AiToolsNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return InsightsResponse.model_validate(result)


@router.get(
    "/insights",
    response_model=list[AiInsightRead],
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_insights_list(
    user: CurrentUser,
    db: DBSession,
    include_dismissed: bool = Query(
        False,
        description="Si True, incluye los insights archivados",
    ),
    limit: int = Query(50, ge=1, le=200),
) -> list[AiInsightRead]:
    """Lista insights persistidos. Por default solo los abiertos (no dismissed).

    Devuelve más recientes primero. El frontend lo muestra como inbox.
    """
    where = "" if include_dismissed else "WHERE dismissed_at IS NULL"
    rows = (
        await db.execute(
            text(
                f"""
                SELECT insight_id, severity, title, body, recommendation, tags,
                       read_at, dismissed_at, generated_at, created_at
                FROM app.ai_insights
                {where}
                ORDER BY
                  CASE severity
                    WHEN 'critical' THEN 0
                    WHEN 'warning' THEN 1
                    WHEN 'info' THEN 2
                    WHEN 'positive' THEN 3
                    ELSE 4
                  END,
                  created_at DESC
                LIMIT :lim
                """
            ),
            {"lim": limit},
        )
    ).mappings().all()
    return [
        AiInsightRead(
            insight_id=int(r["insight_id"]),
            severity=str(r["severity"]),
            title=str(r["title"]),
            body=str(r["body"] or ""),
            recommendation=str(r["recommendation"] or ""),
            tags=list(r["tags"] or []) if isinstance(r["tags"], list) else [],
            read_at=r["read_at"],
            dismissed_at=r["dismissed_at"],
            generated_at=r["generated_at"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.patch(
    "/insights/{insight_id}",
    response_model=AiInsightRead,
    dependencies=[Depends(require_scope("ai:chat"))],
)
async def ai_insight_update(
    user: CurrentUser,
    db: DBSession,
    insight_id: int,
    body: AiInsightUpdate,
) -> AiInsightRead:
    """Marca un insight como leído o dismissed.

    Idempotente: si ya está marcado, no falla. Setear `read=False` o
    `dismissed=False` resetea el timestamp.
    """
    sets: list[str] = ["updated_at = now()"]
    params: dict[str, object] = {"id": insight_id}

    if body.read is not None:
        if body.read:
            sets.append("read_at = COALESCE(read_at, now())")
        else:
            sets.append("read_at = NULL")
    if body.dismissed is not None:
        if body.dismissed:
            sets.append("dismissed_at = COALESCE(dismissed_at, now())")
        else:
            sets.append("dismissed_at = NULL")

    await db.execute(
        text(
            f"UPDATE app.ai_insights SET {', '.join(sets)} "
            "WHERE insight_id = :id"
        ),
        params,
    )
    await db.commit()

    row = (
        await db.execute(
            text(
                """
                SELECT insight_id, severity, title, body, recommendation, tags,
                       read_at, dismissed_at, generated_at, created_at
                FROM app.ai_insights WHERE insight_id = :id
                """
            ),
            {"id": insight_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Insight no encontrado"
        )
    return AiInsightRead(
        insight_id=int(row["insight_id"]),
        severity=str(row["severity"]),
        title=str(row["title"]),
        body=str(row["body"] or ""),
        recommendation=str(row["recommendation"] or ""),
        tags=list(row["tags"] or []) if isinstance(row["tags"], list) else [],
        read_at=row["read_at"],
        dismissed_at=row["dismissed_at"],
        generated_at=row["generated_at"],
        created_at=row["created_at"],
    )


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
