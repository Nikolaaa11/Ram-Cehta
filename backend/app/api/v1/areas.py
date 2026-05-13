"""Endpoints CRUD de Áreas (centros de costo) — V5.

Las 10 áreas estándar (ADM/COM/OPE/ING/IDI/LEG/RRH/TIC/EJE/FIN) vienen
en seed de la migración 0034 y se sobrescriben con la hoja `Areas` del
Excel. La matriz `area_empresa` define qué área aplica a qué empresa.

Endpoints:
  GET    /areas                            (lista)
  GET    /areas/{codigo}                   (detalle)
  POST   /areas                            (crear nueva — uso poco frecuente)
  PATCH  /areas/{codigo}                   (renombrar / desactivar)
  GET    /areas/empresas-matrix            (matriz aplica completa para UI)
  GET    /areas/{codigo}/empresas          (qué empresas usan esta área)
  PATCH  /areas/{codigo}/empresas/{empresa} (toggle aplica)
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import assert_empresa_access

router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class AreaBase(BaseModel):
    codigo: str = Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    nombre: str = Field(min_length=2, max_length=100)
    descripcion: str | None = Field(default=None, max_length=300)
    activa: bool = True


class AreaCreate(AreaBase):
    pass


class AreaUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=100)
    descripcion: str | None = Field(default=None, max_length=300)
    activa: bool | None = None


class AreaRead(AreaBase):
    model_config = ConfigDict(from_attributes=True)


class AreaEmpresaUpdate(BaseModel):
    aplica: bool


class AreaEmpresaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    area_codigo: str
    empresa_codigo: str
    aplica: bool


class AreaEmpresaMatrix(BaseModel):
    """Matriz completa para UI: por área, lista de empresas que aplican."""

    matrix: dict[str, list[str]]


# =====================================================================
# CRUD áreas
# =====================================================================


_CATALOG_CACHE_HEADER = "private, max-age=300, stale-while-revalidate=60"


@router.get("/areas", response_model=list[AreaRead])
async def list_areas(
    user: CurrentUser,
    db: DBSession,
    response: Response,
    only_active: bool = Query(default=True),
    empresa_codigo: str | None = Query(
        default=None,
        description="Si se pasa, solo devuelve áreas que aplican a esa empresa",
    ),
) -> list[AreaRead]:
    """V5++ ola CG perf: cache 5 min stale-while-revalidate 60s.
    Las áreas son catálogo cuasi-estático (cambian ~1/año)."""
    response.headers["Cache-Control"] = _CATALOG_CACHE_HEADER
    # V5++ ola CG security: scope check si filtro empresa_codigo viene.
    if empresa_codigo:
        await assert_empresa_access(user, db, empresa_codigo)

    where_parts: list[str] = []
    params: dict[str, Any] = {}

    if only_active:
        where_parts.append("a.activa = TRUE")

    join_clause = ""
    if empresa_codigo:
        join_clause = (
            " INNER JOIN core.area_empresa ae "
            "   ON ae.area_codigo = a.codigo "
            "   AND ae.empresa_codigo = :empresa "
            "   AND ae.aplica = TRUE"
        )
        params["empresa"] = empresa_codigo

    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                "SELECT a.codigo, a.nombre, a.descripcion, a.activa "
                "FROM core.areas a"
                f"{join_clause}"
                f"{where_sql}"
                " ORDER BY a.codigo"
            ),
            params,
        )
    ).mappings().all()

    return [AreaRead.model_validate(dict(r)) for r in rows]


@router.get("/areas/empresas-matrix", response_model=AreaEmpresaMatrix)
async def areas_empresas_matrix(
    user: CurrentUser, db: DBSession
) -> AreaEmpresaMatrix:
    """Devuelve toda la matriz {area_codigo: [empresa_codigo, ...]}.

    Útil para la UI que muestra "qué empresas usan cada área" en una sola
    request (en vez de N+1 calls).
    """
    rows = (
        await db.execute(
            text(
                "SELECT area_codigo, empresa_codigo FROM core.area_empresa "
                "WHERE aplica = TRUE ORDER BY area_codigo, empresa_codigo"
            )
        )
    ).mappings().all()

    matrix: dict[str, list[str]] = {}
    for r in rows:
        matrix.setdefault(r["area_codigo"], []).append(r["empresa_codigo"])
    return AreaEmpresaMatrix(matrix=matrix)


@router.get("/areas/{codigo}", response_model=AreaRead)
async def get_area(
    user: CurrentUser, db: DBSession, codigo: str
) -> AreaRead:
    row = (
        await db.execute(
            text(
                "SELECT codigo, nombre, descripcion, activa FROM core.areas "
                "WHERE codigo = :c"
            ),
            {"c": codigo.upper()},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Área {codigo} no encontrada",
        )
    return AreaRead.model_validate(dict(row))


@router.post(
    "/areas",
    response_model=AreaRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_area(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: AreaCreate,
) -> AreaRead:
    try:
        await db.execute(
            text(
                "INSERT INTO core.areas (codigo, nombre, descripcion, activa) "
                "VALUES (:codigo, :nombre, :descripcion, :activa)"
            ),
            body.model_dump(),
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No se pudo crear el área (¿código duplicado?): {exc}",
        ) from exc
    return await get_area(user, db, body.codigo)


@router.patch(
    "/areas/{codigo}",
    response_model=AreaRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_area(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
    body: AreaUpdate,
) -> AreaRead:
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return await get_area(user, db, codigo)
    set_clauses = ", ".join(f"{k} = :{k}" for k in update_data)
    update_data["codigo"] = codigo.upper()
    res = await db.execute(
        text(
            f"UPDATE core.areas SET {set_clauses}, updated_at = now() "
            "WHERE codigo = :codigo"
        ),
        update_data,
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Área {codigo} no encontrada",
        )
    await db.commit()
    return await get_area(user, db, codigo)


# =====================================================================
# Toggle aplica empresa
# =====================================================================


@router.get(
    "/areas/{codigo}/empresas", response_model=list[AreaEmpresaRead]
)
async def list_area_empresas(
    user: CurrentUser, db: DBSession, codigo: str
) -> list[AreaEmpresaRead]:
    rows = (
        await db.execute(
            text(
                "SELECT area_codigo, empresa_codigo, aplica "
                "FROM core.area_empresa WHERE area_codigo = :c "
                "ORDER BY empresa_codigo"
            ),
            {"c": codigo.upper()},
        )
    ).mappings().all()
    return [AreaEmpresaRead.model_validate(dict(r)) for r in rows]


@router.patch(
    "/areas/{codigo}/empresas/{empresa_codigo}",
    response_model=AreaEmpresaRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def toggle_area_empresa(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
    empresa_codigo: str,
    body: AreaEmpresaUpdate,
) -> AreaEmpresaRead:
    """Habilita o deshabilita un área para una empresa específica.

    UPSERT: si no había row, crea con `aplica` indicado. Si había, lo
    actualiza.

    V5++ ola CG security: scope check sobre `empresa_codigo`.
    """
    await assert_empresa_access(user, db, empresa_codigo)
    await db.execute(
        text(
            """
            INSERT INTO core.area_empresa (area_codigo, empresa_codigo, aplica)
            VALUES (:a, :e, :ap)
            ON CONFLICT (area_codigo, empresa_codigo) DO UPDATE
                SET aplica = EXCLUDED.aplica
            """
        ),
        {"a": codigo.upper(), "e": empresa_codigo, "ap": body.aplica},
    )
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT area_codigo, empresa_codigo, aplica "
                "FROM core.area_empresa "
                "WHERE area_codigo = :a AND empresa_codigo = :e"
            ),
            {"a": codigo.upper(), "e": empresa_codigo},
        )
    ).mappings().one()
    return AreaEmpresaRead.model_validate(dict(row))
