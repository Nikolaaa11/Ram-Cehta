"""Endpoints CRUD de vouchers (V5).

Cubre:
  GET    /vouchers                 — list filtrable
  GET    /vouchers/{id}            — detalle con líneas
  POST   /vouchers                 — crear DRAFT con líneas en una transacción
  PATCH  /vouchers/{id}            — editar mientras DRAFT
  POST   /vouchers/{id}/submit     — DRAFT → PENDING (valida partida doble + adjuntos COMPRA/VENTA)
  POST   /vouchers/{id}/void       — anula con razón obligatoria
  DELETE /vouchers/{id}            — solo permitido si DRAFT

Lo que NO está acá (Fase 2+):
  POST /vouchers/{id}/approve      — aprobar/firmar (Fase 2)
  POST /vouchers/{id}/reject       — rechazar (Fase 2)
  POST /vouchers/{id}/execute      — marcar EXECUTED post pago bancario
  POST /vouchers/{id}/sync-nubox   — push a Nubox (Fase 3)
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.models.voucher import (
    Voucher,
    VoucherApproval,  # noqa: F401 — modelo registrado para metadata
    VoucherAttachment,  # noqa: F401
    VoucherLine,
)
from app.schemas.voucher import (
    VoucherCreate,
    VoucherListItem,
    VoucherRead,
    VoucherStatus,
    VoucherTipo,
    VoucherUpdate,
)
from app.services.voucher_service import (
    fetch_cuenta_metadata,
    fetch_proyecto_metadata,
    generate_voucher_code,
    is_area_aplica_a_empresa,
    is_cuenta_habilitada_para_empresa,
    is_period_locked_for,
    validate_corfo_eligibility,
)

router = APIRouter()


_VoucherScope = Literal["voucher:read", "voucher:write"]


# =====================================================================
# GET /vouchers — list
# =====================================================================


@router.get("/vouchers", response_model=list[VoucherListItem])
async def list_vouchers(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    tipo: VoucherTipo | None = Query(default=None),
    voucher_status: VoucherStatus | None = Query(default=None, alias="status"),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    contraparte_rut: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[VoucherListItem]:
    """Lista vouchers con filtros. Order by fecha_contable DESC.

    Por ahora sin paginación cursor (limit fijo); cuando crezca se
    agregará paginación tipo `Page[VoucherListItem]`.
    """
    stmt = select(Voucher)
    if empresa_codigo:
        stmt = stmt.where(Voucher.empresa_codigo == empresa_codigo)
    if tipo:
        stmt = stmt.where(Voucher.tipo == tipo)
    if voucher_status:
        stmt = stmt.where(Voucher.status == voucher_status)
    if fecha_desde:
        stmt = stmt.where(Voucher.fecha_contable >= fecha_desde)
    if fecha_hasta:
        stmt = stmt.where(Voucher.fecha_contable <= fecha_hasta)
    if contraparte_rut:
        stmt = stmt.where(Voucher.contraparte_rut == contraparte_rut)
    stmt = stmt.order_by(Voucher.fecha_contable.desc(), Voucher.voucher_id.desc()).limit(
        limit
    )

    result = await db.execute(stmt)
    return [VoucherListItem.model_validate(v) for v in result.scalars().all()]


# =====================================================================
# GET /vouchers/{id} — detalle con líneas
# =====================================================================


@router.get("/vouchers/{voucher_id}", response_model=VoucherRead)
async def get_voucher(
    user: CurrentUser, db: DBSession, voucher_id: int
) -> VoucherRead:
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines))
        .where(Voucher.voucher_id == voucher_id)
    )
    v = (await db.execute(stmt)).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    return VoucherRead.model_validate(v)


# =====================================================================
# POST /vouchers — crear con líneas en una transacción
# =====================================================================


@router.post(
    "/vouchers",
    response_model=VoucherRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: VoucherCreate,
) -> VoucherRead:
    """Crea voucher + líneas en una sola transacción.

    Validaciones (en orden):
      1. Pydantic ya validó: line_number único+correlativo, debit XOR credit,
         partida doble si !DRAFT, COMPRA/VENTA con doc tributario, REVERSO con
         reversal_of.
      2. Empresa existe + activa.
      3. fecha_contable NO está en período cerrado.
      4. Cada línea: cuenta existe + imputable + habilitada para empresa.
      5. Cada línea con proyecto: proyecto existe + pertenece a empresa.
      6. Cada línea con área: área existe + aplica a empresa.
      7. Para líneas CORFO: cuenta es elegible y tipo_gasto está en eligible_types.
      8. Genera código correlativo via core.next_voucher_code().
      9. INSERT voucher + lines en commit atómico.
    """
    # 2. Empresa existe + activa
    empresa_activa = await db.scalar(
        select(1).select_from(  # type: ignore[arg-type]
            Voucher.__table__.metadata.tables["core.empresas"]
        ).where(
            Voucher.__table__.metadata.tables["core.empresas"].c.codigo
            == body.empresa_codigo,
            Voucher.__table__.metadata.tables["core.empresas"].c.activo.is_(True),
        )
    )
    if not empresa_activa:
        # Fallback con SQL raw por si la metadata reflection no registró empresas
        from sqlalchemy import text as _text
        empresa_activa = await db.scalar(
            _text(
                "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
            ),
            {"c": body.empresa_codigo},
        )
    if not empresa_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe o está inactiva",
        )

    # 3. Período cerrado
    if await is_period_locked_for(db, body.empresa_codigo, body.fecha_contable):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Fecha contable {body.fecha_contable} está en período cerrado. "
                f"Para corregir, crear voucher de REVERSO."
            ),
        )

    # 4-7. Validar cada línea
    for line in body.lines:
        cuenta = await fetch_cuenta_metadata(db, line.cuenta_codigo)
        if cuenta is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' no existe",
            )
        if not cuenta["imputable"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"es nivel {cuenta['nivel']}, no imputable. Solo nivel 4 acepta líneas."
                ),
            )
        if not cuenta["activa"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' está inactiva",
            )
        if not await is_cuenta_habilitada_para_empresa(
            db, line.cuenta_codigo, body.empresa_codigo
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"no está habilitada para empresa '{body.empresa_codigo}'"
                ),
            )

        if line.proyecto_codigo:
            proy = await fetch_proyecto_metadata(db, line.proyecto_codigo)
            if proy is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Línea {line.line_number}: proyecto '{line.proyecto_codigo}' "
                        f"no existe"
                    ),
                )
            if proy["empresa_codigo"] != body.empresa_codigo:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Línea {line.line_number}: proyecto '{line.proyecto_codigo}' "
                        f"pertenece a {proy['empresa_codigo']}, no a {body.empresa_codigo}"
                    ),
                )
            # CORFO eligibility
            corfo_err = validate_corfo_eligibility(
                cuenta_corfo_elegible=cuenta["corfo_elegible"],
                cuenta_tipo_gasto_corfo=cuenta["tipo_gasto_corfo"],
                proyecto_es_corfo=(proy["tipo_financiamiento"] == "CORFO"),
                proyecto_eligible_types=list(proy["tipos_gasto_elegibles"] or []),
            )
            if corfo_err:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Línea {line.line_number}: {corfo_err}",
                )

        if line.area_codigo and not await is_area_aplica_a_empresa(
            db, line.area_codigo, body.empresa_codigo
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: área '{line.area_codigo}' "
                    f"no aplica a empresa '{body.empresa_codigo}'"
                ),
            )

    # 8. Generar correlativo
    anio = body.fecha_contable.year
    codigo = await generate_voucher_code(db, body.empresa_codigo, anio, body.tipo)

    # 9. Insertar voucher + lines
    total_debit = sum((line.debit for line in body.lines), start=type(body.lines[0].debit)(0))
    total_credit = sum((line.credit for line in body.lines), start=type(body.lines[0].credit)(0))

    voucher = Voucher(
        codigo=codigo,
        empresa_codigo=body.empresa_codigo,
        tipo=body.tipo,
        status=body.status,
        fecha_documento=body.fecha_documento,
        fecha_contable=body.fecha_contable,
        fecha_ejecucion=body.fecha_ejecucion,
        glosa=body.glosa.strip(),
        total_debit=total_debit,
        total_credit=total_credit,
        moneda=body.moneda,
        exchange_rate=body.exchange_rate,
        contraparte_rut=body.contraparte_rut,
        contraparte_nombre=body.contraparte_nombre,
        contraparte_tipo=body.contraparte_tipo,
        doc_tributario_tipo=body.doc_tributario_tipo,
        doc_tributario_folio=body.doc_tributario_folio,
        doc_tributario_sii_track_id=body.doc_tributario_sii_track_id,
        banco=body.banco,
        banco_cuenta_alias=body.banco_cuenta_alias,
        threshold_aplicado=body.threshold_aplicado,
        reversal_of=body.reversal_of,
        created_by=str(user.sub),
        requested_by=str(user.sub),
    )
    db.add(voucher)
    await db.flush()  # para tener voucher_id

    for line_data in body.lines:
        line = VoucherLine(
            voucher_id=voucher.voucher_id,
            line_number=line_data.line_number,
            cuenta_codigo=line_data.cuenta_codigo,
            proyecto_codigo=line_data.proyecto_codigo,
            area_codigo=line_data.area_codigo,
            debit=line_data.debit,
            credit=line_data.credit,
            descripcion=line_data.descripcion,
            iva_tratamiento=line_data.iva_tratamiento,
            iva_amount=line_data.iva_amount,
            neto_amount=line_data.neto_amount,
            balance_treatment=line_data.balance_treatment,
        )
        db.add(line)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # El trigger de partida doble puede dispararse acá si hay edge case
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"DB rechazó el voucher: {exc.orig}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error guardando voucher: {exc}",
        ) from exc

    # Re-fetch con líneas cargadas
    return await get_voucher(user, db, voucher.voucher_id)


# =====================================================================
# PATCH /vouchers/{id} — solo si DRAFT
# =====================================================================


@router.patch(
    "/vouchers/{voucher_id}",
    response_model=VoucherRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    body: VoucherUpdate,
) -> VoucherRead:
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo se pueden editar vouchers en DRAFT (este está en {v.status}). "
                f"Para corregir un voucher ya enviado, crear voucher de REVERSO."
            ),
        )

    update_data = body.model_dump(exclude_unset=True)
    for k, val in update_data.items():
        setattr(v, k, val)

    await db.commit()
    return await get_voucher(user, db, voucher_id)


# =====================================================================
# POST /vouchers/{id}/submit — DRAFT → PENDING
# =====================================================================


class SubmitResponse(BaseModel):
    voucher_id: int
    codigo: str
    new_status: VoucherStatus = "PENDING"
    message: str


@router.post(
    "/vouchers/{voucher_id}/submit",
    response_model=SubmitResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def submit_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
) -> SubmitResponse:
    """Pasa el voucher de DRAFT a PENDING (esperando aprobación).

    Validaciones:
      - Status actual debe ser DRAFT
      - Líneas cuadran (Σ debit == Σ credit) — el trigger DB lo valida
      - Vouchers tipo COMPRA/VENTA tienen al menos 1 adjunto
    """
    stmt = (
        select(Voucher)
        .options(selectinload(Voucher.lines), selectinload(Voucher.attachments))
        .where(Voucher.voucher_id == voucher_id)
    )
    v = (await db.execute(stmt)).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers en DRAFT pueden ser enviados (este está en {v.status})",
        )
    if not v.lines:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El voucher no tiene líneas",
        )

    if v.tipo in ("COMPRA", "VENTA") and not v.attachments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Voucher de {v.tipo} requiere al menos un adjunto antes de enviarlo "
                f"(factura/boleta correspondiente)"
            ),
        )

    v.status = "PENDING"
    v.requested_by = str(user.sub)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        # El trigger de partida doble puede tirar acá si descuadra
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"DB rechazó el cambio: {exc.orig}",
        ) from exc

    return SubmitResponse(
        voucher_id=voucher_id,
        codigo=v.codigo,
        message=f"Voucher {v.codigo} enviado a aprobación",
    )


# =====================================================================
# POST /vouchers/{id}/void — anular con razón
# =====================================================================


class VoidRequest(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


@router.post(
    "/vouchers/{voucher_id}/void",
    response_model=VoucherRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def void_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    body: VoidRequest,
) -> VoucherRead:
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if v.status in ("VOID", "CLOSED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Voucher ya está en {v.status}",
        )
    v.status = "VOID"
    v.void_reason = body.reason.strip()
    await db.commit()
    return await get_voucher(user, db, voucher_id)


# =====================================================================
# DELETE /vouchers/{id} — solo si DRAFT
# =====================================================================


@router.delete(
    "/vouchers/{voucher_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
) -> Response:
    """Borra fisico, solo permitido si DRAFT.

    Para vouchers enviados (PENDING+), usar POST /vouchers/{id}/void.
    Para vouchers cerrados, crear voucher de REVERSO.
    """
    v = await db.get(Voucher, voucher_id)
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if v.status != "DRAFT":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Solo vouchers en DRAFT pueden borrarse (este está en {v.status}). "
                f"Para anular usar POST /vouchers/{voucher_id}/void."
            ),
        )
    await db.delete(v)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Forward reference resolution para datetime no usado pero importado por
# Voucher/VoucherLine schemas (ruff F401 lo flaggearía sino).
_ = datetime
