"""MEGAPROMPT PREVOUCHER — Cola de pre-vouchers + edición de líneas de DRAFT.

Concepto: un PRE-VOUCHER es un voucher en estado DRAFT cargado por un usuario
operativo (típicamente desde /gastos con foto y datos clave, source
'prevoucher'). No hay tabla nueva: el borrador de voucher YA ES el pre-voucher
(una sola fuente de verdad, cero migración de datos).

Endpoints (router SIN prefix — paths completos, mismo patrón que oc_cuotas):
- GET /prevouchers/cola          cola para especialistas (creador, adjuntos,
                                 días de espera, OC de origen)
- PUT /vouchers/{id}/lines       reemplaza las líneas de un DRAFT — el eslabón
                                 que faltaba: el especialista "completa" la
                                 imputación sin borrar/recrear el voucher.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.voucher import VoucherLineCreate
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import (
    assert_empresa_access,
    get_allowed_empresa_codes,
)
from app.services.voucher_service import (
    fetch_cuenta_metadata,
    fetch_proyecto_metadata,
    is_area_aplica_a_empresa,
    is_cuenta_habilitada_para_empresa,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Cola de pre-vouchers
# ---------------------------------------------------------------------------


class PrevoucherItem(BaseModel):
    voucher_id: int
    codigo: str
    empresa_codigo: str
    tipo: str
    fecha_documento: date
    glosa: str
    total_debit: Decimal
    moneda: str
    contraparte_nombre: str | None
    source: str | None
    creador_email: str | None
    dias_esperando: int
    adjuntos: int
    lineas: int
    cuadrado: bool
    oc_id: int | None
    oc_numero: str | None


class PrevoucherCola(BaseModel):
    items: list[PrevoucherItem]
    total: int


@router.get("/prevouchers/cola", response_model=PrevoucherCola)
async def cola_prevouchers(
    user: Annotated[AuthenticatedUser, Depends(require_scope("voucher:read"))],
    db: DBSession,
    empresa_codigo: Annotated[str | None, Query(max_length=20)] = None,
    solo_con_adjunto: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> PrevoucherCola:
    """Cola de pre-vouchers (vouchers DRAFT) pendientes de procesar.

    Ordenada por antigüedad (el que más lleva esperando, primero). El
    especialista "toma" un pre-voucher abriéndolo en /vouchers/{id},
    completa la imputación con PUT /vouchers/{id}/lines y lo envía a
    firmas con POST /vouchers/{id}/submit.
    """
    allowed = await get_allowed_empresa_codes(user, db)
    if allowed is not None and not allowed:
        return PrevoucherCola(items=[], total=0)

    filters = ["v.status = 'DRAFT'"]
    params: dict = {"limit": limit}
    if allowed is not None:
        filters.append("v.empresa_codigo = ANY(:allowed)")
        params["allowed"] = list(allowed)
    if empresa_codigo:
        filters.append("v.empresa_codigo = :emp")
        params["emp"] = empresa_codigo

    where = " AND ".join(filters)
    having = "HAVING count(DISTINCT a.attachment_id) > 0" if solo_con_adjunto else ""

    rows = (
        await db.execute(
            text(
                f"""SELECT v.voucher_id, v.codigo, v.empresa_codigo, v.tipo,
                           v.fecha_documento, v.glosa, v.total_debit,
                           v.moneda, v.contraparte_nombre, v.source,
                           u.email AS creador_email,
                           (now()::date - v.created_at::date) AS dias_esperando,
                           count(DISTINCT a.attachment_id) AS adjuntos,
                           count(DISTINCT l.line_id) AS lineas,
                           (v.total_debit = v.total_credit
                            AND v.total_debit > 0) AS cuadrado,
                           v.oc_id,
                           oc.numero_oc AS oc_numero
                    FROM core.vouchers v
                    LEFT JOIN auth.users u ON u.id = v.created_by
                    LEFT JOIN core.voucher_attachments a
                           ON a.voucher_id = v.voucher_id
                    LEFT JOIN core.voucher_lines l
                           ON l.voucher_id = v.voucher_id
                    LEFT JOIN core.ordenes_compra oc ON oc.oc_id = v.oc_id
                    WHERE {where}
                    GROUP BY v.voucher_id, v.codigo, v.empresa_codigo, v.tipo,
                             v.fecha_documento, v.glosa, v.total_debit,
                             v.total_credit, v.moneda, v.contraparte_nombre,
                             v.source, u.email, v.created_at, v.oc_id,
                             oc.numero_oc
                    {having}
                    ORDER BY v.created_at ASC
                    LIMIT :limit"""
            ),
            params,
        )
    ).mappings().all()

    items = [PrevoucherItem(**dict(r)) for r in rows]
    return PrevoucherCola(items=items, total=len(items))


# ---------------------------------------------------------------------------
# Edición de líneas de un DRAFT (replace-all)
# ---------------------------------------------------------------------------


class LinesReplaceRequest(BaseModel):
    lines: list[VoucherLineCreate] = Field(min_length=1, max_length=200)


class LinesReplaceResponse(BaseModel):
    voucher_id: int
    codigo: str
    lineas: int
    total_debit: Decimal
    total_credit: Decimal
    cuadrado: bool


@router.put("/vouchers/{voucher_id:int}/lines", response_model=LinesReplaceResponse)
async def replace_voucher_lines(
    voucher_id: int,
    body: LinesReplaceRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
) -> LinesReplaceResponse:
    """Reemplaza TODAS las líneas de un voucher DRAFT (replace-all atómico).

    Es el paso "completar la imputación" del flujo de pre-vouchers: el
    especialista toma el borrador cargado por un operativo y fija las
    cuentas/áreas/proyectos correctos sin borrar y recrear el voucher
    (preservando código, adjuntos y trazabilidad del creador).

    Mismas validaciones por línea que POST /vouchers: cuenta existe +
    imputable (nivel 4) + activa + habilitada para la empresa; proyecto de
    la misma empresa; área aplica a la empresa; line_number correlativo
    desde 1 (garantizado por el schema). Solo DRAFT (400 si no).
    """
    row = (
        await db.execute(
            text(
                """SELECT voucher_id, codigo, empresa_codigo, status
                   FROM core.vouchers WHERE voucher_id = :id FOR UPDATE"""
            ),
            {"id": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voucher {voucher_id} no encontrado",
        )
    await assert_empresa_access(user, db, row["empresa_codigo"])
    if row["status"] != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo se pueden editar líneas de un borrador "
                f"(status actual: {row['status']})."
            ),
        )

    empresa = row["empresa_codigo"]
    # line_number correlativo desde 1 — VoucherCreate lo valida en su
    # model_validator, pero este body llega suelto: validar acá.
    numeros = sorted(line.line_number for line in body.lines)
    if numeros != list(range(1, len(body.lines) + 1)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="line_number debe ser correlativo desde 1 sin saltos.",
        )
    for line in body.lines:
        if (line.debit > 0) == (line.credit > 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: debe tener débito XOR crédito "
                    f"(uno de los dos > 0, no ambos)."
                ),
            )
        cuenta = await fetch_cuenta_metadata(db, line.cuenta_codigo)
        if cuenta is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' no existe",
            )
        if not cuenta["imputable"] or not cuenta["activa"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"no es imputable o está inactiva."
                ),
            )
        if not await is_cuenta_habilitada_para_empresa(
            db, line.cuenta_codigo, empresa
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"no está habilitada para empresa '{empresa}'"
                ),
            )
        if line.proyecto_codigo:
            proy = await fetch_proyecto_metadata(db, line.proyecto_codigo)
            if proy is None or proy["empresa_codigo"] != empresa:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Línea {line.line_number}: proyecto "
                        f"'{line.proyecto_codigo}' no existe o no es de {empresa}"
                    ),
                )
        if line.area_codigo and not await is_area_aplica_a_empresa(
            db, line.area_codigo, empresa
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: área '{line.area_codigo}' "
                    f"no aplica a empresa '{empresa}'"
                ),
            )

    # Replace-all atómico + recálculo de totales.
    await db.execute(
        text("DELETE FROM core.voucher_lines WHERE voucher_id = :id"),
        {"id": voucher_id},
    )
    for line in body.lines:
        await db.execute(
            text(
                """INSERT INTO core.voucher_lines (
                       voucher_id, line_number, cuenta_codigo, proyecto_codigo,
                       area_codigo, debit, credit, descripcion,
                       iva_tratamiento, iva_amount, neto_amount,
                       balance_treatment
                   ) VALUES (
                       :vid, :n, :cuenta, :proyecto, :area, :debit, :credit,
                       :descripcion, :iva_trat, :iva_amount, :neto_amount,
                       :bal
                   )"""
            ),
            {
                "vid": voucher_id,
                "n": line.line_number,
                "cuenta": line.cuenta_codigo,
                "proyecto": line.proyecto_codigo,
                "area": line.area_codigo,
                "debit": line.debit,
                "credit": line.credit,
                "descripcion": line.descripcion,
                "iva_trat": line.iva_tratamiento,
                "iva_amount": line.iva_amount,
                "neto_amount": line.neto_amount,
                "bal": line.balance_treatment,
            },
        )
    total_debit = sum((line.debit for line in body.lines), start=Decimal("0"))
    total_credit = sum((line.credit for line in body.lines), start=Decimal("0"))
    await db.execute(
        text(
            """UPDATE core.vouchers
               SET total_debit = :td, total_credit = :tc
               WHERE voucher_id = :id"""
        ),
        {"td": total_debit, "tc": total_credit, "id": voucher_id},
    )
    await audit_log(
        db,
        None,
        user,
        action="voucher.lines_replaced",
        entity_type="voucher",
        entity_id=str(voucher_id),
        entity_label=row["codigo"],
        summary=(
            f"Imputación de {row['codigo']} completada: {len(body.lines)} "
            f"línea{'s' if len(body.lines) != 1 else ''} "
            f"(D {total_debit} / H {total_credit})"
        ),
        after={
            "lineas": [
                {
                    "n": line.line_number,
                    "cuenta": line.cuenta_codigo,
                    "area": line.area_codigo,
                    "debit": str(line.debit),
                    "credit": str(line.credit),
                }
                for line in body.lines
            ]
        },
    )
    await db.commit()
    return LinesReplaceResponse(
        voucher_id=voucher_id,
        codigo=row["codigo"],
        lineas=len(body.lines),
        total_debit=total_debit,
        total_credit=total_credit,
        cuadrado=(total_debit == total_credit and total_debit > 0),
    )
