"""Catalogos — devuelve todas las tablas lookup para poblar formularios del frontend."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.schemas.catalogo import CatalogosResponse, ConceptoDetallado
from app.schemas.empresa import EmpresaRead, EmpresaUpdate

router = APIRouter()


class EmpresaCatalogo(BaseModel):
    codigo: str
    razon_social: str
    oc_prefix: str | None = None
    rut: str | None = None


_EMPRESA_COLS = (
    "empresa_id, codigo, razon_social, rut, giro, direccion, ciudad, "
    "telefono, representante_legal, email_firmante, oc_prefix, activo"
)


@router.get(
    "/empresas/{codigo}",
    response_model=EmpresaRead,
)
async def get_empresa(
    user: CurrentUser, db: DBSession, codigo: str
) -> EmpresaRead:
    """Detalle completo de una empresa (incluye campos fiscales/contacto)."""
    row = (
        await db.execute(
            text(
                f"SELECT {_EMPRESA_COLS} FROM core.empresas WHERE codigo = :codigo"
            ),
            {"codigo": codigo},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa no encontrada: {codigo}",
        )
    return EmpresaRead.model_validate(dict(row))


@router.patch(
    "/empresas/{codigo}",
    response_model=EmpresaRead,
    dependencies=[Depends(require_scope("empresa:update"))],
)
async def update_empresa(
    user: CurrentUser,
    db: DBSession,
    codigo: str,
    body: EmpresaUpdate,
) -> EmpresaRead:
    """Actualiza datos editables de la empresa. Solo admin (`empresa:update`)."""
    row = (
        await db.execute(
            text("SELECT codigo FROM core.empresas WHERE codigo = :codigo"),
            {"codigo": codigo},
        )
    ).first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa no encontrada: {codigo}",
        )

    fields = body.model_dump(exclude_unset=True)
    if fields:
        sets = [f"{k} = :{k}" for k in fields]
        sets.append("updated_at = now()")
        params = dict(fields)
        params["codigo"] = codigo
        await db.execute(
            text(
                f"UPDATE core.empresas SET {', '.join(sets)} "  # noqa: S608
                "WHERE codigo = :codigo"
            ),
            params,
        )
        await db.commit()

    updated = (
        await db.execute(
            text(
                f"SELECT {_EMPRESA_COLS} FROM core.empresas WHERE codigo = :codigo"
            ),
            {"codigo": codigo},
        )
    ).mappings().one()
    return EmpresaRead.model_validate(dict(updated))


@router.get("/empresas", response_model=list[EmpresaCatalogo])
async def list_empresas(user: CurrentUser, db: DBSession) -> list[EmpresaCatalogo]:
    """Catálogo plano de empresas activas — único source-of-truth para selects (Disciplina 1)."""
    rows = (
        await db.execute(
            text(
                "SELECT codigo, razon_social, oc_prefix, rut "
                "FROM core.empresas WHERE activo = true ORDER BY codigo"
            )
        )
    ).fetchall()
    return [
        EmpresaCatalogo(codigo=r[0], razon_social=r[1], oc_prefix=r[2], rut=r[3])
        for r in rows
    ]


@router.get("", response_model=CatalogosResponse)
async def get_catalogos(user: CurrentUser, db: DBSession) -> CatalogosResponse:
    empresas_rows = (
        await db.execute(
            text(
                "SELECT codigo, razon_social, oc_prefix, rut "
                "FROM core.empresas WHERE activo = true ORDER BY codigo"
            )
        )
    ).fetchall()

    cg_rows = (
        await db.execute(text("SELECT concepto_general FROM core.concepto_general ORDER BY 1"))
    ).fetchall()

    cd_rows = (
        await db.execute(
            text(
                "SELECT concepto_detallado, concepto_general "
                "FROM core.concepto_detallado ORDER BY 1"
            )
        )
    ).fetchall()

    te_rows = (
        await db.execute(text("SELECT tipo_egreso FROM core.tipo_egreso ORDER BY 1"))
    ).fetchall()

    fu_rows = (
        await db.execute(text("SELECT fuente FROM core.fuente ORDER BY 1"))
    ).fetchall()

    pr_rows = (
        await db.execute(text("SELECT proyecto FROM core.proyecto ORDER BY 1"))
    ).fetchall()

    ba_rows = (
        await db.execute(text("SELECT banco FROM core.banco ORDER BY 1"))
    ).fetchall()

    return CatalogosResponse(
        empresas=[
            {"codigo": r[0], "razon_social": r[1], "oc_prefix": r[2], "rut": r[3]}
            for r in empresas_rows
        ],
        concepto_general=[r[0] for r in cg_rows],
        concepto_detallado=[
            ConceptoDetallado(concepto_detallado=r[0], concepto_general=r[1])
            for r in cd_rows
        ],
        tipo_egreso=[r[0] for r in te_rows],
        fuente=[r[0] for r in fu_rows],
        proyecto=[r[0] for r in pr_rows],
        banco=[r[0] for r in ba_rows],
    )
