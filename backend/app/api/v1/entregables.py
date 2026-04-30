"""Endpoints — Entregables Regulatorios FIP CEHTA ESG (V4 fase 6).

Diseño:
- `nivel_alerta` y `dias_restantes` se calculan server-side en cada GET
  (no se persisten — siempre frescos respecto al "hoy" actual).
- Marcar como `entregado` un recurrente (mensual/trimestral/...) NO
  auto-genera la próxima instancia desde acá — eso lo hace el seed
  pre-cargado para 2025/2026, y el endpoint POST /serie para extender.
- Compliance: el campo `es_publico` queda forzado a False (restricción
  del PROMPT_MAESTRO Bloque 10).
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.entregable import (
    Categoria,
    EntregableCreate,
    EntregableEstadosCounts,
    EntregableRead,
    EntregableUpdate,
    EstadoEntregable,
    GenerarSerieRequest,
    GenerarSerieResponse,
    NivelAlerta,
    ReporteRegulatorio,
)
from app.services.audit_service import audit_log

router = APIRouter()

_FIELDS = (
    "entregable_id, id_template, nombre, descripcion, categoria, subcategoria, "
    "referencia_normativa, fecha_limite, frecuencia, prioridad, responsable, "
    "estado, fecha_entrega_real, motivo_no_entrega, notas, adjunto_url, "
    "periodo, alerta_15, alerta_10, alerta_5, generado_automaticamente, "
    "es_publico, extra, created_at, updated_at"
)


def _calcular_alerta(fecha_limite: date, estado: str) -> tuple[NivelAlerta, int]:
    """Replica la lógica del PROMPT_MAESTRO Bloque 3.1.

    Si ya está entregado, devolvemos 'normal' aunque la fecha haya pasado —
    no tiene sentido mostrar alerta de algo ya cumplido.
    """
    if estado == "entregado":
        diff = (fecha_limite - date.today()).days
        return ("normal", diff)
    diff = (fecha_limite - date.today()).days
    if diff < 0:
        return ("vencido", diff)
    if diff == 0:
        return ("hoy", 0)
    if diff <= 5:
        return ("critico", diff)
    if diff <= 10:
        return ("urgente", diff)
    if diff <= 15:
        return ("proximo", diff)
    if diff <= 30:
        return ("en_rango", diff)
    return ("normal", diff)


def _row_to_read(row: dict[str, Any]) -> EntregableRead:
    nivel, dias = _calcular_alerta(row["fecha_limite"], row["estado"])
    return EntregableRead(
        entregable_id=row["entregable_id"],
        id_template=row["id_template"],
        nombre=row["nombre"],
        descripcion=row.get("descripcion"),
        categoria=row["categoria"],
        subcategoria=row.get("subcategoria"),
        referencia_normativa=row.get("referencia_normativa"),
        fecha_limite=row["fecha_limite"],
        frecuencia=row["frecuencia"],
        prioridad=row["prioridad"],
        responsable=row["responsable"],
        estado=row["estado"],
        fecha_entrega_real=row.get("fecha_entrega_real"),
        motivo_no_entrega=row.get("motivo_no_entrega"),
        notas=row.get("notas"),
        adjunto_url=row.get("adjunto_url"),
        periodo=row["periodo"],
        alerta_15=row["alerta_15"],
        alerta_10=row["alerta_10"],
        alerta_5=row["alerta_5"],
        generado_automaticamente=row["generado_automaticamente"],
        es_publico=row["es_publico"],
        extra=row.get("extra"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        nivel_alerta=nivel,
        dias_restantes=dias,
    )


# ---------------------------------------------------------------------------
# GET / — listado paginado + filtros
# ---------------------------------------------------------------------------
@router.get("", response_model=list[EntregableRead])
async def list_entregables(
    user: CurrentUser,
    db: DBSession,
    categoria: Categoria | None = None,
    estado: EstadoEntregable | None = None,
    anio: int | None = Query(None, ge=2024, le=2030),
    desde: date | None = None,
    hasta: date | None = None,
    only_alerta: bool = Query(False, description="Solo entregables en alerta activa"),
) -> list[EntregableRead]:
    """Lista entregables con filtros opcionales.

    Si `only_alerta=true`, solo devuelve los que estén en estado pendiente o
    en_proceso AND con días_restantes ≤ 15 (criterio del banner del frontend).
    """
    conditions: list[str] = []
    params: dict[str, Any] = {}
    if categoria:
        conditions.append("categoria = :categoria")
        params["categoria"] = categoria
    if estado:
        conditions.append("estado = :estado")
        params["estado"] = estado
    if anio:
        conditions.append("EXTRACT(year FROM fecha_limite) = :anio")
        params["anio"] = anio
    if desde:
        conditions.append("fecha_limite >= :desde")
        params["desde"] = desde
    if hasta:
        conditions.append("fecha_limite <= :hasta")
        params["hasta"] = hasta
    if only_alerta:
        conditions.append(
            "estado IN ('pendiente','en_proceso') "
            "AND fecha_limite <= (CURRENT_DATE + INTERVAL '15 days')"
        )

    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                f"{where} ORDER BY fecha_limite ASC"
            ),
            params,
        )
    ).mappings().all()
    return [_row_to_read(dict(r)) for r in rows]


# ---------------------------------------------------------------------------
# GET /counts — contadores por estado para el header del módulo
# ---------------------------------------------------------------------------
@router.get("/counts", response_model=EntregableEstadosCounts)
async def get_counts(
    user: CurrentUser, db: DBSession
) -> EntregableEstadosCounts:
    """Conteo por estado, sin filtros — para el header KPI del módulo."""
    rows = (
        await db.execute(
            text(
                "SELECT estado, COUNT(*) AS n "
                "FROM app.entregables_regulatorios "
                "GROUP BY estado"
            )
        )
    ).mappings().all()
    counts = EntregableEstadosCounts()
    for r in rows:
        if hasattr(counts, r["estado"]):
            setattr(counts, r["estado"], r["n"])
    return counts


# ---------------------------------------------------------------------------
# GET /reporte-regulatorio — resumen para actas Comité Vigilancia
# ---------------------------------------------------------------------------
@router.get("/reporte-regulatorio", response_model=ReporteRegulatorio)
async def reporte_regulatorio(
    user: CurrentUser, db: DBSession
) -> ReporteRegulatorio:
    """Snapshot ejecutivo: counts + próximos 30d + vencidos + tasa cumplimiento."""
    counts_rows = (
        await db.execute(
            text(
                "SELECT estado, COUNT(*) AS n FROM app.entregables_regulatorios "
                "GROUP BY estado"
            )
        )
    ).mappings().all()
    counts = EntregableEstadosCounts()
    for r in counts_rows:
        if hasattr(counts, r["estado"]):
            setattr(counts, r["estado"], r["n"])

    proximos = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE estado IN ('pendiente','en_proceso') "
                "AND fecha_limite >= CURRENT_DATE "
                "AND fecha_limite <= (CURRENT_DATE + INTERVAL '30 days') "
                "ORDER BY fecha_limite ASC"
            )
        )
    ).mappings().all()

    vencidos = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE estado IN ('pendiente','en_proceso') "
                "AND fecha_limite < CURRENT_DATE "
                "ORDER BY fecha_limite ASC"
            )
        )
    ).mappings().all()

    # Tasa de cumplimiento YTD: del 1 enero del año actual hasta hoy.
    today = date.today()
    ytd_total_row = (
        await db.execute(
            text(
                "SELECT COUNT(*) AS n FROM app.entregables_regulatorios "
                "WHERE fecha_limite >= make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1) "
                "AND fecha_limite < CURRENT_DATE"
            )
        )
    ).first()
    ytd_entregados_row = (
        await db.execute(
            text(
                "SELECT COUNT(*) AS n FROM app.entregables_regulatorios "
                "WHERE fecha_limite >= make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1) "
                "AND fecha_limite < CURRENT_DATE "
                "AND estado = 'entregado'"
            )
        )
    ).first()

    total_ytd = ytd_total_row[0] if ytd_total_row else 0
    entregados_ytd = ytd_entregados_row[0] if ytd_entregados_row else 0
    tasa = (entregados_ytd / total_ytd * 100.0) if total_ytd > 0 else 100.0

    return ReporteRegulatorio(
        generado_at=datetime.now(UTC),
        estados=counts,
        proximos_30d=[_row_to_read(dict(r)) for r in proximos],
        vencidos_sin_entregar=[_row_to_read(dict(r)) for r in vencidos],
        tasa_cumplimiento_ytd=round(tasa, 1),
        total_ytd=total_ytd,
        entregados_ytd=entregados_ytd,
    )


# ---------------------------------------------------------------------------
# GET /{id} — detalle
# ---------------------------------------------------------------------------
@router.get("/{entregable_id}", response_model=EntregableRead)
async def get_entregable(
    user: CurrentUser, db: DBSession, entregable_id: int
) -> EntregableRead:
    row = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE entregable_id = :id"
            ),
            {"id": entregable_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entregable no encontrado"
        )
    return _row_to_read(dict(row))


# ---------------------------------------------------------------------------
# POST / — crear entregable nuevo
# ---------------------------------------------------------------------------
@router.post("", response_model=EntregableRead, status_code=status.HTTP_201_CREATED)
async def create_entregable(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    request: Request,
    body: EntregableCreate,
) -> EntregableRead:
    """Crea un entregable manual. Reusa scope `audit:read` (admin) — la
    creación de entregables regulatorios es operación de gobernanza."""
    res = await db.execute(
        text(
            """
            INSERT INTO app.entregables_regulatorios (
                id_template, nombre, descripcion, categoria, subcategoria,
                referencia_normativa, fecha_limite, frecuencia, prioridad,
                responsable, estado, periodo, alerta_15, alerta_10, alerta_5,
                notas, adjunto_url, generado_automaticamente, es_publico, extra,
                created_by
            ) VALUES (
                :id_template, :nombre, :descripcion, :categoria, :subcategoria,
                :referencia_normativa, :fecha_limite, :frecuencia, :prioridad,
                :responsable, :estado, :periodo, :alerta_15, :alerta_10, :alerta_5,
                :notas, :adjunto_url, :generado_automaticamente, FALSE, :extra,
                :uid
            ) RETURNING entregable_id
            """
        ),
        {
            "id_template": body.id_template,
            "nombre": body.nombre,
            "descripcion": body.descripcion,
            "categoria": body.categoria,
            "subcategoria": body.subcategoria,
            "referencia_normativa": body.referencia_normativa,
            "fecha_limite": body.fecha_limite,
            "frecuencia": body.frecuencia,
            "prioridad": body.prioridad,
            "responsable": body.responsable,
            "estado": body.estado,
            "periodo": body.periodo,
            "alerta_15": body.alerta_15,
            "alerta_10": body.alerta_10,
            "alerta_5": body.alerta_5,
            "notas": body.notas,
            "adjunto_url": body.adjunto_url,
            "generado_automaticamente": False,
            "extra": body.extra,
            "uid": user.sub,
        },
    )
    new_id = res.scalar_one()
    await db.commit()

    row = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE entregable_id = :id"
            ),
            {"id": new_id},
        )
    ).mappings().one()
    created = _row_to_read(dict(row))

    await audit_log(
        db, request, user,
        action="create",
        entity_type="entregable",
        entity_id=str(new_id),
        entity_label=f"{body.categoria} · {body.periodo}",
        summary=f"Creó entregable {body.id_template} ({body.periodo})",
        before=None,
        after=created.model_dump(mode="json"),
    )
    return created


# ---------------------------------------------------------------------------
# PATCH /{id} — actualizar (estado, notas, adjunto, etc.)
# ---------------------------------------------------------------------------
@router.patch("/{entregable_id}", response_model=EntregableRead)
async def update_entregable(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    request: Request,
    entregable_id: int,
    body: EntregableUpdate,
) -> EntregableRead:
    before_row = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE entregable_id = :id"
            ),
            {"id": entregable_id},
        )
    ).mappings().first()
    if not before_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entregable no encontrado"
        )
    before = _row_to_read(dict(before_row)).model_dump(mode="json")

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _row_to_read(dict(before_row))

    # Si marcaron como entregado y no enviaron fecha_entrega_real, default a hoy
    if fields.get("estado") == "entregado" and "fecha_entrega_real" not in fields:
        fields["fecha_entrega_real"] = date.today()

    sets = [f"{k} = :{k}" for k in fields]
    sets.append("updated_at = now()")
    sets.append("updated_by = :uid")
    params = dict(fields)
    params["id"] = entregable_id
    params["uid"] = user.sub

    await db.execute(
        text(
            f"UPDATE app.entregables_regulatorios SET {', '.join(sets)} "  # noqa: S608
            "WHERE entregable_id = :id"
        ),
        params,
    )
    await db.commit()

    after_row = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE entregable_id = :id"
            ),
            {"id": entregable_id},
        )
    ).mappings().one()
    updated = _row_to_read(dict(after_row))

    await audit_log(
        db, request, user,
        action="update",
        entity_type="entregable",
        entity_id=str(entregable_id),
        entity_label=f"{updated.categoria} · {updated.periodo}",
        summary=(
            f"Actualizó {updated.id_template} → estado={updated.estado}"
            if "estado" in fields
            else f"Editó {updated.id_template}"
        ),
        before=before,
        after=updated.model_dump(mode="json"),
    )
    return updated


# ---------------------------------------------------------------------------
# DELETE /{id}
# ---------------------------------------------------------------------------
@router.delete("/{entregable_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entregable(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    request: Request,
    entregable_id: int,
) -> Response:
    before_row = (
        await db.execute(
            text(
                f"SELECT {_FIELDS} FROM app.entregables_regulatorios "
                "WHERE entregable_id = :id"
            ),
            {"id": entregable_id},
        )
    ).mappings().first()
    if not before_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entregable no encontrado"
        )
    before = _row_to_read(dict(before_row)).model_dump(mode="json")

    await db.execute(
        text("DELETE FROM app.entregables_regulatorios WHERE entregable_id = :id"),
        {"id": entregable_id},
    )
    await db.commit()

    await audit_log(
        db, request, user,
        action="delete",
        entity_type="entregable",
        entity_id=str(entregable_id),
        entity_label=f"{before['categoria']} · {before['periodo']}",
        summary=f"Eliminó entregable {before['id_template']} ({before['periodo']})",
        before=before,
        after=None,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# POST /serie — generar instancias de un template recurrente para un año
# ---------------------------------------------------------------------------
def _fechas_del_anio(frecuencia: str, anio: int) -> list[tuple[str, date]]:
    """Genera (periodo, fecha_limite) según frecuencia y año.

    Las fechas son aproximaciones razonables — el usuario puede luego
    ajustar instancia por instancia via PATCH si una fecha específica
    necesita corregirse (ej. feriado).
    """
    import calendar as cal

    out: list[tuple[str, date]] = []
    if frecuencia == "mensual":
        for m in range(1, 13):
            last = cal.monthrange(anio, m)[1]
            out.append((f"{m:02d}-{anio}", date(anio, m, last)))
    elif frecuencia == "trimestral":
        # 30 días después del cierre de cada trimestre
        for q, m_close in [(1, 3), (2, 6), (3, 9), (4, 12)]:
            last_close = cal.monthrange(anio, m_close)[1]
            close = date(anio, m_close, last_close)
            # 5to día hábil tras cierre — aproximamos a +30 días naturales
            from datetime import timedelta

            entrega = close + timedelta(days=30)
            out.append((f"Q{q}-{anio}", entrega))
    elif frecuencia == "semestral":
        out.append((f"S1-{anio}", date(anio, 7, 31)))
        out.append((f"S2-{anio}", date(anio + 1, 1, 31)))
    elif frecuencia == "anual":
        out.append((f"{anio}", date(anio + 1, 4, 30)))
    elif frecuencia == "bienal":
        out.append((f"{anio}-{anio + 1}", date(anio + 1, 12, 31)))
    return out


@router.post(
    "/serie",
    response_model=GenerarSerieResponse,
    status_code=status.HTTP_201_CREATED,
)
async def generar_serie(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    request: Request,
    body: GenerarSerieRequest,
) -> GenerarSerieResponse:
    """Genera todas las instancias de un template recurrente para un año.

    Idempotente — usa ON CONFLICT (id_template, periodo) DO NOTHING. Si
    ya hay instancias para ese año, se ignoran (cuenta vuelve en `instancias_existentes`).
    """
    fechas = _fechas_del_anio(body.frecuencia, body.anio)
    creadas = 0
    existentes = 0
    fechas_creadas: list[date] = []

    for periodo, fecha in fechas:
        res = await db.execute(
            text(
                """
                INSERT INTO app.entregables_regulatorios (
                    id_template, nombre, descripcion, categoria, subcategoria,
                    referencia_normativa, fecha_limite, frecuencia, prioridad,
                    responsable, periodo, alerta_15, alerta_10, alerta_5,
                    generado_automaticamente, es_publico, created_by
                ) VALUES (
                    :id_template, :nombre, :descripcion, :categoria, :subcategoria,
                    :referencia_normativa, :fecha, :frecuencia, :prioridad,
                    :responsable, :periodo, :a15, :a10, :a5,
                    TRUE, FALSE, :uid
                )
                ON CONFLICT (id_template, periodo) DO NOTHING
                RETURNING entregable_id
                """
            ),
            {
                "id_template": body.id_template,
                "nombre": body.nombre,
                "descripcion": body.descripcion,
                "categoria": body.categoria,
                "subcategoria": body.subcategoria,
                "referencia_normativa": body.referencia_normativa,
                "fecha": fecha,
                "frecuencia": body.frecuencia,
                "prioridad": body.prioridad,
                "responsable": body.responsable,
                "periodo": periodo,
                "a15": body.alerta_15,
                "a10": body.alerta_10,
                "a5": body.alerta_5,
                "uid": user.sub,
            },
        )
        row = res.first()
        if row is not None:
            creadas += 1
            fechas_creadas.append(fecha)
        else:
            existentes += 1
    await db.commit()

    await audit_log(
        db, request, user,
        action="create",
        entity_type="entregable_serie",
        entity_id=f"{body.id_template}:{body.anio}",
        entity_label=f"{body.categoria} · serie {body.anio}",
        summary=(
            f"Generó serie {body.id_template} {body.anio}: "
            f"{creadas} creadas, {existentes} ya existentes"
        ),
        before=None,
        after={"creadas": creadas, "existentes": existentes},
    )

    return GenerarSerieResponse(
        template=body.id_template,
        anio=body.anio,
        instancias_creadas=creadas,
        instancias_existentes=existentes,
        fechas=fechas_creadas,
    )
