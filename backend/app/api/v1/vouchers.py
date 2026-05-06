"""Endpoints CRUD de vouchers (V5).

Cubre:
  GET    /vouchers                 — list filtrable
  GET    /vouchers/{id}            — detalle con líneas
  POST   /vouchers                 — crear DRAFT con líneas en una transacción
  PATCH  /vouchers/{id}            — editar mientras DRAFT
  POST   /vouchers/{id}/submit     — DRAFT → PENDING (valida partida doble + adjuntos COMPRA/VENTA)
  POST   /vouchers/{id}/void       — anula con razón obligatoria
  DELETE /vouchers/{id}            — solo permitido si DRAFT

  GET    /vouchers/{id}/attachments        — lista adjuntos
  POST   /vouchers/{id}/attachments        — sube adjunto a Dropbox + persiste
  GET    /vouchers/{id}/attachments/{att}/url — URL temporal Dropbox (4h)
  DELETE /vouchers/{id}/attachments/{att}   — borra adjunto (DROPBOX + DB), solo DRAFT/PENDING

  GET    /vouchers/{id}/approvals          — lista firmas + estado del flujo
  POST   /vouchers/{id}/approve            — firma propia (rol activo en empresa)
  POST   /vouchers/{id}/reject             — rechaza con razón obligatoria

Lo que NO está acá (Fase 3+):
  POST /vouchers/{id}/execute      — marcar EXECUTED post pago bancario
  POST /vouchers/{id}/sync-nubox   — push a Nubox (Fase 3)
"""
from __future__ import annotations

import asyncio
import hashlib
from datetime import date, datetime
from decimal import Decimal  # noqa: F401 — usado en endpoint from-factura-pdf
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from fastapi import Request

from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.services.approval_service import (
    compute_threshold_aplicado,
    find_matching_rule,
    get_voucher_approvals,
    get_voucher_balance_treatment_dominante,
    load_active_rules,
    load_user_roles_for_empresa,
    record_approval_signature,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

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


@router.get("/vouchers/search", response_model=list[VoucherListItem])
async def search_vouchers(
    user: CurrentUser,
    db: DBSession,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[VoucherListItem]:
    """Búsqueda full-text en vouchers usando Postgres tsvector + GIN.

    V5++ ola V: 10-100x más rápido que ILIKE para datasets grandes.
    Soporta stemming español ('proveedor' matchea 'provee').

    Ranking: codigo (peso A) > contraparte_rut (A) > contraparte_nombre (B)
             > doc_tributario_folio (B) > glosa (C). Ordenado por ts_rank desc.

    Si la migration 0046 no se aplicó todavía, fallback a ILIKE estándar.
    """
    # Construir tsquery seguro — websearch_to_tsquery acepta sintaxis natural
    # del usuario sin riesgo de inyección (Postgres parsea + sanitiza).
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT
                        voucher_id, codigo, empresa_codigo, tipo, status,
                        fecha_contable, glosa, total_debit, total_credit,
                        moneda, contraparte_nombre, threshold_aplicado,
                        created_at,
                        ts_rank(search_tsv, websearch_to_tsquery('spanish', :q)) AS rank
                    FROM core.vouchers
                    WHERE search_tsv @@ websearch_to_tsquery('spanish', :q)
                    ORDER BY rank DESC, fecha_contable DESC
                    LIMIT :lim
                    """
                ),
                {"q": q, "lim": limit},
            )
        ).mappings().all()
    except Exception:
        # Fallback ILIKE si search_tsv no existe (migration 0046 pending)
        await db.rollback()
        pattern = f"%{q}%"
        rows = (
            await db.execute(
                text(
                    """
                    SELECT
                        voucher_id, codigo, empresa_codigo, tipo, status,
                        fecha_contable, glosa, total_debit, total_credit,
                        moneda, contraparte_nombre, threshold_aplicado,
                        created_at
                    FROM core.vouchers
                    WHERE codigo ILIKE :p
                       OR glosa ILIKE :p
                       OR contraparte_nombre ILIKE :p
                       OR contraparte_rut ILIKE :p
                       OR doc_tributario_folio ILIKE :p
                    ORDER BY fecha_contable DESC
                    LIMIT :lim
                    """
                ),
                {"p": pattern, "lim": limit},
            )
        ).mappings().all()

    return [VoucherListItem.model_validate(dict(r)) for r in rows]


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


@router.get("/vouchers/{voucher_id}.html")
async def get_voucher_html(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
):
    """V5++ HTML imprimible del voucher individual.

    Server-side render notarial con líneas + firmas SHA-256 (si APPROVED+).
    El user abre en pestaña nueva → Ctrl+P → guarda como PDF formal.
    """
    from fastapi.responses import HTMLResponse

    from app.services.report_renderer_service import render_voucher_html

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

    # Cargar nombres de cuentas (JOIN con plan_cuentas)
    line_dicts = []
    for ln in sorted(v.lines, key=lambda x: x.line_number):
        cuenta_nombre = await db.scalar(
            text("SELECT nombre FROM core.plan_cuentas WHERE codigo = :c"),
            {"c": ln.cuenta_codigo},
        )
        line_dicts.append({
            "line_number": ln.line_number,
            "cuenta_codigo": ln.cuenta_codigo,
            "cuenta_nombre": cuenta_nombre or "",
            "proyecto_codigo": ln.proyecto_codigo,
            "area_codigo": ln.area_codigo,
            "descripcion": ln.descripcion or "",
            "debit": ln.debit,
            "credit": ln.credit,
        })

    # Cargar approvals si existen
    approvals_rows = (
        await db.execute(
            text(
                """
                SELECT order_num, role, decision, approver_user_id,
                       signed_at::text AS signed_at, signature_hash
                FROM core.voucher_approvals
                WHERE voucher_id = :id
                ORDER BY order_num
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()
    approvals = [dict(a) for a in approvals_rows]

    voucher_dict = {
        "voucher_id": v.voucher_id,
        "codigo": v.codigo,
        "empresa_codigo": v.empresa_codigo,
        "tipo": v.tipo,
        "status": v.status,
        "fecha_contable": v.fecha_contable.isoformat() if v.fecha_contable else "",
        "glosa": v.glosa or "",
        "contraparte_nombre": v.contraparte_nombre,
        "contraparte_rut": v.contraparte_rut,
        "doc_tributario_tipo": v.doc_tributario_tipo,
        "doc_tributario_folio": v.doc_tributario_folio,
        "banco": v.banco,
        "banco_cuenta_alias": v.banco_cuenta_alias,
    }

    html = render_voucher_html(
        voucher=voucher_dict,
        lines=line_dicts,
        approvals=approvals,
    )
    return HTMLResponse(content=html)


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


# =====================================================================
# ATTACHMENTS — adjuntos en Dropbox + metadata en DB
# =====================================================================


# Tipos de adjunto permitidos (espejo del CHECK de la migración 0035)
AttachmentTipo = Literal[
    "FACTURA", "BOLETA", "CONTRATO", "COTIZACION",
    "TRANSFERENCIA", "LIQUIDACION_SUELDO", "ACTA",
    "RESPALDO_TECNICO", "OTRO",
]


# Path Dropbox raíz para adjuntos de vouchers
_VOUCHER_ATTACHMENTS_ROOT = "/Cehta Capital/02-Fondo (FIP CEHTA)/Vouchers"

# Tamaño máximo por adjunto (50 MB) — facturas escaneadas a alta resolución
# pueden pesar 5-15 MB; 50 MB nos da margen sin permitir abuso.
_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

# Mime types aceptados — PDFs y scans
_ALLOWED_MIME_PREFIXES = (
    "application/pdf",
    "image/jpeg", "image/png", "image/webp",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/msword",
)


class VoucherAttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    attachment_id: int
    voucher_id: int
    tipo: AttachmentTipo
    file_name: str
    dropbox_path: str
    file_hash: str | None
    mime_type: str | None
    size_bytes: int | None
    uploaded_by: str | None
    uploaded_at: datetime


class VoucherAttachmentLink(BaseModel):
    """URL temporal de Dropbox para descargar el adjunto (vence en 4h)."""

    attachment_id: int
    file_name: str
    url: str
    expires_in_seconds: int = 4 * 60 * 60


def _voucher_dropbox_path(
    empresa_codigo: str, anio: int, voucher_codigo: str, file_name: str
) -> str:
    """Path Dropbox por convención: /Vouchers/{empresa}/{año}/{codigo}/{file}."""
    safe_file = file_name.replace("/", "_")
    return (
        f"{_VOUCHER_ATTACHMENTS_ROOT}/{empresa_codigo}/{anio}/"
        f"{voucher_codigo}/{safe_file}"
    )


async def _get_dropbox_service(db: DBSession) -> DropboxService:
    """Devuelve el cliente Dropbox autenticado o lanza 503 si no está conectado."""
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Dropbox no está conectado. Conectá la cuenta en /admin/integraciones "
                "antes de subir adjuntos."
            ),
        )
    try:
        return DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@router.get(
    "/vouchers/{voucher_id}/attachments",
    response_model=list[VoucherAttachmentRead],
)
async def list_voucher_attachments(
    user: CurrentUser, db: DBSession, voucher_id: int
) -> list[VoucherAttachmentRead]:
    """Lista adjuntos del voucher (sin URLs temporales — esas se piden por adjunto)."""
    if not await db.scalar(
        text("SELECT 1 FROM core.vouchers WHERE voucher_id = :id"),
        {"id": voucher_id},
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )

    rows = (
        await db.execute(
            text(
                """
                SELECT attachment_id, voucher_id, tipo, file_name, dropbox_path,
                       file_hash, mime_type, size_bytes, uploaded_by, uploaded_at
                FROM core.voucher_attachments
                WHERE voucher_id = :id
                ORDER BY uploaded_at DESC
                """
            ),
            {"id": voucher_id},
        )
    ).mappings().all()

    return [VoucherAttachmentRead.model_validate(dict(r)) for r in rows]


@router.post(
    "/vouchers/{voucher_id}/attachments",
    response_model=VoucherAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def upload_voucher_attachment(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    tipo: Annotated[AttachmentTipo, Form()],
    file: UploadFile = File(..., description="Factura, boleta, contrato, etc."),
) -> VoucherAttachmentRead:
    """Sube un adjunto a Dropbox + persiste metadata en DB.

    Path Dropbox: /Cehta Capital/02-Fondo (FIP CEHTA)/Vouchers/{empresa}/{año}/{codigo}/{file}
    """
    # 1. Validar voucher existe y permite adjuntos
    row = (
        await db.execute(
            text(
                "SELECT codigo, empresa_codigo, fecha_contable, status "
                "FROM core.vouchers WHERE voucher_id = :id"
            ),
            {"id": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if row["status"] in ("VOID", "CLOSED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pueden adjuntar archivos a un voucher en {row['status']}",
        )

    # 2. Validar archivo
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo sin nombre"
        )

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo vacío"
        )
    if len(contents) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Archivo excede {_MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB. "
                "Comprimí o subí el original a Dropbox manualmente y referencialo."
            ),
        )

    mime = file.content_type or "application/octet-stream"
    if not any(mime.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Tipo de archivo no permitido: {mime}. Solo PDF, imágenes "
                "(JPG/PNG/WebP), Excel y Word."
            ),
        )

    # 3. Hash SHA-256 (para detectar duplicados / verificar integridad)
    file_hash = hashlib.sha256(contents).hexdigest()

    # 4. Subir a Dropbox (sync API en threadpool para no bloquear el event loop)
    dbx = await _get_dropbox_service(db)
    anio = row["fecha_contable"].year
    target_path = _voucher_dropbox_path(
        row["empresa_codigo"], anio, row["codigo"], file.filename
    )

    try:
        # Crear estructura de carpetas + upload
        await asyncio.to_thread(
            dbx.ensure_folder,
            f"{_VOUCHER_ATTACHMENTS_ROOT}/{row['empresa_codigo']}/{anio}/{row['codigo']}",
        )
        await asyncio.to_thread(dbx.upload_file, target_path, contents, overwrite=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo subir a Dropbox: {exc}",
        ) from exc

    # 5. Persistir metadata
    result = await db.execute(
        text(
            """
            INSERT INTO core.voucher_attachments (
                voucher_id, tipo, file_name, dropbox_path, file_hash,
                mime_type, size_bytes, uploaded_by
            )
            VALUES (
                :v, :t, :n, :p, :h, :m, :s, CAST(:by AS UUID)
            )
            RETURNING attachment_id, voucher_id, tipo, file_name, dropbox_path,
                      file_hash, mime_type, size_bytes, uploaded_by, uploaded_at
            """
        ),
        {
            "v": voucher_id,
            "t": tipo,
            "n": file.filename,
            "p": target_path,
            "h": file_hash,
            "m": mime,
            "s": len(contents),
            "by": str(user.sub),
        },
    )
    await db.commit()
    new_row = result.mappings().one()
    return VoucherAttachmentRead.model_validate(dict(new_row))


@router.get(
    "/vouchers/{voucher_id}/attachments/{attachment_id}/url",
    response_model=VoucherAttachmentLink,
)
async def get_voucher_attachment_url(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    attachment_id: int,
) -> VoucherAttachmentLink:
    """Genera URL temporal de Dropbox (vence en 4h) para descargar el archivo."""
    row = (
        await db.execute(
            text(
                "SELECT a.attachment_id, a.dropbox_path, a.file_name "
                "FROM core.voucher_attachments a "
                "WHERE a.attachment_id = :a AND a.voucher_id = :v"
            ),
            {"a": attachment_id, "v": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Adjunto no encontrado"
        )

    dbx = await _get_dropbox_service(db)
    try:
        url = await asyncio.to_thread(dbx.get_temporary_link, row["dropbox_path"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo generar URL temporal: {exc}",
        ) from exc

    return VoucherAttachmentLink(
        attachment_id=row["attachment_id"],
        file_name=row["file_name"],
        url=url,
    )


@router.delete(
    "/vouchers/{voucher_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_voucher_attachment(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    attachment_id: int,
) -> Response:
    """Borra adjunto de Dropbox + DB. Solo permitido en DRAFT/PENDING.

    Para vouchers aprobados o ejecutados, los adjuntos quedan inmutables
    (audit). Si necesitás reemplazar, anulá y reversá.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT a.dropbox_path, v.status
                FROM core.voucher_attachments a
                INNER JOIN core.vouchers v ON v.voucher_id = a.voucher_id
                WHERE a.attachment_id = :a AND a.voucher_id = :v
                """
            ),
            {"a": attachment_id, "v": voucher_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Adjunto no encontrado"
        )
    if row["status"] not in ("DRAFT", "PENDING"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No se pueden borrar adjuntos de un voucher en {row['status']}. "
                "Para corregir, anular el voucher o crear voucher de REVERSO."
            ),
        )

    # Borrar de Dropbox (best-effort — si falla seguimos con DB delete)
    try:
        dbx = await _get_dropbox_service(db)
        await asyncio.to_thread(dbx.delete, row["dropbox_path"])
    except Exception:  # noqa: BLE001 — Dropbox down no debe bloquear cleanup DB
        pass

    await db.execute(
        text("DELETE FROM core.voucher_attachments WHERE attachment_id = :a"),
        {"a": attachment_id},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# APROBACIONES — firma digital (Fase 2)
# =====================================================================


class VoucherApprovalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    approval_id: int
    voucher_id: int
    approver_user_id: str
    role: str
    order_num: int
    decision: Literal["APPROVED", "REJECTED"]
    signed_at: datetime
    signature_hash: str
    ip_address: str | None
    user_agent: str | None
    comments: str | None


class VoucherApprovalsState(BaseModel):
    """Estado completo del flujo de aprobación de un voucher.

    Devuelve la regla matcheada + roles requeridos + firmas hechas +
    qué falta. Útil para que la UI muestre la botonera correcta.
    """

    voucher_id: int
    voucher_codigo: str
    voucher_status: str
    matched_rule_id: int | None
    matched_rule_descripcion: str | None
    required_roles: list[str]
    reinforced: bool
    approvals: list[VoucherApprovalRead]
    next_pending_role: str | None
    next_pending_order: int | None
    can_current_user_sign: bool
    current_user_eligible_role: str | None


class ApproveRequest(BaseModel):
    """POST /vouchers/{id}/approve — firma propia con rol activo en empresa."""

    role: str = Field(
        description="Rol con el que firma (debe estar asignado al user en esa empresa)"
    )
    comments: str | None = Field(default=None, max_length=500)


class RejectRequest(BaseModel):
    """POST /vouchers/{id}/reject — rechaza con razón obligatoria."""

    reason: str = Field(min_length=10, max_length=500)


def _client_ip(request: Request) -> str | None:
    # Fly y Vercel suelen poner la IP real en X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


@router.get(
    "/vouchers/{voucher_id}/approvals",
    response_model=VoucherApprovalsState,
)
async def get_voucher_approvals_state(
    user: CurrentUser, db: DBSession, voucher_id: int
) -> VoucherApprovalsState:
    """Devuelve el estado completo del flujo de aprobación.

    Calcula:
      1. La regla que matchea (por monto + tipo + balance treatment).
      2. Roles requeridos (en orden) y cuáles ya firmaron.
      3. Cuál es el próximo rol pendiente.
      4. Si el usuario actual puede firmar el siguiente paso.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )

    # Match rule
    rules = await load_active_rules(db, voucher.empresa_codigo)
    bt = await get_voucher_balance_treatment_dominante(db, voucher_id)
    rule = find_matching_rule(
        rules,
        voucher_tipo=voucher.tipo,
        voucher_amount=voucher.total_debit,
        balance_treatment_dominante=bt,
    )

    required_roles = list(rule["required_roles"]) if rule else []
    reinforced = compute_threshold_aplicado(rule)

    # Approvals existentes
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    approvals = [
        VoucherApprovalRead.model_validate(dict(a)) for a in approvals_raw
    ]
    approved_orders = {a.order_num for a in approvals if a.decision == "APPROVED"}

    # Próximo pendiente
    next_pending_role: str | None = None
    next_pending_order: int | None = None
    for i, role in enumerate(required_roles, start=1):
        if i not in approved_orders:
            next_pending_role = role
            next_pending_order = i
            break

    # Puede el user actual firmar?
    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    can_sign = bool(
        next_pending_role
        and voucher.status == "PENDING"
        and next_pending_role in user_roles
    )
    eligible_role = next_pending_role if can_sign else None

    return VoucherApprovalsState(
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        voucher_status=voucher.status,
        matched_rule_id=rule["rule_id"] if rule else None,
        matched_rule_descripcion=rule["descripcion"] if rule else None,
        required_roles=required_roles,
        reinforced=reinforced,
        approvals=approvals,
        next_pending_role=next_pending_role,
        next_pending_order=next_pending_order,
        can_current_user_sign=can_sign,
        current_user_eligible_role=eligible_role,
    )


@router.post(
    "/vouchers/{voucher_id}/approve",
    response_model=VoucherApprovalsState,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def approve_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: ApproveRequest,
) -> VoucherApprovalsState:
    """Firma del rol indicado.

    Validaciones:
      - Voucher existe y está en PENDING
      - User tiene el rol declarado activo en la empresa del voucher
      - El rol corresponde al próximo paso pendiente del flujo
      - Una vez firmado el último paso, el voucher pasa a APPROVED
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if voucher.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers PENDING aceptan firmas (este está en {voucher.status})",
        )

    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    if body.role not in user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"No tenés el rol '{body.role}' activo en empresa "
                f"{voucher.empresa_codigo}. Roles disponibles: "
                f"{user_roles or 'ninguno'}"
            ),
        )

    rules = await load_active_rules(db, voucher.empresa_codigo)
    bt = await get_voucher_balance_treatment_dominante(db, voucher_id)
    rule = find_matching_rule(
        rules,
        voucher_tipo=voucher.tipo,
        voucher_amount=voucher.total_debit,
        balance_treatment_dominante=bt,
    )
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No hay regla de aprobación configurada para este voucher. "
                "Configurá las reglas en /admin/approval-rules antes de aprobar."
            ),
        )

    required_roles = list(rule["required_roles"])
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    approved_orders = {
        a["order_num"] for a in approvals_raw if a["decision"] == "APPROVED"
    }

    # Identificar próximo paso pendiente
    next_order: int | None = None
    expected_role: str | None = None
    for i, role in enumerate(required_roles, start=1):
        if i not in approved_orders:
            next_order = i
            expected_role = role
            break

    if next_order is None or expected_role is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El voucher ya tiene todas las firmas requeridas",
        )
    if body.role != expected_role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El próximo rol que debe firmar es '{expected_role}', "
                f"no '{body.role}'. Las firmas son secuenciales."
            ),
        )

    # Anti-doble-firma: el mismo user no puede firmar dos pasos del mismo voucher
    user_already_signed = any(
        a["approver_user_id"] == str(user.sub) for a in approvals_raw
    )
    if user_already_signed and len(required_roles) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Ya firmaste este voucher con otro rol. La separación de "
                "responsabilidades exige firmas de personas distintas."
            ),
        )

    # Firmar
    await record_approval_signature(
        db,
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        approver_user_id=str(user.sub),
        role=body.role,
        order_num=next_order,
        decision="APPROVED",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        comments=body.comments,
    )

    # Si fue la última firma, voucher → APPROVED
    just_approved = False
    if next_order == len(required_roles):
        voucher.status = "APPROVED"
        voucher.threshold_aplicado = compute_threshold_aplicado(rule)
        just_approved = True

    await db.commit()

    # V5++ ola N: webhook saliente voucher.approved → sistemas externos.
    # Soft-fail: si nadie está suscripto, no hace nada. Ejecuta async
    # en background para no demorar la response del approve.
    if just_approved:
        try:
            from app.services.webhook_dispatcher import publish_event

            await publish_event(
                db,
                "voucher.approved",
                {
                    "voucher_id": voucher.voucher_id,
                    "voucher_codigo": voucher.codigo,
                    "empresa_codigo": voucher.empresa_codigo,
                    "tipo": voucher.tipo,
                    "total_debit": str(voucher.total_debit),
                    "fecha_contable": voucher.fecha_contable.isoformat()
                    if voucher.fecha_contable
                    else None,
                    "approved_by": str(user.sub),
                    "approved_at": datetime.utcnow().isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            # Webhook no crítico — no romper la firma del voucher
            import structlog

            structlog.get_logger(__name__).warning(
                "voucher.approved.webhook_failed",
                voucher_id=voucher.voucher_id,
                error=str(exc),
            )

        # V5++ ola O: Slack ping si el monto supera threshold
        try:
            from app.services.slack_service import notify_voucher_approved

            await notify_voucher_approved(
                voucher_codigo=voucher.codigo,
                empresa_codigo=voucher.empresa_codigo,
                tipo=voucher.tipo,
                total_clp=int(voucher.total_debit),
                approved_by=str(user.sub),
            )
        except Exception:
            pass  # Soft-fail

    return await get_voucher_approvals_state(user, db, voucher_id)


@router.post(
    "/vouchers/{voucher_id}/reject",
    response_model=VoucherApprovalsState,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def reject_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    voucher_id: int,
    body: RejectRequest,
) -> VoucherApprovalsState:
    """Rechaza el voucher con razón. Pasa a REJECTED.

    Cualquier rol asignado en la empresa puede rechazar (no solo el
    aprobador del paso actual). Esto permite que un Director frene un
    voucher dudoso aunque no le toque firmar el siguiente paso.
    """
    voucher = await db.get(Voucher, voucher_id)
    if voucher is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Voucher no encontrado"
        )
    if voucher.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Solo vouchers PENDING pueden rechazarse (este está en {voucher.status})",
        )

    user_roles = await load_user_roles_for_empresa(
        db, str(user.sub), voucher.empresa_codigo
    )
    if not user_roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"No tenés rol asignado en empresa {voucher.empresa_codigo}. "
                "El rechazo lo hace alguien con rol operativo en la empresa."
            ),
        )

    # Registrar rechazo en approvals (orden_num = siguiente disponible)
    approvals_raw = await get_voucher_approvals(db, voucher_id)
    next_order = (
        max((a["order_num"] for a in approvals_raw), default=0) + 1
    )

    await record_approval_signature(
        db,
        voucher_id=voucher_id,
        voucher_codigo=voucher.codigo,
        approver_user_id=str(user.sub),
        role=user_roles[0],  # cualquiera de los roles activos
        order_num=next_order,
        decision="REJECTED",
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        comments=body.reason,
    )

    voucher.status = "REJECTED"
    voucher.rejection_reason = body.reason.strip()
    await db.commit()
    return await get_voucher_approvals_state(user, db, voucher_id)


# ============================================================================
# AI auto-fill — V5++: crear voucher DRAFT desde factura PDF en Dropbox
# ============================================================================


class VoucherFromFacturaRequest(BaseModel):
    """POST /vouchers/from-factura-pdf — crea voucher DRAFT desde factura PDF.

    Usa document_analyzer_service (Claude) para extraer:
      - proveedor_rut + proveedor_nombre
      - numero_factura (folio)
      - fecha
      - monto_neto + iva + total
      - descripcion (glosa)

    Y crea un voucher tipo COMPRA en estado DRAFT con esos datos
    pre-llenados. El user revisa, completa imputación contable
    (cuenta + proyecto + área), y envía a aprobación.
    """

    empresa_codigo: str = Field(..., description="Empresa que recibe la factura")
    dropbox_path: str = Field(..., description="Path en Dropbox del PDF")


class VoucherFromFacturaResponse(BaseModel):
    voucher_id: int
    voucher_codigo: str
    extracted: dict
    warnings: list[str] = []


@router.post(
    "/vouchers/from-factura-pdf",
    response_model=VoucherFromFacturaResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_voucher_from_factura_pdf(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: VoucherFromFacturaRequest,
) -> VoucherFromFacturaResponse:
    """Crea voucher COMPRA DRAFT con datos extraídos de un PDF factura.

    Flujo:
      1. Descarga el PDF de Dropbox
      2. Extrae texto con pypdf (fallback OCR si está configurado)
      3. Llama Claude con schema 'factura' → obtiene proveedor, monto, fecha
      4. Genera código voucher (next_voucher_code en DB)
      5. INSERT voucher con líneas vacías — user completa imputación

    El voucher queda en DRAFT con líneas con descripción de la factura
    pero sin cuenta_codigo / proyecto / area (los completa el user).

    Soft-fail: si Claude no está configurado o el PDF está corrupto,
    devuelve 503/422 con detalle.
    """
    from app.services.document_analyzer_service import (
        DocumentAnalyzerNotConfigured,
        analyze_document,
        extract_text_pdf_with_fallback,
    )
    from app.services.dropbox_service import (
        DropboxNotConfigured,
        DropboxService,
    )

    # 1. Descargar PDF
    try:
        dbx = DropboxService()
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        content = dbx.download_file(body.dropbox_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se pudo descargar {body.dropbox_path}: {exc}",
        ) from exc

    # 2. Extraer texto
    try:
        text_extracted, extraction_meta = extract_text_pdf_with_fallback(content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No se pudo extraer texto del PDF: {exc}",
        ) from exc

    if not text_extracted or len(text_extracted.strip()) < 30:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "PDF parece escaneado y OCR no está disponible. "
                "Convertí el PDF a digital o pegá los datos manualmente."
            ),
        )

    # 3. Analizar con Claude
    try:
        extraction = await analyze_document(
            text_extracted,
            tipo="factura",
            filename=body.dropbox_path.rsplit("/", 1)[-1],
            extraction_method=extraction_meta.get("method"),
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    fields = extraction.fields if hasattr(extraction, "fields") else {}
    warnings = list(getattr(extraction, "warnings", []) or [])

    # 4. Validar empresa
    empresa_existe = await db.scalar(
        text(
            "SELECT 1 FROM core.empresas WHERE codigo = :c"
        ),
        {"c": body.empresa_codigo},
    )
    if not empresa_existe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe",
        )

    # 5. Generar código voucher
    fecha_str = fields.get("fecha") or date.today().isoformat()
    try:
        fecha_voucher = date.fromisoformat(fecha_str)
    except (ValueError, TypeError):
        fecha_voucher = date.today()
        warnings.append(f"Fecha de factura inválida: {fecha_str} (usando hoy)")

    codigo_row = (
        await db.execute(
            text(
                "SELECT core.next_voucher_code(:emp, :anio, 'COMPRA') AS codigo"
            ),
            {"emp": body.empresa_codigo, "anio": fecha_voucher.year},
        )
    ).first()
    voucher_codigo = codigo_row[0] if codigo_row else f"COMPRA-{body.empresa_codigo}-{fecha_voucher.year}-AUTO"

    # 6. INSERT voucher DRAFT
    proveedor_rut = fields.get("proveedor_rut")
    proveedor_nombre = fields.get("proveedor_nombre", "")
    numero_factura = fields.get("numero_factura")
    glosa = (
        fields.get("descripcion")
        or f"Factura {numero_factura or ''} de {proveedor_nombre or 'proveedor'}"
    )[:500]

    voucher_total = (
        Decimal(str(fields.get("total") or 0))
        if fields.get("total")
        else Decimal("0")
    )

    voucher_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.vouchers (
                    codigo, empresa_codigo, tipo, status,
                    fecha_documento, fecha_contable, glosa,
                    contraparte_tipo, contraparte_rut, contraparte_nombre,
                    doc_tributario_tipo, doc_tributario_folio,
                    total_debit, total_credit,
                    created_by
                )
                VALUES (
                    :codigo, :emp, 'COMPRA', 'DRAFT',
                    :fecha, :fecha, :glosa,
                    'PROVEEDOR', :rut, :nombre,
                    'FACTURA', :folio,
                    0, 0,
                    :user
                )
                RETURNING voucher_id
                """
            ),
            {
                "codigo": voucher_codigo,
                "emp": body.empresa_codigo,
                "fecha": fecha_voucher,
                "glosa": glosa,
                "rut": proveedor_rut,
                "nombre": proveedor_nombre[:255] if proveedor_nombre else None,
                "folio": str(numero_factura) if numero_factura else None,
                "user": str(user.sub),
            },
        )
    ).first()
    voucher_id = int(voucher_row[0]) if voucher_row else 0
    await db.commit()

    return VoucherFromFacturaResponse(
        voucher_id=voucher_id,
        voucher_codigo=voucher_codigo,
        extracted={
            "proveedor_rut": proveedor_rut,
            "proveedor_nombre": proveedor_nombre,
            "numero_factura": numero_factura,
            "fecha": fecha_str,
            "monto_neto": fields.get("monto_neto"),
            "iva": fields.get("iva"),
            "total": fields.get("total"),
        },
        warnings=warnings,
    )


# ============================================================================
# Bulk approve — V5+: firma múltiples vouchers PENDING con un solo rol
# ============================================================================


class BulkApproveRequest(BaseModel):
    """POST /vouchers/bulk-approve — firma N vouchers con el mismo rol.

    Caso de uso: el COO (Nicolás) revisa la cola de vouchers PENDING
    al final del día y firma todos los que ya validó técnicamente.
    Cada voucher se valida individualmente — si uno falla, no aborta
    el resto.
    """

    voucher_ids: list[int] = Field(..., min_length=1, max_length=100)
    role: str = Field(description="Rol con el que firma (debe estar activo en cada empresa)")


class BulkApproveItemResult(BaseModel):
    voucher_id: int
    success: bool
    error: str | None = None
    new_status: str | None = None


class BulkApproveResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    items: list[BulkApproveItemResult]


@router.post(
    "/vouchers/bulk-approve",
    response_model=BulkApproveResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def bulk_approve_vouchers(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    body: BulkApproveRequest,
) -> BulkApproveResponse:
    """Firma múltiples vouchers con el rol indicado. Operación best-effort:
    cada voucher se procesa en su propia transacción; los que fallan no
    abortan los exitosos.

    Validaciones por voucher (mismas que /approve individual):
    - Voucher existe y está en PENDING
    - User tiene el rol activo en la empresa del voucher
    - El rol corresponde al próximo paso pendiente del flujo
    - Una vez firmado el último paso, el voucher pasa a APPROVED

    Idempotente: si un voucher ya fue firmado por este user con este rol,
    no falla — devuelve success=True con su status actual.
    """
    items: list[BulkApproveItemResult] = []

    # Pre-cargar user_id real una sola vez
    user_sub = str(user.sub)

    for vid in body.voucher_ids:
        try:
            voucher = await db.get(Voucher, vid)
            if voucher is None:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error="Voucher no encontrado",
                ))
                continue
            if voucher.status != "PENDING":
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=f"Status {voucher.status} (solo PENDING acepta firmas)",
                    new_status=voucher.status,
                ))
                continue

            user_roles = await load_user_roles_for_empresa(
                db, user_sub, voucher.empresa_codigo
            )
            if body.role not in user_roles:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        f"Sin rol '{body.role}' en {voucher.empresa_codigo}"
                    ),
                ))
                continue

            rules = await load_active_rules(db, voucher.empresa_codigo)
            bt = await get_voucher_balance_treatment_dominante(db, vid)
            rule = find_matching_rule(
                rules,
                voucher_tipo=voucher.tipo,
                voucher_amount=voucher.total_debit,
                balance_treatment_dominante=bt,
            )
            if rule is None:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error="Sin regla de aprobación configurada",
                ))
                continue

            required_roles = list(rule["required_roles"])
            approvals_raw = await get_voucher_approvals(db, vid)
            approved_orders = {
                a["order_num"] for a in approvals_raw if a["decision"] == "APPROVED"
            }

            # Próximo paso pendiente
            next_order = None
            expected_role = None
            for i, role in enumerate(required_roles, start=1):
                if i not in approved_orders:
                    next_order = i
                    expected_role = role
                    break

            if next_order is None:
                # Ya tiene todas las firmas — no debería estar PENDING
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=True,
                    new_status=voucher.status,
                    error="Ya tenía todas las firmas (no-op)",
                ))
                continue

            if expected_role != body.role:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        f"Próximo rol esperado: '{expected_role}', "
                        f"vos firmás como '{body.role}'"
                    ),
                ))
                continue

            # Anti-doble-firma: si flow tiene múltiples roles, mismo user
            # no puede firmar dos pasos. Skipear este voucher.
            user_already_signed = any(
                a["approver_user_id"] == user_sub for a in approvals_raw
            )
            if user_already_signed and len(required_roles) > 1:
                items.append(BulkApproveItemResult(
                    voucher_id=vid, success=False,
                    error=(
                        "Ya firmaste este voucher con otro rol "
                        "(separación de responsabilidades)"
                    ),
                ))
                continue

            # Firmar (mismo flow que /approve individual)
            await record_approval_signature(
                db,
                voucher_id=vid,
                voucher_codigo=voucher.codigo,
                approver_user_id=user_sub,
                role=body.role,
                order_num=next_order,
                decision="APPROVED",
                ip_address=_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                comments=None,
            )

            # Si firmó el último paso → APPROVED
            just_approved = False
            if next_order == len(required_roles):
                voucher.status = "APPROVED"
                voucher.threshold_aplicado = compute_threshold_aplicado(rule)
                just_approved = True

            items.append(BulkApproveItemResult(
                voucher_id=vid, success=True,
                new_status=voucher.status,
            ))

            # V5++ ola N: webhook por cada voucher recién aprobado en el bulk
            if just_approved:
                try:
                    from app.services.webhook_dispatcher import publish_event

                    await publish_event(
                        db,
                        "voucher.approved",
                        {
                            "voucher_id": voucher.voucher_id,
                            "voucher_codigo": voucher.codigo,
                            "empresa_codigo": voucher.empresa_codigo,
                            "tipo": voucher.tipo,
                            "total_debit": str(voucher.total_debit),
                            "approved_by": user_sub,
                            "via_bulk_approve": True,
                        },
                    )
                except Exception:
                    pass  # Soft-fail
        except Exception as exc:  # noqa: BLE001
            items.append(BulkApproveItemResult(
                voucher_id=vid, success=False,
                error=f"Error inesperado: {exc}",
            ))

    await db.commit()

    succeeded = sum(1 for r in items if r.success)
    return BulkApproveResponse(
        total=len(body.voucher_ids),
        succeeded=succeeded,
        failed=len(body.voucher_ids) - succeeded,
        items=items,
    )


# =====================================================================
# V5++ ola Y — POST /vouchers/import-csv (bulk import desde Excel chileno)
# =====================================================================


class ImportCsvResponse(BaseModel):
    total_rows: int
    total_vouchers_intended: int
    vouchers_created_count: int
    errors_count: int
    vouchers_created: list[dict] = Field(default_factory=list)
    errors: list[dict] = Field(default_factory=list)


@router.post(
    "/vouchers/import-csv",
    response_model=ImportCsvResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def import_vouchers_csv(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    file: UploadFile = File(...),
    dry_run: bool = Form(False),
) -> ImportCsvResponse:
    """Bulk-import de vouchers desde CSV (Excel chileno).

    Formato esperado:
        - Separador: `;`  (Excel chileno)
        - Encoding: UTF-8 (BOM opcional)
        - Una fila por LÍNEA del voucher; mismo `voucher_ref` agrupa
          filas en un voucher con sus líneas.

    Columnas obligatorias (case-insensitive, aliases en español OK):
        voucher_ref, empresa_codigo, tipo, fecha_documento, fecha_contable,
        glosa, line_number, cuenta_codigo

    Columnas opcionales:
        contraparte_rut, contraparte_nombre, doc_tributario_tipo,
        doc_tributario_folio, proyecto_codigo, area_codigo, debit, credit,
        descripcion

    Todos los vouchers se crean en `DRAFT` (descuadre permitido). El user
    revisa y submit manualmente, o usa /vouchers/bulk-approve después.

    `dry_run=true` valida y devuelve el reporte sin insertar nada — útil
    para previsualizar antes de commitear el import.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe tener extensión .csv",
        )

    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:  # 10 MB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV excede 10 MB. Dividir en partes más chicas.",
        )

    from app.services.voucher_csv_import_service import parse_csv_to_vouchers

    parsed_vouchers, report = parse_csv_to_vouchers(raw)

    if dry_run or not parsed_vouchers:
        return ImportCsvResponse(**report.to_dict())

    # Insertar best-effort: cada voucher en su propia transacción lógica.
    # Si uno falla por validación contra DB (cuenta no existe, empresa
    # inactiva), seguimos con los demás.
    for vc in parsed_vouchers:
        try:
            # Re-usar el handler create_voucher hubiera sido lindo pero
            # depende de Pydantic-as-body. Replicamos la lógica esencial:
            #
            # 1. Empresa activa
            from sqlalchemy import text as _text
            empresa_activa = await db.scalar(
                _text(
                    "SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"
                ),
                {"c": vc.empresa_codigo},
            )
            if not empresa_activa:
                report.errors.append(
                    _make_csv_error(
                        vc, f"Empresa '{vc.empresa_codigo}' inactiva o inexistente"
                    )
                )
                continue

            # 2. Período cerrado
            if await is_period_locked_for(
                db, vc.empresa_codigo, vc.fecha_contable
            ):
                report.errors.append(
                    _make_csv_error(
                        vc,
                        f"Período {vc.fecha_contable} cerrado para {vc.empresa_codigo}",
                    )
                )
                continue

            # 3. Cuentas existen + imputables (validación por línea)
            cuentas_ok = True
            for line in vc.lines:
                cuenta = await fetch_cuenta_metadata(db, line.cuenta_codigo)
                if cuenta is None or not cuenta["imputable"] or not cuenta["activa"]:
                    report.errors.append(
                        _make_csv_error(
                            vc,
                            f"Cuenta '{line.cuenta_codigo}' no existe / no imputable / inactiva",
                        )
                    )
                    cuentas_ok = False
                    break
            if not cuentas_ok:
                continue

            # 4. Generar correlativo
            anio = vc.fecha_contable.year
            codigo = await generate_voucher_code(
                db, vc.empresa_codigo, anio, vc.tipo
            )

            # 5. Insertar voucher + líneas
            from decimal import Decimal as _D
            total_debit = sum(
                (line.debit for line in vc.lines), start=_D("0")
            )
            total_credit = sum(
                (line.credit for line in vc.lines), start=_D("0")
            )

            voucher = Voucher(
                codigo=codigo,
                empresa_codigo=vc.empresa_codigo,
                tipo=vc.tipo,
                status="DRAFT",
                fecha_documento=vc.fecha_documento,
                fecha_contable=vc.fecha_contable,
                glosa=vc.glosa.strip(),
                total_debit=total_debit,
                total_credit=total_credit,
                moneda=vc.moneda,
                contraparte_rut=vc.contraparte_rut,
                contraparte_nombre=vc.contraparte_nombre,
                doc_tributario_tipo=vc.doc_tributario_tipo,
                doc_tributario_folio=vc.doc_tributario_folio,
                created_by=str(user.sub),
                requested_by=str(user.sub),
            )
            db.add(voucher)
            await db.flush()

            for line_data in vc.lines:
                line = VoucherLine(
                    voucher_id=voucher.voucher_id,
                    line_number=line_data.line_number,
                    cuenta_codigo=line_data.cuenta_codigo,
                    proyecto_codigo=line_data.proyecto_codigo,
                    area_codigo=line_data.area_codigo,
                    debit=line_data.debit,
                    credit=line_data.credit,
                    descripcion=line_data.descripcion,
                )
                db.add(line)

            await db.flush()
            report.vouchers_created.append({
                "voucher_id": voucher.voucher_id,
                "codigo": voucher.codigo,
                "empresa_codigo": voucher.empresa_codigo,
                "total_debit": str(total_debit),
                "total_credit": str(total_credit),
                "lines": len(vc.lines),
            })
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            report.errors.append(_make_csv_error(vc, f"error: {exc}"))

    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error commiteando vouchers: {exc}",
        ) from exc

    return ImportCsvResponse(**report.to_dict())


def _make_csv_error(vc, message: str):
    """Helper para construir CsvImportError sin imports circulares."""
    from app.services.voucher_csv_import_service import CsvImportError

    return CsvImportError(
        voucher_ref=f"{vc.empresa_codigo}-{vc.fecha_contable}",
        row=0,
        field=None,
        message=message,
    )


# Forward reference resolution para datetime no usado pero importado por
# Voucher/VoucherLine schemas (ruff F401 lo flaggearía sino).
_ = datetime
