"""Modelo Entregable Regulatorio — Compliance AFIS S.A. / FIP CEHTA ESG.

V4 fase 6: tabla `app.entregables_regulatorios` que persiste todos los
entregables que la Administradora debe presentar a entes regulatorios
(CMF, CORFO, UAF, SII) + obligaciones internas (Auditoria, Asambleas,
Comités).

Diseño:
- `id_template` agrupa instancias de un mismo entregable recurrente
  (ej. todas las "Rendiciones Semestrales CORFO" comparten template
  pero tienen instancias distintas por período).
- `periodo` distingue las instancias (Q1-2025, S1-2025, Enero-2026).
- `estado` evoluciona pendiente → en_proceso → entregado | no_entregado.
- `alerta_15/10/5` son flags que controlan si esa instancia debe
  generar alertas en esos días previos al vencimiento.
- `es_publico` siempre False — restricción de compliance del spec.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class EntregableRegulatorio(Base):
    __tablename__ = "entregables_regulatorios"
    __table_args__ = (
        UniqueConstraint("id_template", "periodo", name="uq_entregable_template_periodo"),
        {"schema": "app"},
    )

    entregable_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_template: Mapped[str] = mapped_column(Text, nullable=False)
    nombre: Mapped[str] = mapped_column(Text, nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text)
    categoria: Mapped[str] = mapped_column(Text, nullable=False)
    subcategoria: Mapped[str | None] = mapped_column(Text)
    referencia_normativa: Mapped[str | None] = mapped_column(Text)
    fecha_limite: Mapped[date] = mapped_column(Date, nullable=False)
    frecuencia: Mapped[str] = mapped_column(Text, nullable=False)
    prioridad: Mapped[str] = mapped_column(Text, nullable=False)
    responsable: Mapped[str] = mapped_column(Text, nullable=False)
    estado: Mapped[str] = mapped_column(Text, nullable=False, server_default="pendiente")
    fecha_entrega_real: Mapped[date | None] = mapped_column(Date)
    motivo_no_entrega: Mapped[str | None] = mapped_column(Text)
    notas: Mapped[str | None] = mapped_column(Text)
    adjunto_url: Mapped[str | None] = mapped_column(Text)
    periodo: Mapped[str] = mapped_column(Text, nullable=False)
    alerta_15: Mapped[bool] = mapped_column(Boolean, server_default="true")
    alerta_10: Mapped[bool] = mapped_column(Boolean, server_default="true")
    alerta_5: Mapped[bool] = mapped_column(Boolean, server_default="true")
    generado_automaticamente: Mapped[bool] = mapped_column(
        Boolean, server_default="false"
    )
    es_publico: Mapped[bool] = mapped_column(Boolean, server_default="false")
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    updated_by: Mapped[str | None] = mapped_column(
        UUID(as_uuid=False),
        ForeignKey("core.user_roles.user_id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
