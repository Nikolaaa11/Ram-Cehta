"""Schemas pydantic para `audit.action_log`."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, model_validator

AuditAction = Literal[
    "create", "update", "delete", "approve", "reject", "sync", "upload", "other"
]


class AuditLogList(BaseModel):
    """Lighter row para listados (sin diffs)."""

    id: str
    user_id: str | None
    user_email: str | None
    action: str
    entity_type: str
    entity_id: str
    entity_label: str | None
    summary: str
    ip: str | None
    user_agent: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _coerce_uuid(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ("id", "user_id"):
                v = data.get(key)
                if v is not None and not isinstance(v, str):
                    data[key] = str(v)
        return data


class AuditLogRead(AuditLogList):
    """Detalle completo: incluye diff_before/diff_after."""

    diff_before: dict[str, Any] | None = None
    diff_after: dict[str, Any] | None = None
