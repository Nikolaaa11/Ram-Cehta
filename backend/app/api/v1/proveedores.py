"""CRUD Proveedores — Session 2.3."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.models.proveedor import Proveedor
from app.schemas.common import Page
from app.schemas.proveedor import ProveedorCreate, ProveedorRead, ProveedorUpdate
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import EmpresaScopeDep

router = APIRouter()


class ProveedorSearchResult(BaseModel):
    """Respuesta de busqueda por RUT para autocompletado en formularios.

    Pensado para que el FE muestre estados claros mientras el user tipea:
      - rut_valid=False  -> "RUT invalido (digito verificador)"
      - exists=True       -> precarga datos del proveedor existente
      - exists=False      -> "Proveedor no existe, se creara automaticamente"
    """

    rut_valid: bool
    rut_canonical: str | None = None
    exists: bool
    proveedor: ProveedorRead | None = None


class ProveedorSearchHit(BaseModel):
    """Item liviano del resultado de /search?q= (autocompletado fuzzy)."""

    proveedor_id: int
    razon_social: str
    rut: str | None = None
    vouchers_count: int = 0
    ordenes_compra_count: int = 0


class DuplicateProveedorMember(BaseModel):
    proveedor_id: int
    razon_social: str
    rut: str | None
    created_at: str
    vouchers_count: int = 0
    ordenes_compra_count: int = 0


class DuplicateProveedorGroup(BaseModel):
    """Grupo de proveedores candidatos a fusión.

    Normalizamos `razon_social` a `[A-Z0-9]+` (quitando puntos, espacios y
    caracteres no alfanumericos) y agrupamos los que comparten esa clave.
    Asi 'ACME SpA', 'A.C.M.E. S.p.A.' y 'acme spa' caen en el mismo grupo.
    """

    normalized_key: str
    members: list[DuplicateProveedorMember]


class MergeProveedorResponse(BaseModel):
    """Respuesta de POST /proveedores/{src}/merge-into/{target}.

    Reporta cuantas referencias se movieron y deja el proveedor source como
    inactivo (soft-delete). La operacion es idempotente: re-llamar con los
    mismos ids no afecta nada (el source ya esta inactivo).
    """

    source_id: int
    target_id: int
    target_razon_social: str
    target_rut: str | None
    vouchers_moved: int
    ordenes_compra_moved: int
    source_deactivated: bool


@router.get("", response_model=Page[ProveedorRead])
async def list_proveedores(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    search: str | None = None,
    with_counts: bool = False,
) -> Page[ProveedorRead]:
    """Lista proveedores activos paginados. Si `with_counts=true`, agrega
    `vouchers_count` y `ordenes_compra_count` a cada item (1 query extra
    agregada). Util para la pantalla /admin/proveedores donde queremos
    ver el uso real de cada proveedor.

    Los counts se filtran por las empresas accesibles al user (multi-tenant)
    para evitar leak de usage patterns cross-tenant.
    """
    repo = ProveedorRepository(db)
    items, total = await repo.list(page=page, size=size, search=search)
    counts_map: dict[int, dict[str, int]] = {}
    if with_counts and items:
        scoped_codes = scope.filter_codes(None)
        counts_map = await repo.counts_by_proveedor(
            [p.proveedor_id for p in items],
            empresa_codigos=scoped_codes,
        )
    enriched: list[ProveedorRead] = []
    for p in items:
        item = ProveedorRead.model_validate(p)
        if with_counts:
            counts = counts_map.get(p.proveedor_id, {})
            item = item.model_copy(
                update={
                    "vouchers_count": counts.get("vouchers", 0),
                    "ordenes_compra_count": counts.get("ordenes_compra", 0),
                }
            )
        enriched.append(item)
    return Page.build(items=enriched, total=total, page=page, size=size)


@router.post("", response_model=ProveedorRead, status_code=status.HTTP_201_CREATED)
async def create_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:create"))],
    db: DBSession,
    request: Request,
    body: ProveedorCreate,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    if body.rut:
        existing = await repo.get_by_rut(body.rut)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RUT {body.rut} ya existe (proveedor_id={existing.proveedor_id})",
            )
    proveedor = await repo.create(body)
    await db.commit()
    created = ProveedorRead.model_validate(proveedor)
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="proveedor",
        entity_id=str(created.proveedor_id),
        entity_label=created.razon_social,
        summary=f"Proveedor '{created.razon_social}' creado",
        before=None,
        after=created.model_dump(mode="json"),
    )
    return created


@router.get("/duplicates", response_model=list[DuplicateProveedorGroup])
async def list_duplicate_groups(
    user: CurrentUser,
    db: DBSession,
    limit_groups: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[DuplicateProveedorGroup]:
    """Detecta proveedores candidatos a fusion por razon social normalizada.

    Normaliza razon_social a [A-Z0-9]+ y agrupa los que comparten key.
    Devuelve solo grupos con 2+ miembros, ordenados por tamano descendiente.

    Pensado para que el admin revise duplicados en /admin/proveedores y
    decida cual mantener (fusion manual via PATCH/DELETE — la fusion
    automatica requiere mover referencias en vouchers/OCs y se hace en
    una pasada manual fuera del endpoint).

    IMPORTANTE: declarado antes de /{proveedor_id: int} para evitar colision.
    """
    rows = (
        await db.execute(
            text(
                """
                WITH normalized AS (
                    SELECT
                        proveedor_id,
                        razon_social,
                        rut,
                        created_at,
                        regexp_replace(upper(razon_social), '[^A-Z0-9]', '', 'g')
                          AS key
                    FROM core.proveedores
                    WHERE activo = TRUE
                )
                SELECT key,
                       array_agg(proveedor_id ORDER BY proveedor_id) AS ids,
                       array_agg(razon_social ORDER BY proveedor_id) AS nombres,
                       array_agg(COALESCE(rut, '') ORDER BY proveedor_id) AS ruts,
                       array_agg(created_at::text ORDER BY proveedor_id) AS createds
                FROM normalized
                WHERE length(key) > 0
                GROUP BY key
                HAVING COUNT(*) > 1
                ORDER BY array_length(array_agg(proveedor_id), 1) DESC,
                         min(proveedor_id) ASC
                LIMIT :limit
                """
            ),
            {"limit": limit_groups},
        )
    ).mappings().all()

    # Para los miembros tambien queremos vouchers_count y oc_count (opcional).
    all_ids: list[int] = []
    for r in rows:
        all_ids.extend(r["ids"])
    repo = ProveedorRepository(db)
    counts_map = await repo.counts_by_proveedor(all_ids) if all_ids else {}

    groups: list[DuplicateProveedorGroup] = []
    for r in rows:
        members: list[DuplicateProveedorMember] = []
        ids = r["ids"]
        nombres = r["nombres"]
        ruts = r["ruts"]
        createds = r["createds"]
        for i in range(len(ids)):
            pid = int(ids[i])
            counts = counts_map.get(pid, {})
            members.append(
                DuplicateProveedorMember(
                    proveedor_id=pid,
                    razon_social=nombres[i],
                    rut=ruts[i] or None,
                    created_at=createds[i],
                    vouchers_count=counts.get("vouchers", 0),
                    ordenes_compra_count=counts.get("ordenes_compra", 0),
                )
            )
        groups.append(
            DuplicateProveedorGroup(
                normalized_key=str(r["key"]),
                members=members,
            )
        )
    return groups


@router.get("/search", response_model=list[ProveedorSearchHit])
async def search_proveedores(
    user: CurrentUser,
    db: DBSession,
    q: Annotated[str, Query(min_length=2, max_length=80)],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
    with_counts: bool = False,
) -> list[ProveedorSearchHit]:
    """Busqueda fuzzy de proveedores para autocompletado por nombre o RUT.

    A diferencia de /search-by-rut (que solo acepta RUT y devuelve exact-match),
    este endpoint matchea ILIKE en razon_social y RUT parcial. Pensado para
    cuando el user no recuerda el RUT exacto y empieza a tipear el nombre.

    Si `with_counts=true`, agrega vouchers_count y ordenes_compra_count
    (cuesta una query extra — usalo solo en pantallas de catalogo, no en
    cada keystroke).

    IMPORTANTE: debe estar declarada antes de /{proveedor_id: int}.
    """
    repo = ProveedorRepository(db)
    items = await repo.quick_search(q, limit=limit)
    if not items:
        return []
    counts: dict[int, dict[str, int]] = {}
    if with_counts:
        counts = await repo.counts_by_proveedor([p.proveedor_id for p in items])
    return [
        ProveedorSearchHit(
            proveedor_id=p.proveedor_id,
            razon_social=p.razon_social,
            rut=p.rut,
            vouchers_count=counts.get(p.proveedor_id, {}).get("vouchers", 0),
            ordenes_compra_count=counts.get(p.proveedor_id, {}).get(
                "ordenes_compra", 0
            ),
        )
        for p in items
    ]


class ProveedorCacheItem(BaseModel):
    """Item mínimo de catálogo proveedor — para precarga client-side.

    Campos:
      - proveedor_id: key React + identificador interno
      - razon_social: búsqueda primaria + display
      - rut: búsqueda secundaria + autocompletado del campo RUT
      - direccion: opcional, para desambiguar nombres similares.
        Round 47 — útil cuando hay 2 proveedores con nombre parecido y
        el operador necesita ver la dirección para identificar el correcto.

    Resto de campos (giro, banco, telefono, etc.) se piden en el detalle.
    """

    proveedor_id: int
    razon_social: str
    rut: str | None = None
    direccion: str | None = None


@router.get("/cache", response_model=list[ProveedorCacheItem])
async def proveedores_cache(
    user: CurrentUser,
    db: DBSession,
    response: Response,
) -> list[ProveedorCacheItem]:
    """Round 44 — devuelve TODOS los proveedores activos en formato mínimo.

    Pensado para precarga client-side: el frontend hace UN único fetch al
    cargar la app y guarda el resultado en TanStack Query / memoria. A
    partir de ese momento, el typeahead filtra 100% client-side (filter
    sobre el array en memoria) — búsqueda instantánea, 0 round-trips
    adicionales.

    Tamaño aprox: 20KB (~88 bytes/proveedor) para 228 proveedores.

    Round 45 — Cache-Control: el browser cachea la respuesta 5 minutos,
    así si el user recarga la página el JSON viene del disk cache local
    sin pegarle al backend. `private` porque el response depende del
    user (RLS deja pasar siempre pero es buena práctica).

    Solo devuelve activos. Para gestión completa usar `GET /proveedores`
    paginado con `with_counts=true`.
    """
    stmt = (
        select(
            Proveedor.proveedor_id,
            Proveedor.razon_social,
            Proveedor.rut,
            Proveedor.direccion,  # Round 47 — para desambiguar
        )
        .where(Proveedor.activo.is_(True))
        .order_by(Proveedor.razon_social.asc())
    )
    rows = (await db.execute(stmt)).all()
    # Round 45 — HTTP cache hint. max-age=300 = 5min en browser.
    # stale-while-revalidate permite servir cache mientras refresca en bg.
    response.headers["Cache-Control"] = (
        "private, max-age=300, stale-while-revalidate=60"
    )
    return [
        ProveedorCacheItem(
            proveedor_id=r[0],
            razon_social=r[1],
            rut=r[2],
            direccion=r[3],
        )
        for r in rows
    ]


class QuickCreateBody(BaseModel):
    """R152xxx — Payload mínimo para crear proveedor desde un typeahead.

    Solo `razon_social` es realmente obligatoria. El resto se completa
    después editando el proveedor en /admin/proveedores. Para el flujo
    típico de OC: el operador tipea el nombre, no encuentra match en el
    catálogo, clickea "Crear" y aparece el RUT en otro input opcional.
    """

    razon_social: str = Field(..., min_length=2, max_length=255)
    rut: str | None = None

    @field_validator("rut", mode="before")
    @classmethod
    def _check_rut(cls, v: str | None) -> str | None:
        if v is None or str(v).strip() == "":
            return None
        if not validate_rut(v):
            raise ValueError("RUT inválido (dígito verificador no coincide)")
        return format_rut(v)


@router.post("/quick-create", response_model=ProveedorRead, status_code=status.HTTP_201_CREATED)
async def quick_create_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:create"))],
    db: DBSession,
    request: Request,
    body: QuickCreateBody,
) -> ProveedorRead:
    """R152xxx — Crea un proveedor con datos mínimos desde un typeahead.

    Diferencia con POST /proveedores: este endpoint sólo requiere razón
    social (RUT opcional). Si el RUT existe, devuelve el proveedor
    existente en vez de 409 Conflict — para que el flujo del typeahead
    no se rompa si el operador clickea Crear dos veces seguidas.

    Pensado para integrarse al dropdown del componente
    ProveedorTypeaheadCached con la opción "+ Crear nuevo: '{query}'".
    """
    repo = ProveedorRepository(db)
    # Match idempotente por RUT — si ya existe lo devuelve
    if body.rut:
        existing = await repo.get_by_rut(body.rut)
        if existing:
            return ProveedorRead.model_validate(existing)
    # También intentamos match por razón social exacta para idempotencia
    rs_normalized = body.razon_social.strip()
    if rs_normalized:
        from sqlalchemy import func as _func
        match_by_name = (
            await db.execute(
                text(
                    """SELECT proveedor_id FROM core.proveedores
                       WHERE activo = TRUE AND
                             lower(razon_social) = lower(:rs)
                       LIMIT 1"""
                ),
                {"rs": rs_normalized},
            )
        ).first()
        if match_by_name:
            existing = await repo.get(int(match_by_name[0]))
            if existing:
                return ProveedorRead.model_validate(existing)
        # Avoid "imported but unused" warning if _func isn't used elsewhere
        _ = _func

    create_body = ProveedorCreate(
        razon_social=rs_normalized, rut=body.rut
    )
    proveedor = await repo.create(create_body)
    await db.commit()
    created = ProveedorRead.model_validate(proveedor)
    await audit_log(
        db, request, user,
        action="create",
        entity_type="proveedor",
        entity_id=str(created.proveedor_id),
        entity_label=created.razon_social,
        summary=f"Proveedor '{created.razon_social}' creado vía quick-create",
        before=None,
        after=created.model_dump(mode="json"),
    )
    return created


@router.get("/search-by-rut", response_model=ProveedorSearchResult)
async def search_by_rut(
    user: CurrentUser,
    db: DBSession,
    rut: Annotated[str, Query(min_length=2, max_length=20)],
) -> ProveedorSearchResult:
    """Busca un proveedor por RUT en cualquier formato. Pensado para autocompletado.

    Valida con modulo 11. Si el RUT es invalido, devuelve `rut_valid=False`
    para que el FE muestre el error sin pegarle 400 al endpoint en cada keystroke.
    Si es valido, normaliza al formato canonico ('12.345.678-9') y busca match
    exacto en core.proveedores.

    IMPORTANTE: esta ruta DEBE estar declarada antes de GET /{proveedor_id}
    porque sino FastAPI intenta parsear "search-by-rut" como int y devuelve 422.
    """
    if not validate_rut(rut):
        return ProveedorSearchResult(rut_valid=False, exists=False)
    canonical = format_rut(rut)
    repo = ProveedorRepository(db)
    existing = await repo.get_by_rut(canonical)
    return ProveedorSearchResult(
        rut_valid=True,
        rut_canonical=canonical,
        exists=existing is not None,
        proveedor=ProveedorRead.model_validate(existing) if existing else None,
    )


@router.post(
    "/{source_id}/merge-into/{target_id}",
    response_model=MergeProveedorResponse,
)
async def merge_proveedor_into(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:delete"))],
    db: DBSession,
    request: Request,
    source_id: int,
    target_id: int,
) -> MergeProveedorResponse:
    """Fusiona el proveedor `source_id` en `target_id`.

    Mueve TODAS las referencias del source al target:
      - core.vouchers.contraparte_rut: del RUT del source al RUT del target
        (solo si el target tiene RUT; si no, no se mueve esa columna).
      - core.ordenes_compra.proveedor_id: del source al target.

    Y luego deja el source con `activo=false` (soft-delete). Idempotente.

    Restricciones:
      - No se puede fusionar un proveedor consigo mismo.
      - El target debe existir y estar activo.
      - El source debe existir (puede estar activo o no).
      - Permission scope: proveedor:delete (mismo que soft-delete).
    """
    if source_id == target_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_id y target_id no pueden ser iguales",
        )
    repo = ProveedorRepository(db)
    source = await repo.get(source_id)
    target = await repo.get(target_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Proveedor source {source_id} no existe")
    if target is None or not target.activo:
        raise HTTPException(
            status_code=404,
            detail=f"Proveedor target {target_id} no existe o esta inactivo",
        )

    vouchers_moved = 0
    if source.rut and target.rut and source.rut != target.rut:
        result = await db.execute(
            text(
                """
                UPDATE core.vouchers
                SET contraparte_rut = :target_rut,
                    contraparte_nombre = :target_nombre
                WHERE contraparte_rut = :source_rut
                """
            ),
            {
                "target_rut": target.rut,
                "target_nombre": target.razon_social,
                "source_rut": source.rut,
            },
        )
        vouchers_moved = int(result.rowcount or 0)

    result_oc = await db.execute(
        text(
            """
            UPDATE core.ordenes_compra
            SET proveedor_id = :target_id
            WHERE proveedor_id = :source_id
            """
        ),
        {"target_id": target_id, "source_id": source_id},
    )
    ordenes_compra_moved = int(result_oc.rowcount or 0)

    deactivated = False
    if source.activo:
        await repo.soft_delete(source)
        deactivated = True

    await db.commit()

    await audit_log(
        db,
        request,
        user,
        action="merge",
        entity_type="proveedor",
        entity_id=str(source_id),
        entity_label=source.razon_social,
        summary=(
            f"Proveedor '{source.razon_social}' (#{source_id}) fusionado en "
            f"'{target.razon_social}' (#{target_id}). "
            f"Movidos {vouchers_moved} vouchers y {ordenes_compra_moved} OCs."
        ),
        before={
            "source": {"id": source_id, "razon_social": source.razon_social, "rut": source.rut},
            "target": {"id": target_id, "razon_social": target.razon_social, "rut": target.rut},
        },
        after={
            "vouchers_moved": vouchers_moved,
            "ordenes_compra_moved": ordenes_compra_moved,
            "source_deactivated": deactivated,
        },
    )

    return MergeProveedorResponse(
        source_id=source_id,
        target_id=target_id,
        target_razon_social=target.razon_social,
        target_rut=target.rut,
        vouchers_moved=vouchers_moved,
        ordenes_compra_moved=ordenes_compra_moved,
        source_deactivated=deactivated,
    )


@router.get("/{proveedor_id}", response_model=ProveedorRead)
async def get_proveedor(
    user: CurrentUser,
    db: DBSession,
    proveedor_id: int,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proveedor {proveedor_id} no encontrado o inactivo",
        )
    return ProveedorRead.model_validate(proveedor)


@router.patch("/{proveedor_id}", response_model=ProveedorRead)
async def update_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:update"))],
    db: DBSession,
    request: Request,
    proveedor_id: int,
    body: ProveedorUpdate,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proveedor {proveedor_id} no encontrado o inactivo",
        )
    if body.rut:
        existing = await repo.get_by_rut(body.rut)
        if existing and existing.proveedor_id != proveedor_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RUT {body.rut} ya existe (proveedor_id={existing.proveedor_id})",
            )
    before = ProveedorRead.model_validate(proveedor).model_dump(mode="json")
    updated = await repo.update(proveedor, body)
    await db.commit()
    refreshed = ProveedorRead.model_validate(updated)
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="proveedor",
        entity_id=str(proveedor_id),
        entity_label=refreshed.razon_social,
        summary=f"Proveedor '{refreshed.razon_social}' editado",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    return refreshed


@router.delete("/{proveedor_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:delete"))],
    db: DBSession,
    request: Request,
    proveedor_id: int,
) -> Response:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proveedor {proveedor_id} no encontrado o inactivo",
        )
    before = ProveedorRead.model_validate(proveedor).model_dump(mode="json")
    nombre = before.get("razon_social")
    await repo.soft_delete(proveedor)
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="proveedor",
        entity_id=str(proveedor_id),
        entity_label=nombre,
        summary=f"Proveedor '{nombre}' eliminado (soft-delete)",
        before=before,
        after={"activo": False},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
