"""CRUD Proveedores — Session 2.3."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.schemas.common import Page
from app.schemas.proveedor import ProveedorCreate, ProveedorRead, ProveedorUpdate
from app.services.audit_service import audit_log

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


@router.get("", response_model=Page[ProveedorRead])
async def list_proveedores(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    search: str | None = None,
    with_counts: bool = False,
) -> Page[ProveedorRead]:
    """Lista proveedores activos paginados. Si `with_counts=true`, agrega
    `vouchers_count` y `ordenes_compra_count` a cada item (1 query extra
    agregada). Util para la pantalla /admin/proveedores donde queremos
    ver el uso real de cada proveedor."""
    repo = ProveedorRepository(db)
    items, total = await repo.list(page=page, size=size, search=search)
    counts_map: dict[int, dict[str, int]] = {}
    if with_counts and items:
        counts_map = await repo.counts_by_proveedor(
            [p.proveedor_id for p in items]
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


@router.get("/{proveedor_id}", response_model=ProveedorRead)
async def get_proveedor(
    user: CurrentUser,
    db: DBSession,
    proveedor_id: int,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
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
