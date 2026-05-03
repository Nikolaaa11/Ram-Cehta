"""Modelos `app.informes_lp` + `app.informes_lp_eventos` (V4 fase 9).

InformeLp: snapshot completo de un reporte generado para un LP, con
token URL-safe único. Si fue creado via "share", parent_token apunta al
informe original — así trackeamos cohort viral.

InformeLpEvento: log granular de eventos (open, scroll, share, etc.)
para analytics. IP siempre hasheada antes de persistir.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class InformeLp(Base):
    __tablename__ = "informes_lp"
    __table_args__ = {"schema": "app"}  # noqa: RUF012

    informe_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lp_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("core.lps.lp_id", ondelete="SET NULL")
    )

    # Token URL-safe (32 chars). Generado con secrets.token_urlsafe(24).
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    # Cohort viral: si vino de un share, el padre tracked acá
    parent_token: Mapped[str | None] = mapped_column(
        Text, ForeignKey("app.informes_lp.token")
    )

    titulo: Mapped[str] = mapped_column(Text, nullable=False)
    periodo: Mapped[str | None] = mapped_column(Text)
    tipo: Mapped[str] = mapped_column(
        Text, server_default="periodico", nullable=False
    )

    # Contenido (snapshot al momento de generación)
    hero_titulo: Mapped[str | None] = mapped_column(Text)
    hero_narrativa: Mapped[str | None] = mapped_column(Text)
    secciones: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, server_default="{}"
    )

    # Lifecycle
    estado: Mapped[str] = mapped_column(
        Text, server_default="borrador", nullable=False
    )
    publicado_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expira_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Tracking agregado (denormalized para fast dashboard)
    veces_abierto: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    veces_compartido: Mapped[int] = mapped_column(
        Integer, server_default="0", nullable=False
    )
    tiempo_promedio_segundos: Mapped[int | None] = mapped_column(Integer)

    creado_por: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class InformeLpEvento(Base):
    __tablename__ = "informes_lp_eventos"
    __table_args__ = {"schema": "app"}  # noqa: RUF012

    evento_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    informe_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("app.informes_lp.informe_id", ondelete="CASCADE"),
        nullable=False,
    )
    # Token redundante para queries directas sin join
    token: Mapped[str] = mapped_column(Text, nullable=False)

    tipo: Mapped[str] = mapped_column(Text, nullable=False)
    seccion: Mapped[str | None] = mapped_column(Text)
    valor_numerico: Mapped[int | None] = mapped_column(Integer)
    valor_texto: Mapped[str | None] = mapped_column(Text)

    # Privacy: IP siempre hasheada (SHA256+salt) — NUNCA cruda
    ip_hash: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    referer: Mapped[str | None] = mapped_column(Text)
    pais: Mapped[str | None] = mapped_column(Text)

    metadata_: Mapped[dict[str, Any] | None] = mapped_column(
        "metadata", JSONB, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
