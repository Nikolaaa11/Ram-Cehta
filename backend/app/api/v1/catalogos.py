"""Catalogos — devuelve todas las tablas lookup para poblar formularios del frontend."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.schemas.catalogo import CatalogosResponse, ConceptoDetallado

router = APIRouter()


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
