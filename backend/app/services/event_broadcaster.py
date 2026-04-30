"""In-memory pub/sub para Server-Sent Events (V4 fase 2).

Un broadcaster module-level que mantiene una `asyncio.Queue` por suscriptor
(SSE connection). Cuando un servicio publica un evento, se enrutan a las
queues relevantes según filtros.

Filtros soportados (en `publish`):
    * `user_id`  → sólo queues de ese usuario.
    * `role`     → sólo queues con ese app_role (admin-only events).
    * sin filtro → broadcast a todos los suscriptores (system-wide).

Soporta múltiples queues por user_id (mismo usuario con varias pestañas).
Cada queue es independiente — si una pestaña cierra, las otras siguen
recibiendo eventos.

CONSTRAINTS:
    * In-memory: si el backend reinicia, los clients se reconectan vía
      EventSource y reciben eventos desde ese momento — los perdidos no
      se replayan.
    * Single-instance: este pubsub vive en el proceso. Para escalar a
      múltiples instancias (multi-Fly) hay que migrar a redis-pubsub
      (mismo contrato, distinto backend de transport).
    * Soft-fail: ningún `publish()` debe levantar excepción al caller.
      Los errores en una queue particular se loggean pero no rompen el
      resto del fanout.

API:
    broadcaster = get_broadcaster()
    queue = broadcaster.subscribe(user_id="abc", role="admin")
    try:
        async for evt in queue_iterator(queue):
            ...
    finally:
        broadcaster.unsubscribe(user_id, queue)

    # Desde otro servicio:
    await broadcaster.publish("notification.created", {...}, user_id="abc")
"""
from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Any

import structlog

log = structlog.get_logger(__name__)

# Tamaño máximo de la queue por suscriptor. Si un cliente se queda atrás
# (latencia red, browser pausado), eventualmente la queue se llena y
# empezamos a descartar eventos viejos para no bloquear los publish().
QUEUE_MAX_SIZE = 100


@dataclass
class Subscription:
    """Una conexión SSE activa.

    `queue` es donde el broadcaster pone los eventos a entregar.
    `user_id` y `role` se usan para filtrar publishes con scope.
    """

    user_id: str
    role: str | None = None
    queue: asyncio.Queue[dict[str, Any]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=QUEUE_MAX_SIZE)
    )


class EventBroadcaster:
    """Pub/sub in-memory para SSE.

    Thread-safe NO requerido — todo corre en el event loop. Si en el
    futuro se llama desde threads, hay que envolver con `asyncio.Lock`.
    """

    def __init__(self) -> None:
        # Lista plana de suscripciones. La búsqueda por user_id es O(N)
        # pero N es pequeño (cantidad de pestañas activas).
        self._subscriptions: list[Subscription] = []

    # ------------------------------------------------------------------
    # Subscribe / unsubscribe
    # ------------------------------------------------------------------

    def subscribe(
        self,
        user_id: str,
        role: str | None = None,
    ) -> Subscription:
        """Registra una nueva queue para este user.

        Devuelve la Subscription; el caller debe pasársela a
        `unsubscribe()` cuando cierre la conexión.
        """
        sub = Subscription(user_id=user_id, role=role)
        self._subscriptions.append(sub)
        log.info(
            "sse_subscribe",
            user_id=user_id,
            role=role,
            total=len(self._subscriptions),
        )
        return sub

    def unsubscribe(self, subscription: Subscription) -> None:
        """Remueve una queue específica del map.

        Idempotente — si la subscription ya no está, no levanta. Importa
        cuando la conexión se corta inesperadamente y la cleanup corre
        dos veces.
        """
        try:
            self._subscriptions.remove(subscription)
        except ValueError:
            return
        log.info(
            "sse_unsubscribe",
            user_id=subscription.user_id,
            total=len(self._subscriptions),
        )

    # ------------------------------------------------------------------
    # Publish
    # ------------------------------------------------------------------

    async def publish(
        self,
        channel: str,
        payload: dict[str, Any],
        *,
        user_id: str | None = None,
        role: str | None = None,
    ) -> int:
        """Publica un evento a las queues que matcheen los filtros.

        Reglas de matching (en orden de precedencia):
            1. Si `user_id` está → matchear sólo subs con ese user_id.
            2. Si `role` está → matchear sólo subs con ese role.
            3. Sin filtro → todas las subs.

        `user_id` y `role` no se combinan: si pasás los dos, gana
        `user_id` (el caso típico de "este evento es para este user
        específico" es más restrictivo que "para este rol").

        Devuelve la cantidad de queues que recibieron el evento.

        Soft-fail: si una queue está llena, descartamos el evento más
        viejo y reintentamos. Si igual falla, loggeamos warning y
        seguimos con las demás.
        """
        event = {"channel": channel, "data": payload}

        if user_id is not None:
            targets = [s for s in self._subscriptions if s.user_id == user_id]
        elif role is not None:
            targets = [s for s in self._subscriptions if s.role == role]
        else:
            targets = list(self._subscriptions)

        delivered = 0
        for sub in targets:
            try:
                if sub.queue.full():
                    # Descartá el más viejo para no bloquear publish().
                    with contextlib.suppress(asyncio.QueueEmpty):
                        sub.queue.get_nowait()
                sub.queue.put_nowait(event)
                delivered += 1
            except Exception as exc:  # pragma: no cover — defensivo
                log.warning(
                    "sse_publish_failed",
                    channel=channel,
                    user_id=sub.user_id,
                    error=str(exc),
                )

        if delivered:
            log.debug(
                "sse_publish",
                channel=channel,
                delivered=delivered,
                total=len(self._subscriptions),
            )
        return delivered

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    @property
    def subscriber_count(self) -> int:
        """Útil para tests + status dashboard."""
        return len(self._subscriptions)

    def clear(self) -> None:
        """Reset total — sólo para tests."""
        self._subscriptions.clear()


# Singleton module-level. Importarlo via `get_broadcaster()` en lugar de
# `from .event_broadcaster import _BROADCASTER` para que los tests puedan
# monkeypatchear si hace falta.
_BROADCASTER = EventBroadcaster()


def get_broadcaster() -> EventBroadcaster:
    """Accessor del singleton.

    Mantenelo pequeño y simple — la idea es que cualquier servicio pueda
    hacer `from app.services.event_broadcaster import get_broadcaster`
    y publicar sin importar el orden de inicialización.
    """
    return _BROADCASTER


__all__ = [
    "EventBroadcaster",
    "Subscription",
    "get_broadcaster",
]
