"""Endpoints de Calendario + Agentes scheduled (V3 fase 5).

V3 fase 9: agrega `GET /calendar/obligations` — timeline unificado que
agrega F29 vencimientos, legal vigencia, OCs no pagadas y suscripciones
por firmar, junto con los eventos manuales de `core.calendar_events`.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.calendar_repository import (
    CalendarRepository,
)
from app.schemas.calendar import (
    AgentRunReport,
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventUpdate,
    ObligationItem,
    ObligationSeverity,
    ObligationTipo,
)
from app.services.calendar_agents_service import CalendarAgentsService

router = APIRouter()


# =====================================================================
# Helpers puros para `/calendar/obligations` (V3 fase 9)
# =====================================================================

_PLAZO_PAGO_RE = re.compile(r"(\d+)")


def _compute_days_until(today: date, due_date: date) -> int:
    """Días entre `today` y `due_date`. Negativo = vencido.

    Pure function — testeable sin DB.
    """
    return (due_date - today).days


def _classify_severity(days_until: int) -> ObligationSeverity:
    """Clasifica severidad según días restantes:

        days_until < 0  → critical (vencido)
        0 <= days <= 7  → warning  (esta semana)
        days_until > 7  → info     (más adelante)
    """
    if days_until < 0:
        return "critical"
    if days_until <= 7:
        return "warning"
    return "info"


def _parse_plazo_pago_days(plazo: str | None) -> int:
    """Parsea `plazo_pago` (ej. '30 días', '15', 'contado') → entero.

    Si no se puede parsear devuelve 30 como default conservador.
    'Contado' / '0' → 0 días (vence el mismo día de emisión).
    """
    if not plazo:
        return 30
    s = plazo.strip().lower()
    if "contado" in s:
        return 0
    m = _PLAZO_PAGO_RE.search(s)
    if not m:
        return 30
    try:
        return int(m.group(1))
    except (ValueError, IndexError):
        return 30


def _build_obligation(
    *,
    tipo: ObligationTipo,
    entity_id: str,
    title: str,
    subtitle: str | None,
    empresa_codigo: str | None,
    due_date: date,
    today: date,
    monto: Decimal | None,
    moneda: str | None,
    link: str,
) -> ObligationItem:
    """Construye un `ObligationItem` con severity calculado."""
    days = _compute_days_until(today, due_date)
    return ObligationItem(
        id=f"{tipo}:{entity_id}",
        tipo=tipo,
        severity=_classify_severity(days),
        title=title,
        subtitle=subtitle,
        empresa_codigo=empresa_codigo,
        due_date=due_date,
        days_until=days,
        monto=monto,
        moneda=moneda,
        link=link,
    )


# =====================================================================
# Queries SQL — encapsuladas para mantener el handler delgado
# =====================================================================


async def _query_f29(
    db: AsyncSession,
    *,
    today: date,
    from_date: date,
    to_date: date,
    empresa_codigo: str | None,
) -> list[ObligationItem]:
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    f29_id::text       AS f29_id,
                    empresa_codigo,
                    periodo_tributario,
                    fecha_vencimiento,
                    monto_a_pagar,
                    estado
                FROM core.f29_obligaciones
                WHERE fecha_vencimiento BETWEEN :from_date AND :to_date
                  AND estado <> 'pagado'
                  AND (:empresa IS NULL OR empresa_codigo = :empresa)
                """
            ),
            {
                "from_date": from_date,
                "to_date": to_date,
                "empresa": empresa_codigo,
            },
        )
    ).mappings().all()

    out: list[ObligationItem] = []
    for r in rows:
        out.append(
            _build_obligation(
                tipo="f29",
                entity_id=str(r["f29_id"]),
                title=(
                    f"F29 {r['empresa_codigo']} {r['periodo_tributario']}"
                ),
                subtitle=f"Estado: {r['estado']}",
                empresa_codigo=r["empresa_codigo"],
                due_date=r["fecha_vencimiento"],
                today=today,
                monto=r["monto_a_pagar"],
                moneda="CLP",
                link=f"/f29?empresa_codigo={r['empresa_codigo']}",
            )
        )
    return out


async def _query_legal(
    db: AsyncSession,
    *,
    today: date,
    from_date: date,
    to_date: date,
    empresa_codigo: str | None,
) -> list[ObligationItem]:
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    documento_id::text  AS documento_id,
                    empresa_codigo,
                    nombre,
                    categoria,
                    fecha_vigencia_hasta,
                    monto,
                    moneda
                FROM core.legal_documents
                WHERE fecha_vigencia_hasta BETWEEN :from_date AND :to_date
                  AND estado = 'vigente'
                  AND (:empresa IS NULL OR empresa_codigo = :empresa)
                """
            ),
            {
                "from_date": from_date,
                "to_date": to_date,
                "empresa": empresa_codigo,
            },
        )
    ).mappings().all()

    out: list[ObligationItem] = []
    for r in rows:
        out.append(
            _build_obligation(
                tipo="legal",
                entity_id=str(r["documento_id"]),
                title=str(r["nombre"]),
                subtitle=f"Categoría: {r['categoria']}",
                empresa_codigo=r["empresa_codigo"],
                due_date=r["fecha_vigencia_hasta"],
                today=today,
                monto=r["monto"],
                moneda=r["moneda"],
                link=(
                    f"/empresa/{r['empresa_codigo']}/legal/"
                    f"{r['documento_id']}"
                ),
            )
        )
    return out


async def _query_oc(
    db: AsyncSession,
    *,
    today: date,
    from_date: date,
    to_date: date,
    empresa_codigo: str | None,
) -> list[ObligationItem]:
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    oc_id::text       AS oc_id,
                    numero_oc,
                    empresa_codigo,
                    fecha_emision,
                    total,
                    moneda,
                    plazo_pago,
                    estado
                FROM core.ordenes_compra
                WHERE estado IN ('emitida', 'aprobada')
                  AND (:empresa IS NULL OR empresa_codigo = :empresa)
                """
            ),
            {"empresa": empresa_codigo},
        )
    ).mappings().all()

    out: list[ObligationItem] = []
    for r in rows:
        plazo_dias = _parse_plazo_pago_days(r["plazo_pago"])
        due_date = r["fecha_emision"] + timedelta(days=plazo_dias)
        if due_date < from_date or due_date > to_date:
            continue
        out.append(
            _build_obligation(
                tipo="oc",
                entity_id=str(r["oc_id"]),
                title=f"OC {r['numero_oc']}",
                subtitle=(
                    f"Estado: {r['estado']} · Plazo: "
                    f"{r['plazo_pago'] or 'sin plazo'}"
                ),
                empresa_codigo=r["empresa_codigo"],
                due_date=due_date,
                today=today,
                monto=r["total"],
                moneda=r["moneda"],
                link=f"/ordenes-compra/{r['oc_id']}",
            )
        )
    return out


async def _query_suscripciones(
    db: AsyncSession,
    *,
    today: date,
    from_date: date,
    to_date: date,
    empresa_codigo: str | None,
) -> list[ObligationItem]:
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    suscripcion_id::text  AS suscripcion_id,
                    empresa_codigo,
                    fecha_recibo,
                    monto_clp,
                    contrato_ref
                FROM core.suscripciones_acciones
                WHERE firmado = false
                  AND fecha_recibo IS NOT NULL
                  AND fecha_recibo BETWEEN :from_date AND :to_date
                  AND (:empresa IS NULL OR empresa_codigo = :empresa)
                """
            ),
            {
                "from_date": from_date,
                "to_date": to_date,
                "empresa": empresa_codigo,
            },
        )
    ).mappings().all()

    out: list[ObligationItem] = []
    for r in rows:
        out.append(
            _build_obligation(
                tipo="suscripcion",
                entity_id=str(r["suscripcion_id"]),
                title=(
                    f"Suscripción {r['empresa_codigo']}"
                    + (
                        f" — {r['contrato_ref']}"
                        if r.get("contrato_ref")
                        else ""
                    )
                ),
                subtitle="Pendiente de firma",
                empresa_codigo=r["empresa_codigo"],
                due_date=r["fecha_recibo"],
                today=today,
                monto=r["monto_clp"],
                moneda="CLP",
                link=f"/suscripciones?empresa={r['empresa_codigo']}",
            )
        )
    return out


async def _query_calendar_events(
    db: AsyncSession,
    *,
    today: date,
    from_date: date,
    to_date: date,
    empresa_codigo: str | None,
) -> list[ObligationItem]:
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    event_id::text   AS event_id,
                    empresa_codigo,
                    titulo,
                    descripcion,
                    tipo,
                    fecha_inicio
                FROM core.calendar_events
                WHERE completado = false
                  AND fecha_inicio::date BETWEEN :from_date AND :to_date
                  AND (:empresa IS NULL OR empresa_codigo = :empresa)
                """
            ),
            {
                "from_date": from_date,
                "to_date": to_date,
                "empresa": empresa_codigo,
            },
        )
    ).mappings().all()

    out: list[ObligationItem] = []
    for r in rows:
        fi = r["fecha_inicio"]
        due_date = fi.date() if hasattr(fi, "date") else fi
        out.append(
            _build_obligation(
                tipo="event",
                entity_id=str(r["event_id"]),
                title=str(r["titulo"]),
                subtitle=r["descripcion"] or f"Tipo: {r['tipo']}",
                empresa_codigo=r["empresa_codigo"],
                due_date=due_date,
                today=today,
                monto=None,
                moneda=None,
                link="/calendario",
            )
        )
    return out


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


@router.get(
    "/obligations",
    response_model=list[ObligationItem],
)
async def list_obligations(
    user: CurrentUser,
    db: DBSession,
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    empresa_codigo: str | None = Query(default=None),
    tipo: ObligationTipo | None = Query(default=None),
) -> list[ObligationItem]:
    """Timeline unificado de obligaciones (V3 fase 9).

    Agrega 5 fuentes en una lista única ordenada por `due_date`:

      * F29 con `fecha_vencimiento` y estado != 'pagado'
      * Documentos legales `vigente` con `fecha_vigencia_hasta`
      * OCs `emitida`/`aprobada` (due_date = fecha_emision + plazo_pago)
      * Suscripciones de acciones por firmar (`firmado=false`)
      * Eventos manuales del calendario (no completados)

    Defaults: `from_date=today`, `to_date=today + 90 días`. Permite filtrar
    por `empresa_codigo` y por `tipo` (uno solo).

    Auth: cualquier usuario autenticado (sin scope adicional). El backend
    ya filtra a registros del portafolio operativo.
    """
    today = date.today()
    eff_from = from_date or today
    eff_to = to_date or today + timedelta(days=90)
    if eff_to < eff_from:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="`to_date` debe ser >= `from_date`",
        )

    items: list[ObligationItem] = []
    common_kwargs = {
        "today": today,
        "from_date": eff_from,
        "to_date": eff_to,
        "empresa_codigo": empresa_codigo,
    }
    if tipo is None or tipo == "f29":
        items.extend(await _query_f29(db, **common_kwargs))
    if tipo is None or tipo == "legal":
        items.extend(await _query_legal(db, **common_kwargs))
    if tipo is None or tipo == "oc":
        items.extend(await _query_oc(db, **common_kwargs))
    if tipo is None or tipo == "suscripcion":
        items.extend(await _query_suscripciones(db, **common_kwargs))
    if tipo is None or tipo == "event":
        items.extend(await _query_calendar_events(db, **common_kwargs))

    items.sort(key=lambda o: (o.due_date, o.tipo, o.id))
    return items


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
