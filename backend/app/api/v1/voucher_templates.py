"""V5++ ola AB — Endpoints CRUD de voucher_templates + use.

Plantillas reutilizables para vouchers recurrentes mensuales (sueldos,
arriendos, servicios, etc).

Endpoints:
    GET    /vouchers/templates                      — list filtrable
    GET    /vouchers/templates/{id}                 — detalle
    POST   /vouchers/templates                      — crear plantilla manual
    POST   /vouchers/templates/from-voucher/{vid}   — crear plantilla a partir
                                                       de un voucher existente
    PATCH  /vouchers/templates/{id}                 — editar plantilla
    DELETE /vouchers/templates/{id}                 — soft delete (activo=false)
    POST   /vouchers/templates/{id}/use             — instanciar como DRAFT voucher

La plantilla guarda lines como JSONB. Al usar, instanciamos el voucher
con esas líneas; opcionalmente multiplicamos los montos por un factor.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import desc, select, text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.models.voucher import Voucher, VoucherLine
from app.models.voucher_template import VoucherTemplate
from app.schemas.voucher import VoucherRead
from app.schemas.voucher_template import (
    TemplateUseRequest,
    VoucherTemplateCreate,
    VoucherTemplateListItem,
    VoucherTemplateRead,
    VoucherTemplateUpdate,
)
from app.services.voucher_service import (
    fetch_cuenta_metadata,
    generate_voucher_code,
    is_period_locked_for,
)

router = APIRouter()


# =====================================================================
# GET /vouchers/templates — list
# =====================================================================


@router.get(
    "/vouchers/templates",
    response_model=list[VoucherTemplateListItem],
    dependencies=[Depends(require_scope("legal:read"))],
)
async def list_templates(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    activo: bool = Query(default=True),
    sort: Literal["recent", "most_used", "alpha"] = "recent",
    limit: int = Query(default=50, ge=1, le=200),
) -> list[VoucherTemplateListItem]:
    """Lista plantillas. Por default: activas, ordenadas por uso reciente.

    `sort=most_used` ordena por use_count desc — útil para mostrar las
    plantillas más populares al inicio del list.
    """
    q = select(VoucherTemplate).where(VoucherTemplate.activo == activo)
    if empresa_codigo:
        q = q.where(VoucherTemplate.empresa_codigo == empresa_codigo)

    if sort == "recent":
        q = q.order_by(desc(VoucherTemplate.last_used_at).nullslast())
    elif sort == "most_used":
        q = q.order_by(desc(VoucherTemplate.use_count))
    else:  # alpha
        q = q.order_by(VoucherTemplate.nombre)

    q = q.limit(limit)
    rows = (await db.scalars(q)).all()
    return [VoucherTemplateListItem.model_validate(r) for r in rows]


# =====================================================================
# GET /vouchers/templates/{id} — detalle
# =====================================================================


@router.get(
    "/vouchers/templates/{template_id}",
    response_model=VoucherTemplateRead,
    dependencies=[Depends(require_scope("legal:read"))],
)
async def get_template(
    user: CurrentUser, db: DBSession, template_id: int
) -> VoucherTemplateRead:
    tpl = await db.get(VoucherTemplate, template_id)
    if not tpl:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plantilla {template_id} no encontrada",
        )
    return VoucherTemplateRead.model_validate(tpl)


# =====================================================================
# POST /vouchers/templates — crear manual
# =====================================================================


@router.post(
    "/vouchers/templates",
    response_model=VoucherTemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_template(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: VoucherTemplateCreate,
) -> VoucherTemplateRead:
    """Crea plantilla nueva manual. El `codigo` debe ser único."""
    # Verificar que el código no exista ya
    existing = await db.scalar(
        select(VoucherTemplate).where(VoucherTemplate.codigo == body.codigo)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una plantilla con código '{body.codigo}'",
        )

    # Verificar empresa activa
    empresa_activa = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"),
        {"c": body.empresa_codigo},
    )
    if not empresa_activa:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe o está inactiva",
        )

    # Verificar que cada cuenta exista + sea imputable.
    # Round 5 fix N+1: batchear con WHERE codigo = ANY(:codes) y validar en
    # memoria. Antes hacia 1 query por linea (5-20 queries por template).
    cuenta_codes = list({line.cuenta_codigo for line in body.lines})
    cuentas_rows = (
        await db.execute(
            text(
                """
                SELECT codigo, imputable, activa
                FROM core.plan_cuentas
                WHERE codigo = ANY(:codes)
                """
            ),
            {"codes": cuenta_codes},
        )
    ).mappings().all()
    cuentas_map = {c["codigo"]: c for c in cuentas_rows}

    for line in body.lines:
        cuenta = cuentas_map.get(line.cuenta_codigo)
        if cuenta is None or not cuenta["imputable"] or not cuenta["activa"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Línea {line.line_number}: cuenta '{line.cuenta_codigo}' "
                    f"no existe / no imputable / inactiva"
                ),
            )

    tpl = VoucherTemplate(
        codigo=body.codigo,
        nombre=body.nombre,
        empresa_codigo=body.empresa_codigo,
        tipo=body.tipo,
        glosa_default=body.glosa_default,
        moneda=body.moneda,
        lines=[
            {
                "line_number": line.line_number,
                "cuenta_codigo": line.cuenta_codigo,
                "proyecto_codigo": line.proyecto_codigo,
                "area_codigo": line.area_codigo,
                "debit": str(line.debit),
                "credit": str(line.credit),
                "descripcion": line.descripcion,
                "iva_tratamiento": line.iva_tratamiento,
                "balance_treatment": line.balance_treatment,
            }
            for line in body.lines
        ],
        contraparte_rut=body.contraparte_rut,
        contraparte_nombre=body.contraparte_nombre,
        contraparte_tipo=body.contraparte_tipo,
        doc_tributario_tipo=body.doc_tributario_tipo,
        created_by=str(user.sub),
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return VoucherTemplateRead.model_validate(tpl)


# =====================================================================
# POST /vouchers/templates/from-voucher/{vid} — crear desde voucher
# =====================================================================


@router.post(
    "/vouchers/templates/from-voucher/{voucher_id}",
    response_model=VoucherTemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_template_from_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    codigo: str = Query(..., min_length=3, max_length=50, pattern=r"^[A-Z0-9_-]+$"),
    nombre: str = Query(..., min_length=3, max_length=200),
) -> VoucherTemplateRead:
    """Crea plantilla a partir de un voucher existente. El voucher se mantiene
    intacto; copiamos sus líneas + header.

    Útil para: el COO crea un voucher complejo de sueldo, lo guarda, y
    después click "Guardar como plantilla" → la próxima vez 1 click.
    """
    voucher = await db.get(Voucher, voucher_id)
    if not voucher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voucher {voucher_id} no encontrado",
        )

    existing = await db.scalar(
        select(VoucherTemplate).where(VoucherTemplate.codigo == codigo)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe una plantilla con código '{codigo}'",
        )

    # Cargar líneas del voucher
    lines_q = select(VoucherLine).where(
        VoucherLine.voucher_id == voucher_id
    ).order_by(VoucherLine.line_number)
    lines_rows = (await db.scalars(lines_q)).all()

    if not lines_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Voucher no tiene líneas — no se puede crear plantilla",
        )

    tpl = VoucherTemplate(
        codigo=codigo,
        nombre=nombre,
        empresa_codigo=voucher.empresa_codigo,
        tipo=voucher.tipo,
        glosa_default=voucher.glosa,
        moneda=voucher.moneda,
        lines=[
            {
                "line_number": line.line_number,
                "cuenta_codigo": line.cuenta_codigo,
                "proyecto_codigo": line.proyecto_codigo,
                "area_codigo": line.area_codigo,
                "debit": str(line.debit),
                "credit": str(line.credit),
                "descripcion": line.descripcion,
                "iva_tratamiento": line.iva_tratamiento,
                "balance_treatment": line.balance_treatment,
            }
            for line in lines_rows
        ],
        contraparte_rut=voucher.contraparte_rut,
        contraparte_nombre=voucher.contraparte_nombre,
        contraparte_tipo=voucher.contraparte_tipo,
        doc_tributario_tipo=voucher.doc_tributario_tipo,
        created_by=str(user.sub),
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return VoucherTemplateRead.model_validate(tpl)


# =====================================================================
# PATCH /vouchers/templates/{id} — editar
# =====================================================================


@router.patch(
    "/vouchers/templates/{template_id}",
    response_model=VoucherTemplateRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_template(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    template_id: int,
    body: VoucherTemplateUpdate,
) -> VoucherTemplateRead:
    tpl = await db.get(VoucherTemplate, template_id)
    if not tpl:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plantilla {template_id} no encontrada",
        )

    data = body.model_dump(exclude_unset=True)
    if "lines" in data and data["lines"] is not None:
        data["lines"] = [
            {
                "line_number": line.line_number,
                "cuenta_codigo": line.cuenta_codigo,
                "proyecto_codigo": line.proyecto_codigo,
                "area_codigo": line.area_codigo,
                "debit": str(line.debit),
                "credit": str(line.credit),
                "descripcion": line.descripcion,
                "iva_tratamiento": line.iva_tratamiento,
                "balance_treatment": line.balance_treatment,
            }
            for line in body.lines or []
        ]

    for k, v in data.items():
        setattr(tpl, k, v)
    tpl.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(tpl)
    return VoucherTemplateRead.model_validate(tpl)


# =====================================================================
# DELETE /vouchers/templates/{id} — soft delete
# =====================================================================


@router.delete(
    "/vouchers/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_template(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    template_id: int,
) -> Response:
    """Soft delete: marca activo=false. La plantilla deja de aparecer en list
    default pero queda preservada para auditoría."""
    tpl = await db.get(VoucherTemplate, template_id)
    if not tpl:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plantilla {template_id} no encontrada",
        )
    tpl.activo = False
    tpl.updated_at = datetime.utcnow()
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# POST /vouchers/templates/{id}/use — instanciar como voucher DRAFT
# =====================================================================


@router.post(
    "/vouchers/templates/{template_id}/use",
    response_model=VoucherRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def use_template(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    template_id: int,
    body: TemplateUseRequest,
) -> VoucherRead:
    """Instancia la plantilla como un voucher nuevo en DRAFT.

    - Toma todas las líneas de la plantilla
    - Si `multiplier` se provee, multiplica debit/credit por ese factor
    - `glosa_override` reemplaza glosa_default; soporta interpolación
      `{mes}`, `{anio}`, `{fecha}` (en formato ISO)
    - El voucher resultante queda en DRAFT — el user lo revisa y submit
    - Incrementa `use_count` y actualiza `last_used_at`
    """
    tpl = await db.get(VoucherTemplate, template_id)
    if not tpl:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plantilla {template_id} no encontrada",
        )
    if not tpl.activo:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plantilla está desactivada — usar PATCH para reactivar",
        )

    # Parse fechas
    try:
        fecha_doc = date.fromisoformat(body.fecha_documento)
        fecha_cont = date.fromisoformat(body.fecha_contable)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fecha inválida (usar ISO YYYY-MM-DD): {exc}",
        ) from exc

    # Verificar período abierto
    if await is_period_locked_for(db, tpl.empresa_codigo, fecha_cont):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Fecha contable {fecha_cont} en período cerrado para "
                f"{tpl.empresa_codigo}. Usar voucher de REVERSO si necesario."
            ),
        )

    # Glosa con interpolación
    if body.glosa_override:
        glosa_raw = body.glosa_override
    else:
        glosa_raw = tpl.glosa_default
    MESES_ES = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ]
    glosa = (
        glosa_raw
        .replace("{mes}", MESES_ES[fecha_cont.month - 1])
        .replace("{anio}", str(fecha_cont.year))
        .replace("{fecha}", fecha_cont.isoformat())
    )

    # Multiplier
    multiplier = body.multiplier if body.multiplier is not None else Decimal("1")

    # Generar correlativo
    codigo = await generate_voucher_code(
        db, tpl.empresa_codigo, fecha_cont.year, tpl.tipo
    )

    # Construir totales
    total_debit = Decimal("0")
    total_credit = Decimal("0")
    for line_data in tpl.lines:
        total_debit += Decimal(str(line_data.get("debit", "0"))) * multiplier
        total_credit += Decimal(str(line_data.get("credit", "0"))) * multiplier

    # Crear voucher
    voucher = Voucher(
        codigo=codigo,
        empresa_codigo=tpl.empresa_codigo,
        tipo=tpl.tipo,
        status="DRAFT",  # ¡siempre DRAFT! el user revisa antes de submit
        fecha_documento=fecha_doc,
        fecha_contable=fecha_cont,
        glosa=glosa,
        total_debit=total_debit,
        total_credit=total_credit,
        moneda=tpl.moneda,
        contraparte_rut=tpl.contraparte_rut,
        contraparte_nombre=tpl.contraparte_nombre,
        contraparte_tipo=tpl.contraparte_tipo,
        doc_tributario_tipo=tpl.doc_tributario_tipo,
        doc_tributario_folio=body.doc_tributario_folio,
        created_by=str(user.sub),
        requested_by=str(user.sub),
    )
    db.add(voucher)
    await db.flush()

    for line_data in tpl.lines:
        line = VoucherLine(
            voucher_id=voucher.voucher_id,
            line_number=line_data["line_number"],
            cuenta_codigo=line_data["cuenta_codigo"],
            proyecto_codigo=line_data.get("proyecto_codigo"),
            area_codigo=line_data.get("area_codigo"),
            debit=Decimal(str(line_data.get("debit", "0"))) * multiplier,
            credit=Decimal(str(line_data.get("credit", "0"))) * multiplier,
            descripcion=line_data.get("descripcion"),
            iva_tratamiento=line_data.get("iva_tratamiento"),
            balance_treatment=line_data.get("balance_treatment", "NA"),
        )
        db.add(line)

    # Incrementar contador en la plantilla
    tpl.use_count += 1
    tpl.last_used_at = datetime.utcnow()

    await db.commit()
    await db.refresh(voucher)

    # Re-fetch con líneas para devolver
    from sqlalchemy.orm import selectinload
    voucher_full = await db.scalar(
        select(Voucher)
        .options(selectinload(Voucher.lines))
        .where(Voucher.voucher_id == voucher.voucher_id)
    )
    return VoucherRead.model_validate(voucher_full)
