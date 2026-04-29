"""Schemas del Status / Health dashboard.

`SystemStatus` agrega un check por integración + métricas operativas
recientes. Diseñado para ser barato de calcular (≤ 200ms): cada check es
una query simple o una check en memoria.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

CheckState = Literal["ok", "degraded", "down", "disabled", "unknown"]


class IntegrationCheck(BaseModel):
    """Estado de una integración externa o componente interno.

    `state` define el color visual:
      - ok       → verde, todo bien
      - degraded → ámbar, responde pero con problemas (timeout reciente, etc)
      - down     → rojo, no responde / error
      - disabled → gris, intencionalmente apagado (no api_key configurada)
      - unknown  → gris, no se pudo determinar el estado
    """

    name: str  # "Postgres", "Dropbox", "Resend", "Anthropic", "OpenAI", etc.
    state: CheckState
    detail: str | None = None  # mensaje corto humano
    latency_ms: int | None = None
    last_checked_at: datetime


class OperationalMetric(BaseModel):
    """Una métrica operativa que el dashboard muestra como tile."""

    label: str
    value: str  # ya formateado para display
    hint: str | None = None  # texto pequeño debajo


class SystemStatus(BaseModel):
    """Snapshot del estado de la plataforma."""

    generated_at: datetime
    overall: CheckState  # peor estado entre los checks no-disabled
    checks: list[IntegrationCheck]
    metrics: list[OperationalMetric] = Field(default_factory=list)
