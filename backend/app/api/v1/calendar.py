"""Endpoints de Calendario + Agentes scheduled (V3 fase 5)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.calendar_repository import (
    CalendarRepository,
)
from app.schemas.calendar import (
    AgentRunReport,
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventUpdate,
)
from app.services.calendar_agents_service import CalendarAgentsService

router = APIRouter()


@router.get(
    "/events",
    response_model=list[CalendarEventRead],
    dependencies=[Depends(require_scope("calendar:read"))],
)
async def list_events(
    user: CurrentUser,
    db: DBSession,
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    empresa: str | None = None,
    tipo: str | None = None,
) -> list[CalendarEventRead]:
    events = await CalendarRepository(db).list(
        date_from=date_from,
        date_to=date_to,
        empresa_codigo=empresa,
        tipo=tipo,
    )
    return [CalendarEventRead.model_validate(e) for e in events]


@router.post(
    "/events",
    response_model=CalendarEventRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("calendar:create"))],
)
async def create_event(
    user: CurrentUser,
    db: DBSession,
    body: CalendarEventCreate,
) -> CalendarEventRead:
    ev = await CalendarRepository(db).create(body, auto_generado=False)
    await db.commit()
    return CalendarEventRead.model_validate(ev)


@router.patch(
    "/events/{event_id}",
    response_model=CalendarEventRead,
    dependencies=[Depends(require_scope("calendar:update"))],
)
async def update_event(
    user: CurrentUser,
    db: DBSession,
    event_id: int,
    body: CalendarEventUpdate,
) -> CalendarEventRead:
    repo = CalendarRepository(db)
    ev = await repo.get(event_id)
    if ev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Evento no encontrado"
        )
    updated = await repo.update(ev, body)
    await db.commit()
    return CalendarEventRead.model_validate(updated)


@router.delete(
    "/events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("calendar:delete"))],
)
async def delete_event(
    user: CurrentUser,
    db: DBSession,
    event_id: int,
) -> Response:
    repo = CalendarRepository(db)
    ev = await repo.get(event_id)
    if ev is not None:
        await repo.delete(ev)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/events/{event_id}/complete",
    response_model=CalendarEventRead,
    dependencies=[Depends(require_scope("calendar:update"))],
)
async def complete_event(
    user: CurrentUser,
    db: DBSession,
    event_id: int,
) -> CalendarEventRead:
    repo = CalendarRepository(db)
    ev = await repo.get(event_id)
    if ev is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Evento no encontrado"
        )
    updated = await repo.mark_completed(ev)
    await db.commit()
    return CalendarEventRead.model_validate(updated)


@router.post(
    "/agents/run",
    response_model=AgentRunReport,
    dependencies=[Depends(require_scope("calendar:admin"))],
)
async def run_agents(
    user: CurrentUser,
    db: DBSession,
) -> AgentRunReport:
    """Trigger manual de los agentes scheduled.

    Crea eventos automáticos (F29 mensual + reporte LP) idempotentes.
    En producción se invoca via cron (Fly.io scheduled machine), acá
    queda como endpoint admin para testeos puntuales.
    """
    svc = CalendarAgentsService(db)
    report = await svc.run_all_agents()
    await db.commit()
    return report
