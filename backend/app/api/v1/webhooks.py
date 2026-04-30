"""Outgoing webhooks — admin CRUD + delivery log.

Diseño:
- Solo admin (scope `audit:read`) puede crear/editar/borrar webhooks. Los
  receivers son endpoints externos del usuario (Slack, Zapier, n8n, etc).
- El secret se devuelve UNA SOLA VEZ al crear (`POST` returns 201 con
  `WebhookSubscriptionWithSecret`). Después solo `secret_hint` (8 chars).
- Test endpoint dispara un evento `test` para que el user verifique.
- Delivery log paginado para inspección.
"""
from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import text

from app.api.deps import DBSession, current_admin_with_2fa, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.common import Page
from app.schemas.webhook import (
    WEBHOOK_EVENT_TYPES,
    WebhookDeliveryRead,
    WebhookSubscriptionCreate,
    WebhookSubscriptionRead,
    WebhookSubscriptionUpdate,
    WebhookSubscriptionWithSecret,
    WebhookTestRequest,
)
from app.services.webhook_dispatcher import generate_secret, publish_event

router = APIRouter()

_SCOPE = "audit:read"  # admin-only; reusa el scope existente


def _row_to_read(row: dict) -> WebhookSubscriptionRead:
    secret = row.get("secret") or ""
    return WebhookSubscriptionRead(
        id=str(row["id"]),
        name=row["name"],
        target_url=row["target_url"],
        events=list(row.get("events") or []),
        description=row.get("description"),
        active=bool(row["active"]),
        secret_hint=f"{secret[:8]}…" if secret else "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("/event-types")
async def list_event_types(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
) -> dict[str, list[str]]:
    """Lista de eventos publicables — el frontend pinta checkboxes con esto."""
    return {"events": list(WEBHOOK_EVENT_TYPES)}


@router.get("", response_model=list[WebhookSubscriptionRead])
async def list_subscriptions(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
) -> list[WebhookSubscriptionRead]:
    rows = (
        await db.execute(
            text(
                "SELECT id, name, target_url, secret, events, description, "
                "active, created_at, updated_at "
                "FROM app.webhook_subscriptions "
                "ORDER BY created_at DESC"
            )
        )
    ).mappings().all()
    return [_row_to_read(dict(r)) for r in rows]


@router.post(
    "",
    response_model=WebhookSubscriptionWithSecret,
    status_code=status.HTTP_201_CREATED,
    # V4 fase 2: high-impact (un webhook nuevo expone datos de Cehta).
    dependencies=[Depends(current_admin_with_2fa)],
)
async def create_subscription(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
    body: WebhookSubscriptionCreate,
) -> WebhookSubscriptionWithSecret:
    secret = generate_secret()
    sub_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO app.webhook_subscriptions
                (id, name, target_url, secret, events, description, active,
                 created_by)
            VALUES
                (:id, :name, :url, :secret, :events, :desc, :active, :uid)
            """
        ),
        {
            "id": str(sub_id),
            "name": body.name,
            "url": str(body.target_url),
            "secret": secret,
            "events": body.events,
            "desc": body.description,
            "active": body.active,
            "uid": user.sub,
        },
    )
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT id, name, target_url, secret, events, description, "
                "active, created_at, updated_at "
                "FROM app.webhook_subscriptions WHERE id = :id"
            ),
            {"id": str(sub_id)},
        )
    ).mappings().one()
    base = _row_to_read(dict(row))
    return WebhookSubscriptionWithSecret(**base.model_dump(), secret=secret)


@router.patch("/{sub_id}", response_model=WebhookSubscriptionRead)
async def update_subscription(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
    sub_id: str,
    body: WebhookSubscriptionUpdate,
) -> WebhookSubscriptionRead:
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")

    # Convertir HttpUrl a str si viene
    if "target_url" in fields and fields["target_url"] is not None:
        fields["target_url"] = str(fields["target_url"])

    sets = [f"{k} = :{k}" for k in fields]
    sets.append("updated_at = now()")
    params = dict(fields)
    params["id"] = sub_id

    res = await db.execute(
        text(
            f"UPDATE app.webhook_subscriptions SET {', '.join(sets)} "  # noqa: S608
            "WHERE id = :id RETURNING id"
        ),
        params,
    )
    if res.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT id, name, target_url, secret, events, description, "
                "active, created_at, updated_at "
                "FROM app.webhook_subscriptions WHERE id = :id"
            ),
            {"id": sub_id},
        )
    ).mappings().one()
    return _row_to_read(dict(row))


@router.delete(
    "/{sub_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    # V4 fase 2: high-impact (delete destructivo).
    dependencies=[Depends(current_admin_with_2fa)],
)
async def delete_subscription(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
    sub_id: str,
) -> Response:
    res = await db.execute(
        text("DELETE FROM app.webhook_subscriptions WHERE id = :id RETURNING id"),
        {"id": sub_id},
    )
    if res.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{sub_id}/test")
async def test_subscription(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
    sub_id: str,
    body: WebhookTestRequest,
) -> dict[str, object]:
    """Dispara un evento `test` para verificar que el webhook funciona.

    Útil al crear: el user agrega su URL → click 'Test' → ve si llega a
    Slack/Zapier/etc + chequea la signature.
    """
    # Verificar que existe + se suscribe a "test"
    row = (
        await db.execute(
            text(
                "SELECT events FROM app.webhook_subscriptions WHERE id = :id"
            ),
            {"id": sub_id},
        )
    ).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    payload = body.sample_payload or {
        "message": "Webhook test desde Cehta Capital",
        "subscription_id": sub_id,
    }
    sent = await publish_event(db, "test", payload)
    return {
        "triggered": True,
        "subscribers_notified": sent,
        "note": "Revisá `/admin/webhooks/{id}/deliveries` en unos segundos",
    }


@router.get(
    "/{sub_id}/deliveries", response_model=Page[WebhookDeliveryRead]
)
async def list_deliveries(
    user: Annotated[AuthenticatedUser, Depends(require_scope(_SCOPE))],
    db: DBSession,
    sub_id: str,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[WebhookDeliveryRead]:
    total = (
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM app.webhook_deliveries "
                "WHERE subscription_id = :sid"
            ),
            {"sid": sub_id},
        )
    ) or 0

    rows = (
        await db.execute(
            text(
                """
                SELECT id, subscription_id, event_type, payload, status_code,
                       response_body, error, attempt, delivered_at, created_at
                FROM app.webhook_deliveries
                WHERE subscription_id = :sid
                ORDER BY created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"sid": sub_id, "limit": size, "offset": (page - 1) * size},
        )
    ).mappings().all()

    items = [
        WebhookDeliveryRead(
            id=str(r["id"]),
            subscription_id=str(r["subscription_id"]),
            event_type=r["event_type"],
            payload=r["payload"] or {},
            status_code=r["status_code"],
            response_body=r["response_body"],
            error=r["error"],
            attempt=r["attempt"],
            delivered_at=r["delivered_at"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
    return Page.build(items=items, total=total, page=page, size=size)
