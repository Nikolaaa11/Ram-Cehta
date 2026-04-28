"""Repository para `core.calendar_events` (V3 fase 5)."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_event import CalendarEvent
from app.schemas.calendar import CalendarEventCreate, CalendarEventUpdate


class CalendarRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        date_from: date | None = None,
        date_to: date | None = None,
        empresa_codigo: str | None = None,
        tipo: str | None = None,
    ) -> list[CalendarEvent]:
        q = select(CalendarEvent)
        conditions = []
        if date_from:
            conditions.append(
                CalendarEvent.fecha_inicio >= datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
            )
        if date_to:
            conditions.append(
                CalendarEvent.fecha_inicio <= datetime.combine(date_to, datetime.max.time(), tzinfo=timezone.utc)
            )
        if empresa_codigo:
            conditions.append(CalendarEvent.empresa_codigo == empresa_codigo)
        if tipo:
            conditions.append(CalendarEvent.tipo == tipo)
        if conditions:
            q = q.where(and_(*conditions))
        q = q.order_by(CalendarEvent.fecha_inicio.asc())
        return list((await self._session.scalars(q)).all())

    async def get(self, event_id: int) -> CalendarEvent | None:
        return await self._session.get(CalendarEvent, event_id)

    async def find_existing(
        self,
        tipo: str,
        empresa_codigo: str | None,
        fecha: datetime,
    ) -> CalendarEvent | None:
        """Busca un evento ya existente con mismo tipo+empresa+día.

        Útil para idempotencia de los agentes (no crear duplicados).
        """
        day_start = datetime.combine(fecha.date(), datetime.min.time(), tzinfo=timezone.utc)
        day_end = datetime.combine(fecha.date(), datetime.max.time(), tzinfo=timezone.utc)
        q = select(CalendarEvent).where(
            CalendarEvent.tipo == tipo,
            CalendarEvent.fecha_inicio >= day_start,
            CalendarEvent.fecha_inicio <= day_end,
        )
        if empresa_codigo is None:
            q = q.where(CalendarEvent.empresa_codigo.is_(None))
        else:
            q = q.where(CalendarEvent.empresa_codigo == empresa_codigo)
        return (await self._session.scalars(q)).first()

    async def create(
        self, data: CalendarEventCreate, *, auto_generado: bool = False
    ) -> CalendarEvent:
        payload = data.model_dump(exclude_none=True)
        ev = CalendarEvent(**payload, auto_generado=auto_generado)
        self._session.add(ev)
        await self._session.flush()
        await self._session.refresh(ev)
        return ev

    async def update(
        self, ev: CalendarEvent, data: CalendarEventUpdate
    ) -> CalendarEvent:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(ev, k, v)
        await self._session.flush()
        await self._session.refresh(ev)
        return ev

    async def mark_completed(self, ev: CalendarEvent) -> CalendarEvent:
        ev.completado = True
        await self._session.flush()
        await self._session.refresh(ev)
        return ev

    async def delete(self, ev: CalendarEvent) -> None:
        await self._session.delete(ev)
        await self._session.flush()
