"""Repositories para Informes LP (V4 fase 9).

Convención: el endpoint hace commit, los repos solo flush + refresh.

Tokens URL-safe se generan acá (no en el endpoint) para que cualquier
caller del repo herede el comportamiento defensivo: si por alguna razón
hay colisión (probabilidad ~10^-22 con 192 bits), reintenta hasta 5x.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.informe_lp import InformeLp, InformeLpEvento
from app.models.lp import Lp
from app.schemas.informe_lp import (
    InformeLpUpdate,
    LpCreate,
    LpUpdate,
    TrackEventRequest,
)

# Bytes del salt para hash de IPs. Se lee de settings con fallback.
_IP_SALT = getattr(settings, "ip_hash_salt", None) or "cehta-fallback-salt-v1"


def generate_token() -> str:
    """Genera un token URL-safe de 32 chars (24 bytes ≈ 192 bits).

    Probabilidad de colisión incluso con 1B tokens: ~10^-22.
    """
    return secrets.token_urlsafe(24)


def hash_ip(ip: str | None) -> str | None:
    """SHA256(ip + salt) — para tracking sin almacenar IP cruda."""
    if not ip:
        return None
    return hashlib.sha256(f"{ip}:{_IP_SALT}".encode()).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Lp
# ---------------------------------------------------------------------------


class LpRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, lp_id: int) -> Lp | None:
        return await self._session.get(Lp, lp_id)

    async def get_by_email(self, email: str) -> Lp | None:
        q = select(Lp).where(Lp.email == email).limit(1)
        return await self._session.scalar(q)

    async def list_all(
        self, estado: str | None = None, limit: int = 200, offset: int = 0
    ) -> list[Lp]:
        q = select(Lp).order_by(Lp.created_at.desc())
        if estado:
            q = q.where(Lp.estado == estado)
        q = q.limit(limit).offset(offset)
        return list((await self._session.scalars(q)).all())

    async def create(self, data: LpCreate) -> Lp:
        payload = data.model_dump(exclude_none=True)
        lp = Lp(**payload)
        self._session.add(lp)
        await self._session.flush()
        await self._session.refresh(lp)
        return lp

    async def update(self, lp: Lp, data: LpUpdate) -> Lp:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(lp, k, v)
        await self._session.flush()
        await self._session.refresh(lp)
        return lp

    async def delete(self, lp: Lp) -> None:
        await self._session.delete(lp)
        await self._session.flush()


# ---------------------------------------------------------------------------
# InformeLp
# ---------------------------------------------------------------------------


class InformeLpRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, informe_id: int) -> InformeLp | None:
        return await self._session.get(InformeLp, informe_id)

    async def get_by_token(self, token: str) -> InformeLp | None:
        q = select(InformeLp).where(InformeLp.token == token).limit(1)
        return await self._session.scalar(q)

    async def list_all(
        self,
        lp_id: int | None = None,
        estado: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[InformeLp]:
        q = select(InformeLp).order_by(InformeLp.created_at.desc())
        if lp_id is not None:
            q = q.where(InformeLp.lp_id == lp_id)
        if estado:
            q = q.where(InformeLp.estado == estado)
        q = q.limit(limit).offset(offset)
        return list((await self._session.scalars(q)).all())

    async def list_with_lp_name(
        self,
        estado: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[tuple[InformeLp, str | None]]:
        """Listado con nombre del LP via LEFT JOIN — para dashboard admin."""
        q = (
            select(
                InformeLp,
                func.concat(Lp.nombre, " ", func.coalesce(Lp.apellido, "")).label(
                    "lp_nombre"
                ),
            )
            .outerjoin(Lp, InformeLp.lp_id == Lp.lp_id)
            .order_by(InformeLp.created_at.desc())
        )
        if estado:
            q = q.where(InformeLp.estado == estado)
        q = q.limit(limit).offset(offset)
        rows = (await self._session.execute(q)).all()
        return [(row[0], row[1]) for row in rows]

    async def create(
        self,
        *,
        lp_id: int | None,
        titulo: str,
        tipo: str,
        periodo: str | None = None,
        hero_titulo: str | None = None,
        hero_narrativa: str | None = None,
        secciones: dict[str, Any] | None = None,
        creado_por: str | None = None,
        parent_token: str | None = None,
    ) -> InformeLp:
        # Generar token único — retry si colisiona (extremadamente improbable)
        for attempt in range(5):
            candidate_token = generate_token()
            existing = await self.get_by_token(candidate_token)
            if existing is None:
                break
        else:
            raise RuntimeError(
                "No se pudo generar token único después de 5 intentos"
            )

        informe = InformeLp(
            lp_id=lp_id,
            token=candidate_token,
            parent_token=parent_token,
            titulo=titulo,
            tipo=tipo,
            periodo=periodo,
            hero_titulo=hero_titulo,
            hero_narrativa=hero_narrativa,
            secciones=secciones or {},
            estado="borrador",
            creado_por=creado_por,
        )
        self._session.add(informe)
        await self._session.flush()
        await self._session.refresh(informe)
        return informe

    async def update(
        self, informe: InformeLp, data: InformeLpUpdate
    ) -> InformeLp:
        payload = data.model_dump(exclude_unset=True)
        # Side effect: si pasa a publicado y no tiene publicado_at, setearlo
        if payload.get("estado") == "publicado" and informe.publicado_at is None:
            informe.publicado_at = datetime.utcnow()
        for k, v in payload.items():
            setattr(informe, k, v)
        await self._session.flush()
        await self._session.refresh(informe)
        return informe

    async def increment_open(self, informe: InformeLp) -> None:
        informe.veces_abierto = (informe.veces_abierto or 0) + 1
        await self._session.flush()

    async def increment_share(self, informe: InformeLp) -> None:
        informe.veces_compartido = (informe.veces_compartido or 0) + 1
        await self._session.flush()

    async def delete(self, informe: InformeLp) -> None:
        await self._session.delete(informe)
        await self._session.flush()


# ---------------------------------------------------------------------------
# InformeLpEvento (analytics)
# ---------------------------------------------------------------------------


class InformeLpEventoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        *,
        informe_id: int,
        token: str,
        event: TrackEventRequest,
        ip: str | None = None,
        user_agent: str | None = None,
        referer_override: str | None = None,
    ) -> InformeLpEvento:
        evento = InformeLpEvento(
            informe_id=informe_id,
            token=token,
            tipo=event.tipo,
            seccion=event.seccion,
            valor_numerico=event.valor_numerico,
            valor_texto=event.valor_texto,
            ip_hash=hash_ip(ip),
            user_agent=user_agent,
            referer=referer_override or event.referer,
        )
        self._session.add(evento)
        await self._session.flush()
        return evento

    async def count_by_tipo(
        self, informe_id: int, tipo: str
    ) -> int:
        q = (
            select(func.count(InformeLpEvento.evento_id))
            .where(InformeLpEvento.informe_id == informe_id)
            .where(InformeLpEvento.tipo == tipo)
        )
        return int((await self._session.scalar(q)) or 0)

    async def aggregate_global(
        self, since: datetime | None = None
    ) -> dict[str, int]:
        """Agregaciones para dashboard analytics admin."""
        q = select(
            InformeLpEvento.tipo,
            func.count(InformeLpEvento.evento_id).label("c"),
        ).group_by(InformeLpEvento.tipo)
        if since:
            q = q.where(InformeLpEvento.created_at >= since)
        rows = (await self._session.execute(q)).all()
        return {row[0]: int(row[1]) for row in rows}

    async def avg_time_spent(self, informe_id: int) -> int | None:
        """Promedio de tiempo (segundos) en el informe — eventos `time_spent`."""
        q = (
            select(func.avg(InformeLpEvento.valor_numerico))
            .where(InformeLpEvento.informe_id == informe_id)
            .where(InformeLpEvento.tipo == "time_spent")
            .where(InformeLpEvento.valor_numerico.isnot(None))
        )
        result = await self._session.scalar(q)
        return int(result) if result is not None else None

    async def downstream_views(self, parent_token: str) -> int:
        """Cuántas aperturas hubo en informes que tienen este como padre."""
        # JOIN: opens en informes cuyo parent_token = nuestro token
        q = (
            select(func.count(InformeLpEvento.evento_id))
            .join(
                InformeLp, InformeLpEvento.informe_id == InformeLp.informe_id
            )
            .where(InformeLp.parent_token == parent_token)
            .where(InformeLpEvento.tipo == "open")
        )
        return int((await self._session.scalar(q)) or 0)
