"""Schemas para outgoing webhooks.

Diseño:
- Una `WebhookSubscription` se suscribe a una lista de events_type.
- Cuando un evento ocurre en la app, el dispatcher POST al `target_url` con
  body JSON + header `X-Cehta-Signature: sha256={hmac}` para que el
  receiver verifique autenticidad.
- Reintentos exponential backoff hasta 3 intentos. Cada intento se loguea
  en `WebhookDelivery` para inspección.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl

# Lista cerrada de eventos publicables — el frontend muestra checkboxes
# basándose en esta lista, así que mantenerla sincronizada importa.
WebhookEventType = Literal[
    "oc.created",
    "oc.paid",
    "oc.cancelled",
    "f29.due",
    "f29.paid",
    "legal.due",
    "trabajador.created",
    "etl.completed",
    "etl.failed",
    "audit.high_severity",
    "test",  # para que el usuario pueda probar el webhook al crearlo
]

WEBHOOK_EVENT_TYPES: list[WebhookEventType] = [
    "oc.created",
    "oc.paid",
    "oc.cancelled",
    "f29.due",
    "f29.paid",
    "legal.due",
    "trabajador.created",
    "etl.completed",
    "etl.failed",
    "audit.high_severity",
    "test",
]


class WebhookSubscriptionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    target_url: HttpUrl
    events: list[WebhookEventType] = Field(..., min_length=1)
    description: str | None = Field(None, max_length=500)
    active: bool = True


class WebhookSubscriptionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    target_url: HttpUrl | None = None
    events: list[WebhookEventType] | None = Field(None, min_length=1)
    description: str | None = Field(None, max_length=500)
    active: bool | None = None


class WebhookSubscriptionRead(BaseModel):
    id: str
    name: str
    target_url: str
    events: list[str]
    description: str | None
    active: bool
    secret_hint: str  # primeros 8 chars del secret para que el user identifique
    created_at: datetime
    updated_at: datetime


class WebhookSubscriptionWithSecret(WebhookSubscriptionRead):
    """Devuelto SOLO al crear — incluye el secret crudo una sola vez."""

    secret: str  # crudo; el user debe guardarlo, no se puede recuperar


class WebhookDeliveryRead(BaseModel):
    id: str
    subscription_id: str
    event_type: str
    payload: dict[str, Any]
    status_code: int | None
    response_body: str | None
    error: str | None
    attempt: int
    delivered_at: datetime | None
    created_at: datetime


class WebhookTestRequest(BaseModel):
    """Body para POST /webhooks/{id}/test — dispara un evento `test` ahora."""

    sample_payload: dict[str, Any] | None = None
