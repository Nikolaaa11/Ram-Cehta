"""Schemas Pydantic para el CEO Weekly Digest (V3 fase 10).

El digest semanal consolida los KPIs y alertas más relevantes a través
de las 9 empresas del portafolio. Se entrega vía email todos los lunes
8am, y también es accesible vía endpoints `/digest/ceo-weekly/*` para
preview manual o trigger ad-hoc.

Convención: todos los montos en CLP (Decimal). Fechas en ISO yyyy-mm-dd.
Severities normalizadas con `Literal["critical", "warning", "info"]`.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

DigestSeverity = Literal["critical", "warning", "info"]
MovimientoTipo = Literal["abono", "egreso"]


class EmpresaDigestRow(BaseModel):
    """KPIs por empresa para la tabla principal del digest."""

    codigo: str
    razon_social: str
    health_score: int  # 0-100
    saldo_actual: Decimal
    flujo_7d: Decimal
    oc_pendientes: int
    f29_vencidas: int
    delta_health: int = 0  # diff vs semana anterior, signed


class DigestAlert(BaseModel):
    """Alerta priorizada para el bloque de Top Alerts."""

    tipo: str  # 'f29_vencida', 'f29_due_week', 'contrato_due', 'oc_estancada', 'system'
    severity: DigestSeverity
    title: str
    body: str
    link: str | None = None


class MovimientoDigestRow(BaseModel):
    """Movimiento significativo (>=5M CLP) en últimos 7 días."""

    fecha: date
    empresa_codigo: str
    descripcion: str
    monto: Decimal
    tipo: MovimientoTipo


class CEODigestPayload(BaseModel):
    """Payload completo del digest semanal CEO.

    Se serializa como JSON para `/preview` y se renderiza vía
    `DigestService.build_html()` para el body del email.
    """

    generated_at: datetime
    period_from: date
    period_to: date

    # KPIs consolidados portafolio (sumas/conteos cross-empresa)
    top_kpis: dict[str, float | int | str] = Field(default_factory=dict)

    empresas: list[EmpresaDigestRow] = Field(default_factory=list)
    alerts: list[DigestAlert] = Field(default_factory=list)
    movimientos_significativos: list[MovimientoDigestRow] = Field(default_factory=list)

    # Comparación semana actual vs semana previa.
    # Claves típicas: flujo_7d, oc_creadas, f29_pagadas (con _prev y _delta).
    vs_prev_week: dict[str, float | int | str] = Field(default_factory=dict)


class DigestSendRequest(BaseModel):
    """Body opcional del POST /digest/ceo-weekly/send-now."""

    recipients: list[str] | None = None


class DigestSendResult(BaseModel):
    """Resultado del envío del digest."""

    sent: int
    failed: list[str] = Field(default_factory=list)
    preview_url: str | None = None
