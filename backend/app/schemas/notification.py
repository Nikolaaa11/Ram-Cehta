"""Schemas Pydantic para Notifications Inbox (V3 fase 8)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

NotificationTipo = Literal[
    "f29_due", "contrato_due", "oc_pending", "legal_due", "system", "mention"
]
Severity = Literal["info", "warning", "critical"]


class NotificationBase(BaseModel):
    tipo: NotificationTipo
    severity: Severity = "info"
    title: str = Field(..., min_length=1, max_length=255)
    body: str = ""
    link: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None


class NotificationCreate(NotificationBase):
    user_id: str


class NotificationUpdate(BaseModel):
    """Solo `read_at` es editable por el usuario."""

    read_at: datetime | None = None


class NotificationRead(BaseModel):
    id: str
    user_id: str
    tipo: str
    severity: str
    title: str
    body: str
    link: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    read_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCount(BaseModel):
    unread: int


class GenerateAlertsReport(BaseModel):
    f29_due: int = 0
    contrato_due: int = 0
    oc_pending: int = 0
    total: int = 0
    errores: list[str] = Field(default_factory=list)
