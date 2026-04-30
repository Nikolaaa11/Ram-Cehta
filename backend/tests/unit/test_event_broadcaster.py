"""Unit tests para `app.services.event_broadcaster` (V4 fase 2).

Cubre los invariantes públicos del pub/sub in-memory que sustenta el
endpoint SSE `/api/v1/stream/events`:

  * subscribe + publish + receive en el mismo proceso (async).
  * Filter por user_id (otros usuarios no reciben).
  * Filter por role (sólo el role matcheado recibe).
  * Wildcard publish (sin filtro) → todos reciben.
  * Unsubscribe remueve la queue del map (idempotente).
  * Múltiples queues por user_id (varias pestañas).
  * Queue full → drop oldest, publish no bloquea.

No usamos red ni HTTP — todo in-memory con asyncio.
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.event_broadcaster import (
    QUEUE_MAX_SIZE,
    EventBroadcaster,
    Subscription,
    get_broadcaster,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def broadcaster() -> EventBroadcaster:
    """Instancia limpia por test (no reusamos el singleton para isolar)."""
    return EventBroadcaster()


# ---------------------------------------------------------------------------
# Subscribe / unsubscribe
# ---------------------------------------------------------------------------


def test_subscribe_returns_subscription_and_increments_count(
    broadcaster: EventBroadcaster,
) -> None:
    assert broadcaster.subscriber_count == 0
    sub = broadcaster.subscribe(user_id="u1")
    assert isinstance(sub, Subscription)
    assert sub.user_id == "u1"
    assert broadcaster.subscriber_count == 1


def test_unsubscribe_removes_from_map(
    broadcaster: EventBroadcaster,
) -> None:
    sub = broadcaster.subscribe(user_id="u1")
    assert broadcaster.subscriber_count == 1
    broadcaster.unsubscribe(sub)
    assert broadcaster.subscriber_count == 0


def test_unsubscribe_is_idempotent(
    broadcaster: EventBroadcaster,
) -> None:
    """Llamar unsubscribe dos veces sobre la misma sub no debe levantar."""
    sub = broadcaster.subscribe(user_id="u1")
    broadcaster.unsubscribe(sub)
    # No debe romper:
    broadcaster.unsubscribe(sub)
    assert broadcaster.subscriber_count == 0


def test_clear_resets_all_subscriptions(
    broadcaster: EventBroadcaster,
) -> None:
    broadcaster.subscribe(user_id="u1")
    broadcaster.subscribe(user_id="u2")
    broadcaster.clear()
    assert broadcaster.subscriber_count == 0


# ---------------------------------------------------------------------------
# Publish: filter by user_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_filtered_by_user_id_only_reaches_target(
    broadcaster: EventBroadcaster,
) -> None:
    sub_a = broadcaster.subscribe(user_id="alice")
    sub_b = broadcaster.subscribe(user_id="bob")

    delivered = await broadcaster.publish(
        "notification.created",
        {"hello": "alice"},
        user_id="alice",
    )

    assert delivered == 1
    # Alice recibió.
    assert sub_a.queue.qsize() == 1
    evt = sub_a.queue.get_nowait()
    assert evt["channel"] == "notification.created"
    assert evt["data"] == {"hello": "alice"}
    # Bob NO recibió.
    assert sub_b.queue.qsize() == 0


# ---------------------------------------------------------------------------
# Publish: filter by role
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_filtered_by_role_only_reaches_matching_role(
    broadcaster: EventBroadcaster,
) -> None:
    admin_sub = broadcaster.subscribe(user_id="alice", role="admin")
    finance_sub = broadcaster.subscribe(user_id="bob", role="finance")
    viewer_sub = broadcaster.subscribe(user_id="carl", role="viewer")

    delivered = await broadcaster.publish(
        "audit.action",
        {"action": "update", "summary": "OC editada"},
        role="admin",
    )

    assert delivered == 1
    assert admin_sub.queue.qsize() == 1
    assert finance_sub.queue.qsize() == 0
    assert viewer_sub.queue.qsize() == 0


# ---------------------------------------------------------------------------
# Publish: wildcard (no filter) reaches all
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_wildcard_reaches_all_subscribers(
    broadcaster: EventBroadcaster,
) -> None:
    a = broadcaster.subscribe(user_id="u1", role="admin")
    b = broadcaster.subscribe(user_id="u2", role="finance")
    c = broadcaster.subscribe(user_id="u3", role="viewer")

    delivered = await broadcaster.publish(
        "system.heartbeat",
        {"ts": 12345},
    )

    assert delivered == 3
    assert a.queue.qsize() == 1
    assert b.queue.qsize() == 1
    assert c.queue.qsize() == 1


# ---------------------------------------------------------------------------
# Publish: precedence — user_id wins over role
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_user_id_takes_precedence_over_role(
    broadcaster: EventBroadcaster,
) -> None:
    """Si vienen ambos filtros, user_id es más restrictivo y gana."""
    # Alice es admin; Bob es admin pero no debería recibir (la publish
    # tiene user_id="alice").
    alice = broadcaster.subscribe(user_id="alice", role="admin")
    bob = broadcaster.subscribe(user_id="bob", role="admin")

    delivered = await broadcaster.publish(
        "notification.read",
        {"id": "x"},
        user_id="alice",
        role="admin",
    )

    assert delivered == 1
    assert alice.queue.qsize() == 1
    assert bob.queue.qsize() == 0


# ---------------------------------------------------------------------------
# Multiple queues per user_id (multiple browser tabs)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_multiple_subscriptions_per_user_all_receive(
    broadcaster: EventBroadcaster,
) -> None:
    """Mismo user con varias pestañas → todas deben recibir el evento."""
    tab1 = broadcaster.subscribe(user_id="alice")
    tab2 = broadcaster.subscribe(user_id="alice")
    tab3 = broadcaster.subscribe(user_id="alice")

    delivered = await broadcaster.publish(
        "notification.created",
        {"id": "n1"},
        user_id="alice",
    )

    assert delivered == 3
    assert tab1.queue.qsize() == 1
    assert tab2.queue.qsize() == 1
    assert tab3.queue.qsize() == 1


@pytest.mark.asyncio
async def test_unsubscribe_one_tab_does_not_affect_others(
    broadcaster: EventBroadcaster,
) -> None:
    tab1 = broadcaster.subscribe(user_id="alice")
    tab2 = broadcaster.subscribe(user_id="alice")

    # Cerramos tab1.
    broadcaster.unsubscribe(tab1)

    delivered = await broadcaster.publish(
        "notification.created",
        {"id": "n1"},
        user_id="alice",
    )

    assert delivered == 1
    assert tab2.queue.qsize() == 1


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_publish_with_no_subscribers_returns_zero(
    broadcaster: EventBroadcaster,
) -> None:
    delivered = await broadcaster.publish("noop", {"x": 1})
    assert delivered == 0


@pytest.mark.asyncio
async def test_publish_to_user_without_subscribers_returns_zero(
    broadcaster: EventBroadcaster,
) -> None:
    broadcaster.subscribe(user_id="alice")
    delivered = await broadcaster.publish(
        "anything", {}, user_id="bob_not_subscribed"
    )
    assert delivered == 0


@pytest.mark.asyncio
async def test_queue_full_drops_oldest_and_keeps_publishing(
    broadcaster: EventBroadcaster,
) -> None:
    """Si la queue se llena, descartamos el más viejo — publish no bloquea."""
    sub = broadcaster.subscribe(user_id="slow_client")

    # Llenamos la queue al máximo + 1 para forzar el drop.
    for i in range(QUEUE_MAX_SIZE + 5):
        delivered = await broadcaster.publish(
            "spam", {"i": i}, user_id="slow_client"
        )
        # Cada publish debe entregar a 1 sub (la nuestra).
        assert delivered == 1

    # El size queda capeado en QUEUE_MAX_SIZE.
    assert sub.queue.qsize() == QUEUE_MAX_SIZE
    # El primero que sale debe ser el más reciente que entró DENTRO
    # de la ventana — los más viejos quedaron descartados.
    first = sub.queue.get_nowait()
    # Ya pasaron QUEUE_MAX_SIZE + 5 publishes. Después de drops, el
    # más viejo retenido tiene índice >= 5.
    assert first["data"]["i"] >= 5


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------


def test_get_broadcaster_returns_singleton() -> None:
    a = get_broadcaster()
    b = get_broadcaster()
    assert a is b


@pytest.mark.asyncio
async def test_singleton_state_persists_across_calls() -> None:
    """Subscribing via get_broadcaster() y publishing también vía get_broadcaster()
    debe ver la misma queue."""
    bc = get_broadcaster()
    bc.clear()  # asegurar fresh state
    sub = bc.subscribe(user_id="alice_singleton")

    await get_broadcaster().publish(
        "test", {"hello": "world"}, user_id="alice_singleton"
    )

    assert sub.queue.qsize() == 1
    bc.unsubscribe(sub)


# ---------------------------------------------------------------------------
# Concurrency smoke test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_publishes_to_same_user(
    broadcaster: EventBroadcaster,
) -> None:
    """Múltiples publishes concurrentes a la misma user_id no deben perder eventos
    (mientras no se exceda el cap de la queue)."""
    sub = broadcaster.subscribe(user_id="alice")

    n_events = 50  # bien por debajo de QUEUE_MAX_SIZE
    await asyncio.gather(
        *[
            broadcaster.publish("evt", {"i": i}, user_id="alice")
            for i in range(n_events)
        ]
    )

    assert sub.queue.qsize() == n_events
