"""Server-Sent Events stream (V4 fase 2 — real-time updates).

GET /api/v1/stream/events
    Conexión long-lived. El servidor empuja eventos a medida que ocurren.
    Replaza el polling cada 60s del bell badge + audit log feed.

Auth:
    EventSource del browser NO soporta headers custom, así que aceptamos
    el JWT por query param `?token=...` además del header `Authorization`.
    El header sigue siendo válido para clientes que sí pueden setearlo
    (curl, tests, fetch con streaming).

Channels (event types):
    notification.created  → notif nueva (filter: por user_id)
    notification.read     → notif marcada leída (filter: por user_id)
    audit.action          → audit log entry (filter: role=admin)
    etl.completed         → ETL run finalizó OK (filter: role=admin)
    etl.failed            → ETL run falló (filter: role=admin)
    system.heartbeat      → ping interno cada 30s (broadcast)

Soft-fail:
    Si `sse-starlette` no está instalado, devolvemos 503 con mensaje útil.
    Si hay un error inesperado durante el setup de la conexión, también
    503. Una vez establecida, los errores en la queue se loggean — la
    conexión se cierra limpiamente y el cliente reconecta.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from app.core.security import (
    AuthenticatedUser,
    InvalidTokenError,
    decode_supabase_jwt,
)
from app.services.event_broadcaster import (
    Subscription,
    get_broadcaster,
)

log = structlog.get_logger(__name__)

router = APIRouter()

# Intervalo de keep-alive: enviamos un comment ": ping\n\n" cada N seg
# para que el browser no cierre la conexión por idle timeout (proxies
# como nginx/cloudflare suelen cortar a los 60s sin tráfico).
KEEPALIVE_INTERVAL_S = 30.0

# Tope de tiempo que esperamos un evento antes de enviar un keepalive.
# Coincide con KEEPALIVE_INTERVAL_S — si pasan 30s sin eventos, ping.
QUEUE_GET_TIMEOUT_S = KEEPALIVE_INTERVAL_S


def _resolve_user(
    authorization: str | None,
    token_query: str | None,
) -> AuthenticatedUser:
    """Resuelve el user a partir del header Authorization O del query param.

    EventSource no permite setear headers, entonces aceptamos `?token=...`.
    Si vienen los dos, gana el header (más estándar).
    """
    raw_token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()
    elif token_query:
        raw_token = token_query.strip()

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token (use Authorization header or ?token= query param)",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return decode_supabase_jwt(raw_token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def _event_generator(
    request: Request,
    subscription: Subscription,
) -> AsyncIterator[dict[str, Any]]:
    """Yields eventos para sse-starlette.

    Cada yield es un dict con:
        event: nombre del canal (ej "notification.created")
        data:  string JSON con el payload

    Cuando no hay eventos por `KEEPALIVE_INTERVAL_S`, mandamos un comment
    para mantener viva la conexión (sse-starlette acepta el campo
    `comment` para esto).

    El loop termina cuando el cliente se desconecta — detectamos vía
    `request.is_disconnected()`.
    """
    # Hello inicial: notifica al cliente que la conexión está activa.
    yield {
        "event": "system.connected",
        "data": json.dumps({"user_id": subscription.user_id}),
    }

    while True:
        if await request.is_disconnected():
            log.info("sse_client_disconnected", user_id=subscription.user_id)
            return

        try:
            event = await asyncio.wait_for(
                subscription.queue.get(),
                timeout=QUEUE_GET_TIMEOUT_S,
            )
        except TimeoutError:
            # Sin eventos en la ventana — keepalive comment.
            yield {"comment": "ping"}
            continue
        except asyncio.CancelledError:  # pragma: no cover — shutdown
            return
        except Exception as exc:  # pragma: no cover — defensivo
            log.warning(
                "sse_queue_error",
                user_id=subscription.user_id,
                error=str(exc),
            )
            return

        # Serializamos el data; sse-starlette se encarga del framing.
        try:
            data_json = json.dumps(event.get("data", {}), default=str)
        except Exception as exc:  # pragma: no cover
            log.warning(
                "sse_serialize_failed",
                channel=event.get("channel"),
                error=str(exc),
            )
            continue

        yield {
            "event": event.get("channel", "message"),
            "data": data_json,
        }


@router.get("/events")
async def stream_events(
    request: Request,
    authorization: Annotated[str | None, Query(alias="_authorization")] = None,
    token: Annotated[str | None, Query()] = None,
) -> Any:
    """Endpoint principal del stream SSE.

    Auth: header `Authorization: Bearer <jwt>` O query `?token=<jwt>`.

    El response es `text/event-stream`. El cliente típico es
    `new EventSource('/api/v1/stream/events?token=...')` desde el frontend.
    """
    # Header real desde la request (FastAPI no nos lo pasa por el
    # `authorization` query alias — ese alias es por si alguien quiere
    # debug-ear con curl pasando ambos. Usamos request.headers como
    # fuente canónica del header).
    header_value = request.headers.get("authorization")
    user = _resolve_user(header_value, token)

    # Import lazy: si sse-starlette no está instalado, devolvemos 503
    # sin tumbar otros endpoints que comparten el módulo.
    try:
        from sse_starlette.sse import EventSourceResponse
    except ImportError:
        log.error("sse_starlette_not_installed")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "detail": (
                    "Real-time updates no disponibles: 'sse-starlette' no "
                    "está instalado en el server."
                )
            },
        )

    broadcaster = get_broadcaster()

    try:
        subscription = broadcaster.subscribe(
            user_id=user.sub,
            role=user.app_role,
        )
    except Exception as exc:
        log.exception("sse_subscribe_failed", user_id=user.sub)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": f"No se pudo abrir el stream: {exc}"},
        )

    async def gen() -> AsyncIterator[dict[str, Any]]:
        try:
            async for evt in _event_generator(request, subscription):
                yield evt
        finally:
            # Cleanup: el cliente se desconectó (manual close, network drop,
            # browser cerró el tab). Removemos la queue para no leak memory.
            broadcaster.unsubscribe(subscription)

    return EventSourceResponse(
        gen(),
        ping=int(KEEPALIVE_INTERVAL_S),
        # Recomendar al browser reconectar a 1s si la conexión cae.
        # Combinado con backoff del cliente (1s, 2s, 4s, ...) da una
        # experiencia robusta.
        headers={"Cache-Control": "no-cache"},
    )
