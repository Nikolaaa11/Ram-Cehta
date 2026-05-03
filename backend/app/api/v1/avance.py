"""Endpoints de Avance / Gantt (V3 fase 5).

Empresa-scoped: la lectura de proyectos siempre filtra por `empresa_codigo`.
Los hitos heredan empresa via `proyecto_id`. Los riesgos pueden ser
empresa-only o proyecto-scoped.

Soft fail con Dropbox: si Dropbox no está conectado, `/sync-roadmap`
devuelve 503 con mensaje accionable.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.avance_repository import (
    HitoRepository,
    ProyectoRepository,
    RiesgoRepository,
)
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.models.proyecto import Hito, ProyectoEmpresa
from app.schemas.avance import (
    GanttHitoPreview,
    GanttImportPreview,
    GanttImportResult,
    GanttProyectoPreview,
    GanttSyncAllItem,
    GanttSyncAllResult,
    HitoCreate,
    HitoRead,
    HitoUpdate,
    ProyectoCreate,
    ProyectoDetail,
    ProyectoListItem,
    ProyectoRead,
    ProyectoUpdate,
    RiesgoCreate,
    RiesgoRead,
    RiesgoUpdate,
    SyncRoadmapResponse,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.gantt_parser_service import (
    ParsedGantt,
    _normalize_codigo,
    parse_gantt_excel,
)

# Cap defensivo: archivos Excel de Gantt no deberían pasar 5 MB
_MAX_GANTT_BYTES = 5 * 1024 * 1024

# Rutas canónicas en Dropbox donde buscar el Roadmap. La primera es la
# estructura V4 actual; las dos siguientes son fallbacks para layouts
# legacy o variantes de nombre (ej: equipos que aún no migraron).
_ROADMAP_DROPBOX_CANDIDATES = [
    "/Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Roadmap.xlsx",
    "/Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Carta Gantt.xlsx",
    "/Cehta Capital/Proyectos/{empresa}/Roadmap.xlsx",  # legacy V3
]

router = APIRouter()


async def _get_dropbox_service(db: DBSession) -> DropboxService | None:
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        return None
    try:
        return DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured:
        return None


# ---------------------------------------------------------------------------
# Proyectos
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/proyectos",
    response_model=list[ProyectoListItem],
    dependencies=[Depends(require_scope("avance:read"))],
)
async def list_proyectos(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> list[ProyectoListItem]:
    proyecto_repo = ProyectoRepository(db)
    hito_repo = HitoRepository(db)
    riesgo_repo = RiesgoRepository(db)

    proyectos = await proyecto_repo.list_for_empresa(empresa_codigo)
    items: list[ProyectoListItem] = []
    for p in proyectos:
        hitos = await hito_repo.list_for_proyecto(p.proyecto_id)
        riesgos_abiertos = await riesgo_repo.count_abiertos_for_proyecto(p.proyecto_id)
        item = ProyectoListItem.model_validate(
            {
                **{c.name: getattr(p, c.name) for c in p.__table__.columns},
                "hitos": [HitoRead.model_validate(h) for h in hitos],
                "riesgos_abiertos": riesgos_abiertos,
            }
        )
        items.append(item)
    return items


@router.post(
    "/proyectos",
    response_model=ProyectoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_proyecto(
    user: CurrentUser,
    db: DBSession,
    body: ProyectoCreate,
) -> ProyectoRead:
    repo = ProyectoRepository(db)
    proyecto = await repo.create(body)
    await db.commit()
    return ProyectoRead.model_validate(proyecto)


@router.get(
    "/proyectos/{proyecto_id}",
    response_model=ProyectoDetail,
    dependencies=[Depends(require_scope("avance:read"))],
)
async def get_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
) -> ProyectoDetail:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    hitos = await HitoRepository(db).list_for_proyecto(proyecto_id)
    riesgos = await RiesgoRepository(db).list_for_proyecto(proyecto_id)
    return ProyectoDetail.model_validate(
        {
            **{c.name: getattr(proyecto, c.name) for c in proyecto.__table__.columns},
            "hitos": [HitoRead.model_validate(h) for h in hitos],
            "riesgos": [RiesgoRead.model_validate(r) for r in riesgos],
        }
    )


@router.patch(
    "/proyectos/{proyecto_id}",
    response_model=ProyectoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: ProyectoUpdate,
) -> ProyectoRead:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    updated = await repo.update(proyecto, body)
    await db.commit()
    return ProyectoRead.model_validate(updated)


@router.delete(
    "/proyectos/{proyecto_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
) -> Response:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is not None:
        await repo.delete(proyecto)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Hitos
# ---------------------------------------------------------------------------


@router.post(
    "/proyectos/{proyecto_id}/hitos",
    response_model=HitoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_hito(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: HitoCreate,
) -> HitoRead:
    if (await ProyectoRepository(db).get(proyecto_id)) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    hito = await HitoRepository(db).create(proyecto_id, body)
    await db.commit()
    return HitoRead.model_validate(hito)


@router.patch(
    "/hitos/{hito_id}",
    response_model=HitoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_hito(
    user: CurrentUser,
    db: DBSession,
    hito_id: int,
    body: HitoUpdate,
) -> HitoRead:
    repo = HitoRepository(db)
    hito = await repo.get(hito_id)
    if hito is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Hito no encontrado"
        )
    updated = await repo.update(hito, body)
    await db.commit()
    return HitoRead.model_validate(updated)


@router.delete(
    "/hitos/{hito_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_hito(
    user: CurrentUser,
    db: DBSession,
    hito_id: int,
) -> Response:
    repo = HitoRepository(db)
    hito = await repo.get(hito_id)
    if hito is not None:
        await repo.delete(hito)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Riesgos
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/riesgos",
    response_model=list[RiesgoRead],
    dependencies=[Depends(require_scope("avance:read"))],
)
async def list_riesgos_empresa(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
    severidad: str | None = None,
) -> list[RiesgoRead]:
    riesgos = await RiesgoRepository(db).list_for_empresa(empresa_codigo, severidad)
    return [RiesgoRead.model_validate(r) for r in riesgos]


@router.post(
    "/proyectos/{proyecto_id}/riesgos",
    response_model=RiesgoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_riesgo_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: RiesgoCreate,
) -> RiesgoRead:
    proyecto = await ProyectoRepository(db).get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    # Forzar el proyecto_id de la URL y derivar empresa_codigo del proyecto
    body_with_proyecto = body.model_copy(update={"proyecto_id": proyecto_id})
    riesgo = await RiesgoRepository(db).create(
        body_with_proyecto, empresa_codigo_default=proyecto.empresa_codigo
    )
    await db.commit()
    return RiesgoRead.model_validate(riesgo)


@router.post(
    "/riesgos",
    response_model=RiesgoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_riesgo_empresa(
    user: CurrentUser,
    db: DBSession,
    body: RiesgoCreate,
) -> RiesgoRead:
    """Crear riesgo cross-proyecto (sólo empresa_codigo)."""
    if not body.empresa_codigo and body.proyecto_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Falta empresa_codigo o proyecto_id",
        )
    riesgo = await RiesgoRepository(db).create(body)
    await db.commit()
    return RiesgoRead.model_validate(riesgo)


@router.patch(
    "/riesgos/{riesgo_id}",
    response_model=RiesgoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_riesgo(
    user: CurrentUser,
    db: DBSession,
    riesgo_id: int,
    body: RiesgoUpdate,
) -> RiesgoRead:
    repo = RiesgoRepository(db)
    riesgo = await repo.get(riesgo_id)
    if riesgo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Riesgo no encontrado"
        )
    updated = await repo.update(riesgo, body)
    await db.commit()
    return RiesgoRead.model_validate(updated)


@router.delete(
    "/riesgos/{riesgo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_riesgo(
    user: CurrentUser,
    db: DBSession,
    riesgo_id: int,
) -> Response:
    repo = RiesgoRepository(db)
    riesgo = await repo.get(riesgo_id)
    if riesgo is not None:
        await repo.delete(riesgo)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Sync Roadmap.xlsx desde Dropbox
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/sync-roadmap",
    response_model=SyncRoadmapResponse,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def sync_roadmap(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> SyncRoadmapResponse:
    """Detecta `/Cehta Capital/Proyectos/{codigo}/Roadmap.xlsx` y lo registra.

    Implementación mínima V3 fase 5: marca el path en el proyecto base
    (creándolo si no existe). El parsing detallado del Excel queda
    para fase posterior — acá garantizamos al menos visibilidad del path.
    """
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    # Buscar en los candidatos (V4 estructura nueva → fallback legacy)
    candidate_path: str | None = None
    for template in _ROADMAP_DROPBOX_CANDIDATES:
        path = template.format(empresa=empresa_codigo)
        try:
            dbx.dbx.files_get_metadata(path)
            candidate_path = path
            break
        except Exception:
            continue

    if candidate_path is None:
        expected = _ROADMAP_DROPBOX_CANDIDATES[0].format(empresa=empresa_codigo)
        return SyncRoadmapResponse(
            empresa_codigo=empresa_codigo,
            found=False,
            dropbox_path=None,
            message=(
                f"No se encontró Roadmap.xlsx en Dropbox. Esperaba: {expected}"
            ),
        )

    # Si hay proyectos para la empresa, fija el path en el primero;
    # si no, crea un proyecto base con el roadmap.
    repo = ProyectoRepository(db)
    proyectos = await repo.list_for_empresa(empresa_codigo)
    if proyectos:
        for p in proyectos:
            if not p.dropbox_roadmap_path:
                p.dropbox_roadmap_path = candidate_path
                await db.flush()
        await db.commit()
        return SyncRoadmapResponse(
            empresa_codigo=empresa_codigo,
            found=True,
            dropbox_path=candidate_path,
            proyectos_creados=0,
            message="Roadmap detectado y vinculado al proyecto existente.",
        )

    new = await repo.create(
        ProyectoCreate(
            empresa_codigo=empresa_codigo,
            nombre=f"Roadmap {empresa_codigo}",
            descripcion="Proyecto importado desde Roadmap.xlsx en Dropbox.",
            dropbox_roadmap_path=candidate_path,
        )
    )
    await db.commit()
    return SyncRoadmapResponse(
        empresa_codigo=empresa_codigo,
        found=True,
        dropbox_path=new.dropbox_roadmap_path,
        proyectos_creados=1,
        message="Proyecto base creado a partir del Roadmap detectado.",
    )


# ---------------------------------------------------------------------------
# Import Excel Gantt (V4 fase 8) — preview + commit
# ---------------------------------------------------------------------------


def _parsed_to_preview(parsed: ParsedGantt) -> GanttImportPreview:
    """Convierte ParsedGantt (dataclass interno) a GanttImportPreview (Pydantic)."""
    proyectos = [
        GanttProyectoPreview(
            codigo=p.codigo,
            nombre=p.nombre,
            descripcion=p.descripcion,
            estado=p.estado,
            fecha_inicio=p.fecha_inicio,
            fecha_fin_estimada=p.fecha_fin_estimada,
            progreso_pct=p.progreso_pct,
            hitos=[
                GanttHitoPreview(
                    nombre=h.nombre,
                    descripcion=h.descripcion,
                    fecha_planificada=h.fecha_planificada,
                    fecha_completado=h.fecha_completado,
                    estado=h.estado,
                    progreso_pct=h.progreso_pct,
                    orden=h.orden,
                    encargado=h.encargado,
                    monto_real=h.monto_real,
                    monto_proyectado=h.monto_proyectado,
                    actividad_principal=h.actividad_principal,
                    avance_decimal=h.avance_decimal,
                )
                for h in p.hitos
            ],
        )
        for p in parsed.proyectos
    ]
    return GanttImportPreview(
        formato=parsed.formato,  # type: ignore[arg-type]
        empresa_codigo=parsed.empresa_codigo,
        proyectos=proyectos,
        warnings=parsed.warnings,
        total_proyectos=len(proyectos),
        total_hitos=parsed.total_hitos,
    )


async def _read_upload(file: UploadFile) -> bytes:
    """Lee el upload con cap de tamaño y validación mínima."""
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo vacío.",
        )
    if len(content) > _MAX_GANTT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo > {_MAX_GANTT_BYTES // (1024 * 1024)} MB.",
        )
    return content


async def _commit_parsed_gantt(
    db,  # type: ignore[no-untyped-def]
    parsed: ParsedGantt,
    empresa_codigo: str,
    *,
    dropbox_path: str | None = None,
    imported_from: str = "upload",
) -> tuple[int, int, int, int]:
    """Persiste un ParsedGantt en DB con upsert por codigo_excel.

    Devuelve (proyectos_creados, proyectos_actualizados, hitos_creados,
    hitos_actualizados). Hace flush por proyecto pero NO commitea — el
    caller decide cuándo cerrar la transacción.
    """
    proyectos_creados = 0
    proyectos_actualizados = 0
    hitos_creados = 0
    hitos_actualizados = 0

    q = select(ProyectoEmpresa).where(ProyectoEmpresa.empresa_codigo == empresa_codigo)
    existing_list = list((await db.scalars(q)).all())
    by_codigo: dict[str, ProyectoEmpresa] = {}
    by_codigo_norm: dict[str, ProyectoEmpresa] = {}
    for p in existing_list:
        meta = p.metadata_ or {}
        codigo = meta.get("codigo_excel")
        if codigo:
            by_codigo[codigo] = p
            by_codigo_norm[_normalize_codigo(codigo)] = p
        elif p.nombre not in by_codigo:
            by_codigo[p.nombre] = p

    for parsed_proy in parsed.proyectos:
        existing = (
            by_codigo.get(parsed_proy.codigo)
            or by_codigo_norm.get(_normalize_codigo(parsed_proy.codigo))
            or by_codigo.get(parsed_proy.nombre)
        )

        if existing is None:
            new_p = ProyectoEmpresa(
                empresa_codigo=empresa_codigo,
                nombre=parsed_proy.nombre,
                descripcion=parsed_proy.descripcion,
                fecha_inicio=parsed_proy.fecha_inicio,
                fecha_fin_estimada=parsed_proy.fecha_fin_estimada,
                estado=parsed_proy.estado,
                progreso_pct=parsed_proy.progreso_pct,
                dropbox_roadmap_path=dropbox_path,
                metadata_={
                    "codigo_excel": parsed_proy.codigo,
                    "imported_format": parsed.formato,
                    "imported_from": imported_from,
                    **({"dropbox_path": dropbox_path} if dropbox_path else {}),
                },
            )
            db.add(new_p)
            await db.flush()
            await db.refresh(new_p)
            existing = new_p
            proyectos_creados += 1
        else:
            updated = False
            if not existing.fecha_inicio and parsed_proy.fecha_inicio:
                existing.fecha_inicio = parsed_proy.fecha_inicio
                updated = True
            if not existing.fecha_fin_estimada and parsed_proy.fecha_fin_estimada:
                existing.fecha_fin_estimada = parsed_proy.fecha_fin_estimada
                updated = True
            if existing.progreso_pct != parsed_proy.progreso_pct:
                existing.progreso_pct = parsed_proy.progreso_pct
                updated = True
            if existing.estado != parsed_proy.estado:
                existing.estado = parsed_proy.estado
                updated = True
            if dropbox_path and not existing.dropbox_roadmap_path:
                existing.dropbox_roadmap_path = dropbox_path
                updated = True
            current_meta = existing.metadata_ or {}
            new_meta = {
                **current_meta,
                "codigo_excel": parsed_proy.codigo,
                "imported_format": parsed.formato,
                "imported_from": imported_from,
            }
            if dropbox_path:
                new_meta["dropbox_path"] = dropbox_path
            if current_meta != new_meta:
                existing.metadata_ = new_meta
                updated = True
            if updated:
                proyectos_actualizados += 1

        q_hitos = select(Hito).where(Hito.proyecto_id == existing.proyecto_id)
        existing_hitos = list((await db.scalars(q_hitos)).all())
        existing_names = {h.nombre.strip().lower(): h for h in existing_hitos}

        for parsed_hito in parsed_proy.hitos:
            key = parsed_hito.nombre.strip().lower()
            if key in existing_names:
                h = existing_names[key]
                changed = False
                if h.estado != parsed_hito.estado:
                    h.estado = parsed_hito.estado
                    changed = True
                if h.progreso_pct != parsed_hito.progreso_pct:
                    h.progreso_pct = parsed_hito.progreso_pct
                    changed = True
                if not h.fecha_completado and parsed_hito.fecha_completado:
                    h.fecha_completado = parsed_hito.fecha_completado
                    changed = True
                if changed:
                    hitos_actualizados += 1
            else:
                new_h = Hito(
                    proyecto_id=existing.proyecto_id,
                    nombre=parsed_hito.nombre,
                    descripcion=parsed_hito.descripcion,
                    fecha_planificada=parsed_hito.fecha_planificada,
                    fecha_completado=parsed_hito.fecha_completado,
                    estado=parsed_hito.estado,
                    orden=parsed_hito.orden,
                    progreso_pct=parsed_hito.progreso_pct,
                )
                db.add(new_h)
                hitos_creados += 1

        await db.flush()

    return proyectos_creados, proyectos_actualizados, hitos_creados, hitos_actualizados


@router.post(
    "/{empresa_codigo}/import-excel/preview",
    response_model=GanttImportPreview,
    dependencies=[Depends(require_scope("avance:read"))],
)
async def import_gantt_preview(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
    file: UploadFile = File(..., description="Excel del Gantt a previsualizar"),
) -> GanttImportPreview:
    """Modo dry-run: parsea el Excel y devuelve preview sin tocar DB.

    El frontend muestra al usuario los proyectos/hitos detectados y los
    warnings antes de pedir confirmación para el commit.
    """
    content = await _read_upload(file)
    try:
        parsed = parse_gantt_excel(content, empresa_codigo=empresa_codigo)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    return _parsed_to_preview(parsed)


@router.post(
    "/{empresa_codigo}/import-excel/commit",
    response_model=GanttImportResult,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def import_gantt_commit(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
    file: UploadFile = File(..., description="Excel del Gantt a importar"),
) -> GanttImportResult:
    """Modo persistencia: parsea el Excel y crea/actualiza proyectos+hitos.

    Estrategia upsert por `metadata_.codigo_excel`:
    - Si existe un proyecto en DB con ese codigo en metadata, se actualiza.
    - Si no existe, se crea.
    - Hitos: estrategia conservadora — sólo se crean los que no existen
      (match por proyecto + nombre normalizado). Esto evita pisar
      ediciones manuales que el usuario haya hecho desde la UI.

    Para forzar reset completo, el usuario puede borrar los proyectos
    primero desde la UI.
    """
    content = await _read_upload(file)
    try:
        parsed = parse_gantt_excel(content, empresa_codigo=empresa_codigo)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    if parsed.formato == "unknown":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="; ".join(parsed.warnings) or "Formato de Gantt no reconocido.",
        )

    pc, pa, hc, ha = await _commit_parsed_gantt(
        db, parsed, empresa_codigo, imported_from="upload"
    )
    await db.commit()

    return GanttImportResult(
        formato=parsed.formato,  # type: ignore[arg-type]
        empresa_codigo=empresa_codigo,
        proyectos_creados=pc,
        proyectos_actualizados=pa,
        hitos_creados=hc,
        hitos_actualizados=ha,
        warnings=parsed.warnings,
        message=(
            f"Importados {pc} proyectos nuevos + {pa} actualizados, "
            f"{hc} hitos nuevos + {ha} actualizados."
        ),
    )


@router.post(
    "/{empresa_codigo}/import-excel/sync-from-dropbox",
    response_model=GanttImportResult,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def sync_gantt_from_dropbox(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> GanttImportResult:
    """Descarga el Roadmap.xlsx desde Dropbox, lo parsea y commitea.

    Busca en orden:
    1. /Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Roadmap.xlsx
    2. /Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Carta Gantt.xlsx
    3. /Cehta Capital/Proyectos/{empresa}/Roadmap.xlsx (legacy V3)

    Si no encuentra archivo en ninguno de los candidatos, devuelve 404.
    Si Dropbox no está conectado, devuelve 503.

    Atajo: 1 click sincroniza el Gantt de la empresa sin tener que
    descargar el archivo a tu disco y volver a subirlo.
    """
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    # Buscar archivo en los candidatos
    found_path: str | None = None
    for template in _ROADMAP_DROPBOX_CANDIDATES:
        path = template.format(empresa=empresa_codigo)
        try:
            dbx.dbx.files_get_metadata(path)
            found_path = path
            break
        except Exception:
            continue

    if found_path is None:
        expected = _ROADMAP_DROPBOX_CANDIDATES[0].format(empresa=empresa_codigo)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Roadmap.xlsx no encontrado en Dropbox. "
                f"Subilo a: {expected}"
            ),
        )

    # Descargar archivo
    try:
        content = dbx.download_file(found_path)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error descargando desde Dropbox: {e}",
        ) from e

    if len(content) > _MAX_GANTT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo > {_MAX_GANTT_BYTES // (1024 * 1024)} MB.",
        )

    # Parsear y commitear (reusa la lógica del endpoint commit)
    try:
        parsed = parse_gantt_excel(content, empresa_codigo=empresa_codigo)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e

    if parsed.formato == "unknown":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="; ".join(parsed.warnings) or "Formato no reconocido.",
        )

    pc, pa, hc, ha = await _commit_parsed_gantt(
        db,
        parsed,
        empresa_codigo,
        dropbox_path=found_path,
        imported_from="dropbox",
    )
    await db.commit()

    return GanttImportResult(
        formato=parsed.formato,  # type: ignore[arg-type]
        empresa_codigo=empresa_codigo,
        proyectos_creados=pc,
        proyectos_actualizados=pa,
        hitos_creados=hc,
        hitos_actualizados=ha,
        warnings=parsed.warnings,
        message=(
            f"Sincronizado desde Dropbox ({found_path}): "
            f"{pc} proyectos nuevos + {pa} actualizados, "
            f"{hc} hitos nuevos + {ha} actualizados."
        ),
    )


@router.post(
    "/sync-all-from-dropbox",
    response_model=GanttSyncAllResult,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def sync_all_gantts_from_dropbox(
    user: CurrentUser,
    db: DBSession,
) -> GanttSyncAllResult:
    """Sincroniza los Gantts de TODAS las empresas del portafolio desde Dropbox.

    Itera por cada empresa registrada y busca su Roadmap.xlsx en:
        /Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Roadmap.xlsx

    Para cada empresa:
    - Si el archivo existe → descarga, parsea, upserta proyectos+hitos.
    - Si no existe → reporta `not_found` y sigue con la siguiente.
    - Si falla el parser → reporta `error` y sigue.

    Aislamiento: las empresas que fallan NO afectan a las demás. Cada
    empresa se procesa con flush propio. El commit final es uno solo.

    El endpoint devuelve un resumen agregado con detalle por empresa.
    """
    from app.models.empresa import Empresa  # local import to avoid circular

    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    # Cargar todas las empresas
    q = select(Empresa).order_by(Empresa.codigo)
    empresas = list((await db.scalars(q)).all())

    items: list[GanttSyncAllItem] = []
    proyectos_creados_total = 0
    proyectos_actualizados_total = 0
    hitos_creados_total = 0
    hitos_actualizados_total = 0
    sincronizadas = 0
    no_encontradas = 0
    con_error = 0

    for emp in empresas:
        empresa_codigo = emp.codigo

        # Buscar el archivo en Dropbox
        found_path: str | None = None
        for template in _ROADMAP_DROPBOX_CANDIDATES:
            path = template.format(empresa=empresa_codigo)
            try:
                dbx.dbx.files_get_metadata(path)
                found_path = path
                break
            except Exception:
                continue

        if found_path is None:
            no_encontradas += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="not_found",
                    message="Sin Roadmap.xlsx en Dropbox",
                )
            )
            continue

        # Descargar + parsear
        try:
            content = dbx.download_file(found_path)
        except Exception as e:  # noqa: BLE001
            con_error += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="error",
                    message=f"Error descargando: {e}",
                    dropbox_path=found_path,
                )
            )
            continue

        if len(content) > _MAX_GANTT_BYTES:
            con_error += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="error",
                    message=f"Archivo > {_MAX_GANTT_BYTES // (1024 * 1024)} MB",
                    dropbox_path=found_path,
                )
            )
            continue

        try:
            parsed = parse_gantt_excel(content, empresa_codigo=empresa_codigo)
        except ValueError as e:
            con_error += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="error",
                    message=f"Error parseando: {e}",
                    dropbox_path=found_path,
                )
            )
            continue

        if parsed.formato == "unknown":
            con_error += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="error",
                    message="; ".join(parsed.warnings)[:200]
                    or "Formato no reconocido",
                    dropbox_path=found_path,
                )
            )
            continue

        # Persistir
        try:
            pc, pa, hc, ha = await _commit_parsed_gantt(
                db,
                parsed,
                empresa_codigo,
                dropbox_path=found_path,
                imported_from="dropbox",
            )
        except Exception as e:  # noqa: BLE001
            con_error += 1
            items.append(
                GanttSyncAllItem(
                    empresa_codigo=empresa_codigo,
                    status="error",
                    message=f"Error guardando: {e}",
                    dropbox_path=found_path,
                )
            )
            await db.rollback()
            continue

        sincronizadas += 1
        proyectos_creados_total += pc
        proyectos_actualizados_total += pa
        hitos_creados_total += hc
        hitos_actualizados_total += ha
        items.append(
            GanttSyncAllItem(
                empresa_codigo=empresa_codigo,
                status="ok",
                formato=parsed.formato,
                proyectos_creados=pc,
                proyectos_actualizados=pa,
                hitos_creados=hc,
                hitos_actualizados=ha,
                message=f"+{pc} proyectos / +{hc} hitos",
                dropbox_path=found_path,
            )
        )

    await db.commit()

    return GanttSyncAllResult(
        total_empresas=len(empresas),
        sincronizadas=sincronizadas,
        no_encontradas=no_encontradas,
        con_error=con_error,
        items=items,
        proyectos_creados_total=proyectos_creados_total,
        proyectos_actualizados_total=proyectos_actualizados_total,
        hitos_creados_total=hitos_creados_total,
        hitos_actualizados_total=hitos_actualizados_total,
        message=(
            f"{sincronizadas} sincronizadas, {no_encontradas} sin Gantt, "
            f"{con_error} con error · "
            f"+{proyectos_creados_total} proyectos / +{hitos_creados_total} hitos"
        ),
    )


@router.delete(
    "/{empresa_codigo}/import-excel/proyectos-importados",
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_imported_proyectos(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> dict[str, int | str]:
    """Borra todos los proyectos importados desde Excel para esta empresa.

    Identifica los importados por la presencia de `metadata_.codigo_excel`.
    Los proyectos creados manualmente (sin codigo_excel) no se tocan.
    Los hitos asociados se borran en cascada (ondelete CASCADE en FK).
    """
    q = select(ProyectoEmpresa).where(ProyectoEmpresa.empresa_codigo == empresa_codigo)
    proyectos = list((await db.scalars(q)).all())
    borrados = 0
    for p in proyectos:
        meta = p.metadata_ or {}
        if meta.get("codigo_excel"):
            await db.delete(p)
            borrados += 1
    await db.commit()
    return {
        "empresa_codigo": empresa_codigo,
        "proyectos_borrados": borrados,
        "message": f"Se eliminaron {borrados} proyectos importados desde Excel.",
    }
