"""V5++ ola AL — LP contratos del FIP CEHTA ESG.

Endpoints:
    GET    /lp-contratos                       — lista
    GET    /lp-contratos/summary               — KPIs (Σ UF, % meta, estado breakdown)
    GET    /lp-contratos/{id}                  — detalle
    POST   /lp-contratos                       — crear contrato
    PATCH  /lp-contratos/{id}                  — editar campos no críticos
    POST   /lp-contratos/{id}/marcar-suscrito  — PROMETIDO → SUSCRITO (firma definitiva)
    POST   /lp-contratos/{id}/pagar            — ANY → PAGADO + crea voucher INGRESO auto
    POST   /lp-contratos/{id}/resolver         — anulación con razón
    GET    /lp-contratos/{id}/voucher          — devuelve voucher generado al pagar
    POST   /lp-contratos/import-csv            — bulk import

Auto-voucher: cuando se llama POST /pagar, el sistema crea:
    Voucher INGRESO (FONDO, fecha_pago):
      Línea 1: DEBE  1-01-01-001  Banco Cuenta Corriente  $monto_clp
      Línea 2: HABER 3-01-01-001  Capital pagado Serie A  $monto_clp
              (3-01-01-002 si serie=B)
      Glosa: "Aporte LP {nombre} — {N cuotas} × {valor_uf} UF Serie {X}"
      Contraparte: suscriptor_rut + suscriptor_nombre

Validaciones:
    - Solo admin (`legal:write` + admin role) puede crear/pagar/resolver
    - No se puede pagar 2 veces el mismo contrato (idempotent)
    - monto_clp debe estar seteado antes de pagar (o se pasa en el body)
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func as sql_func
from sqlalchemy import select, text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.models.lp_contrato import LpContrato
from app.models.voucher import Voucher, VoucherLine
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.voucher_service import generate_voucher_code

router = APIRouter()


# Plan de cuentas mapping (puede tuneárse desde /admin/plan-cuentas)
CUENTA_BANCO_DEBE = "1-01-01-001"      # Banco Cuenta Corriente FONDO
CUENTA_CAPITAL_SERIE_A = "3-01-01-001"  # Capital pagado Cuotas Serie A
CUENTA_CAPITAL_SERIE_B = "3-01-01-002"  # Capital pagado Cuotas Serie B
META_UF_FONDO = Decimal("175000")       # Cláusula 1.4


# =====================================================================
# Schemas
# =====================================================================


TipoContrato = Literal["PROMESA", "DEFINITIVO"]
SerieType = Literal["A", "B"]
EstadoContrato = Literal["PROMETIDO", "SUSCRITO", "PAGADO", "INCUMPLIDO", "RESUELTO"]


class LpContratoCreate(BaseModel):
    fondo_codigo: str = Field(default="FONDO", min_length=2, max_length=20)
    suscriptor_nombre: str = Field(min_length=3, max_length=200)
    suscriptor_rut: str = Field(min_length=8, max_length=20)
    representante_nombre: str | None = None
    representante_rut: str | None = None
    domicilio: str | None = None
    email: str | None = None

    tipo_contrato: TipoContrato
    serie: SerieType
    fecha_contrato: date
    notaria: str | None = None
    codigo_verificacion: str | None = None

    cantidad_cuotas: Decimal = Field(gt=0)
    valor_por_cuota_uf: Decimal = Field(default=Decimal("350"), gt=0)
    uf_comprometidas: Decimal = Field(gt=0)
    monto_clp: Decimal | None = None
    uf_value_at_signing: Decimal | None = None

    multa_mora_pct: Decimal | None = Field(default=Decimal("5.00"), ge=0, le=100)
    indemnizacion_pct: Decimal | None = Field(default=Decimal("50.00"), ge=0, le=100)
    forma_pago: str | None = None

    observaciones: str | None = None
    dropbox_path: str | None = None


class LpContratoUpdate(BaseModel):
    """PATCH — solo campos no críticos. Estado / monto_clp pasan por endpoints específicos."""

    representante_nombre: str | None = None
    representante_rut: str | None = None
    domicilio: str | None = None
    email: str | None = None
    notaria: str | None = None
    codigo_verificacion: str | None = None
    multa_mora_pct: Decimal | None = None
    indemnizacion_pct: Decimal | None = None
    forma_pago: str | None = None
    observaciones: str | None = None
    dropbox_path: str | None = None


class LpContratoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contrato_id: int
    fondo_codigo: str
    suscriptor_nombre: str
    suscriptor_rut: str
    representante_nombre: str | None
    representante_rut: str | None
    domicilio: str | None
    email: str | None
    tipo_contrato: TipoContrato
    serie: SerieType
    fecha_contrato: date
    notaria: str | None
    codigo_verificacion: str | None
    cantidad_cuotas: Decimal
    valor_por_cuota_uf: Decimal
    uf_comprometidas: Decimal
    monto_clp: Decimal | None
    uf_value_at_signing: Decimal | None
    multa_mora_pct: Decimal | None
    indemnizacion_pct: Decimal | None
    forma_pago: str | None
    estado: EstadoContrato
    fecha_suscripcion: date | None
    fecha_pago: date | None
    voucher_id: int | None
    dropbox_path: str | None
    observaciones: str | None
    created_at: datetime
    updated_at: datetime


class PagarRequest(BaseModel):
    """Body para POST /pagar. Si monto_clp ya está en el contrato, no es necesario.
    Si no, hay que pasarlo aquí (valor real al momento del pago — refleja
    el valor UF efectivo en CLP a la fecha)."""

    fecha_pago: date | None = None  # default = today
    monto_clp: Decimal | None = None
    uf_value_at_pago: Decimal | None = None
    cuenta_banco: str | None = None  # default = CUENTA_BANCO_DEBE
    glosa_extra: str | None = None  # se appendea a la glosa autogen


class PagarResponse(BaseModel):
    contrato_id: int
    voucher_id: int
    voucher_codigo: str
    monto_clp: Decimal
    estado: EstadoContrato


# =====================================================================
# GET /lp-contratos
# =====================================================================


@router.get("", response_model=list[LpContratoRead])
async def list_contratos(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    estado: EstadoContrato | None = Query(default=None),
    serie: SerieType | None = Query(default=None),
    tipo: TipoContrato | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[LpContratoRead]:
    """V5++ ola AP: scope multi-tenant aplicado sobre fondo_codigo."""
    stmt = select(LpContrato).order_by(
        LpContrato.fecha_contrato.desc(), LpContrato.contrato_id.desc()
    )
    # Multi-tenant scope: filter por fondo_codigo en empresas del user
    if not scope.is_global:
        allowed = list(scope.allowed_codes or [])
        if not allowed:
            return []
        stmt = stmt.where(LpContrato.fondo_codigo.in_(allowed))
    if estado:
        stmt = stmt.where(LpContrato.estado == estado)
    if serie:
        stmt = stmt.where(LpContrato.serie == serie)
    if tipo:
        stmt = stmt.where(LpContrato.tipo_contrato == tipo)
    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return [LpContratoRead.model_validate(c) for c in result.scalars().all()]


@router.get("/summary")
async def contratos_summary(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
) -> dict:
    """KPIs del fondo: Σ UF comprometidas, % meta, breakdown por estado/serie.

    Round 5 fix: aplicar scope multi-tenant. Sin esto un user con acceso a
    UN solo fondo veia los KPIs (META_UF, exceso, total comprometido) de
    TODO el portfolio del sistema. Ahora cada query filtra por
    fondo_codigo IN scope.allowed_codes; admin global ve todo.
    """
    # Build base WHERE clause segun scope
    scope_filter = None
    if not scope.is_global:
        allowed = list(scope.allowed_codes or [])
        if not allowed:
            # Sin acceso a ningun fondo → KPIs todos en 0.
            return {
                "meta_uf": float(META_UF_FONDO),
                "total_uf_comprometidas": 0.0,
                "pct_meta": 0.0,
                "exceso_uf": 0.0,
                "by_estado": [],
                "by_serie": [],
            }
        scope_filter = LpContrato.fondo_codigo.in_(allowed)

    by_estado_stmt = (
        select(LpContrato.estado, sql_func.count(), sql_func.sum(LpContrato.uf_comprometidas))
        .group_by(LpContrato.estado)
    )
    if scope_filter is not None:
        by_estado_stmt = by_estado_stmt.where(scope_filter)
    by_estado = (await db.execute(by_estado_stmt)).all()

    by_serie_stmt = (
        select(LpContrato.serie, sql_func.sum(LpContrato.uf_comprometidas))
        .group_by(LpContrato.serie)
    )
    if scope_filter is not None:
        by_serie_stmt = by_serie_stmt.where(scope_filter)
    by_serie = (await db.execute(by_serie_stmt)).all()

    total_stmt = select(sql_func.coalesce(sql_func.sum(LpContrato.uf_comprometidas), 0))
    if scope_filter is not None:
        total_stmt = total_stmt.where(scope_filter)
    total_uf = await db.scalar(total_stmt) or Decimal("0")

    pct_meta = (Decimal(total_uf) / META_UF_FONDO * 100) if META_UF_FONDO else Decimal("0")

    return {
        "meta_uf": float(META_UF_FONDO),
        "total_uf_comprometidas": float(total_uf),
        "pct_meta": float(pct_meta),
        "exceso_uf": float(max(Decimal(total_uf) - META_UF_FONDO, Decimal("0"))),
        "by_estado": [
            {"estado": e, "count": c, "uf": float(uf or 0)} for e, c, uf in by_estado
        ],
        "by_serie": [
            {"serie": s, "uf": float(uf or 0)} for s, uf in by_serie
        ],
    }


@router.get("/{contrato_id}", response_model=LpContratoRead)
async def get_contrato(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    contrato_id: int,
) -> LpContratoRead:
    c = await db.get(LpContrato, contrato_id)
    if c is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Contrato {contrato_id} no encontrado",
        )
    # V5++ ola AP: scope check
    if not scope.can_access(c.fondo_codigo):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Sin acceso a contratos del fondo '{c.fondo_codigo}'",
        )
    return LpContratoRead.model_validate(c)


@router.post(
    "",
    response_model=LpContratoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_contrato(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    body: LpContratoCreate,
) -> LpContratoRead:
    # V5++ ola AP: scope check
    await assert_empresa_access(user, db, body.fondo_codigo)
    c = LpContrato(**body.model_dump(), created_by=str(user.sub))
    db.add(c)
    await db.commit()
    await db.refresh(c)

    await audit_log(
        db, request, user,
        action="create",
        entity_type="lp_contrato",
        entity_id=str(c.contrato_id),
        entity_label=c.suscriptor_nombre,
        summary=f"LP Contrato {c.tipo_contrato} Serie {c.serie}: {c.suscriptor_nombre} ({c.uf_comprometidas} UF)",
        before=None,
        after=LpContratoRead.model_validate(c).model_dump(mode="json"),
    )
    return LpContratoRead.model_validate(c)


@router.patch(
    "/{contrato_id}",
    response_model=LpContratoRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_contrato(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    contrato_id: int,
    body: LpContratoUpdate,
) -> LpContratoRead:
    c = await db.get(LpContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")

    before = LpContratoRead.model_validate(c).model_dump(mode="json")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    c.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(c)

    await audit_log(
        db, request, user,
        action="update",
        entity_type="lp_contrato",
        entity_id=str(c.contrato_id),
        entity_label=c.suscriptor_nombre,
        summary=f"LP Contrato editado: {c.suscriptor_nombre}",
        before=before,
        after=LpContratoRead.model_validate(c).model_dump(mode="json"),
    )
    return LpContratoRead.model_validate(c)


# =====================================================================
# POST /lp-contratos/{id}/pagar  — la magia
# =====================================================================


@router.post(
    "/{contrato_id}/pagar",
    response_model=PagarResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def pagar_contrato(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    contrato_id: int,
    body: PagarRequest,
) -> PagarResponse:
    """Marca el contrato como PAGADO y crea voucher INGRESO automático.

    Flujo:
        1. Validar contrato existe + no está ya pagado
        2. Determinar monto_clp (del body o del contrato)
        3. Generar voucher INGRESO con líneas DEBE/HABER apropiadas
        4. Actualizar contrato: estado=PAGADO, fecha_pago, voucher_id
        5. Auditar
    """
    c = await db.get(LpContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")

    # V5++ ola AP: scope check
    await assert_empresa_access(user, db, c.fondo_codigo)

    if c.estado == "PAGADO" and c.voucher_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Contrato ya está PAGADO con voucher {c.voucher_id}",
        )

    # Resolver monto_clp
    monto_clp = body.monto_clp or c.monto_clp
    if monto_clp is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "monto_clp no está seteado en el contrato ni en el body. "
                "Pasalo en el body junto con uf_value_at_pago."
            ),
        )

    fecha_pago = body.fecha_pago or date.today()
    cuenta_banco = body.cuenta_banco or CUENTA_BANCO_DEBE
    cuenta_capital = (
        CUENTA_CAPITAL_SERIE_A if c.serie == "A" else CUENTA_CAPITAL_SERIE_B
    )

    # Glosa autogenerada
    glosa = (
        f"Aporte LP {c.suscriptor_nombre} — {c.cantidad_cuotas} cuotas × "
        f"{c.valor_por_cuota_uf} UF Serie {c.serie}"
    )
    if body.glosa_extra:
        glosa += f" — {body.glosa_extra}"

    # Generar código voucher
    anio = fecha_pago.year
    codigo = await generate_voucher_code(db, c.fondo_codigo, anio, "INGRESO")

    # Crear voucher
    voucher = Voucher(
        codigo=codigo,
        empresa_codigo=c.fondo_codigo,
        tipo="INGRESO",
        status="DRAFT",  # arranca en DRAFT, el flujo de aprobación normal aplica
        fecha_documento=fecha_pago,
        fecha_contable=fecha_pago,
        fecha_ejecucion=fecha_pago,
        glosa=glosa[:500],
        total_debit=monto_clp,
        total_credit=monto_clp,
        moneda="CLP",
        contraparte_rut=c.suscriptor_rut,
        contraparte_nombre=c.suscriptor_nombre,
        contraparte_tipo="CLIENTE",
        created_by=str(user.sub),
        requested_by=str(user.sub),
    )
    db.add(voucher)
    await db.flush()

    # Líneas DEBE / HABER
    line_debe = VoucherLine(
        voucher_id=voucher.voucher_id,
        line_number=1,
        cuenta_codigo=cuenta_banco,
        debit=monto_clp,
        credit=Decimal("0"),
        descripcion=f"Banco — aporte {c.suscriptor_nombre}",
    )
    line_haber = VoucherLine(
        voucher_id=voucher.voucher_id,
        line_number=2,
        cuenta_codigo=cuenta_capital,
        debit=Decimal("0"),
        credit=monto_clp,
        descripcion=f"Capital pagado Serie {c.serie} — {c.cantidad_cuotas} cuotas",
    )
    db.add_all([line_debe, line_haber])

    # Update contrato
    c.estado = "PAGADO"
    c.fecha_pago = fecha_pago
    c.fecha_suscripcion = c.fecha_suscripcion or fecha_pago
    c.monto_clp = monto_clp
    if body.uf_value_at_pago:
        c.uf_value_at_signing = body.uf_value_at_pago
    c.voucher_id = voucher.voucher_id
    c.updated_at = datetime.utcnow()

    await db.commit()

    await audit_log(
        db, request, user,
        action="pagar",
        entity_type="lp_contrato",
        entity_id=str(c.contrato_id),
        entity_label=c.suscriptor_nombre,
        summary=(
            f"LP Contrato PAGADO: {c.suscriptor_nombre} — "
            f"${monto_clp:,.0f} CLP — voucher {codigo} creado"
        ),
        before=None,
        after={
            "estado": "PAGADO",
            "monto_clp": str(monto_clp),
            "voucher_id": voucher.voucher_id,
            "voucher_codigo": codigo,
        },
    )

    return PagarResponse(
        contrato_id=c.contrato_id,
        voucher_id=voucher.voucher_id,
        voucher_codigo=codigo,
        monto_clp=monto_clp,
        estado="PAGADO",
    )


@router.post(
    "/{contrato_id}/marcar-suscrito",
    response_model=LpContratoRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def marcar_suscrito(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    contrato_id: int,
    fecha_suscripcion: date | None = None,
) -> LpContratoRead:
    """PROMETIDO → SUSCRITO. Para cuando se firma el contrato definitivo
    pero el pago aún no se ejecutó."""
    c = await db.get(LpContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")
    if c.estado not in ("PROMETIDO",):
        raise HTTPException(
            status_code=400,
            detail=f"Estado actual {c.estado} no permite marcar suscrito",
        )
    c.estado = "SUSCRITO"
    c.fecha_suscripcion = fecha_suscripcion or date.today()
    c.tipo_contrato = "DEFINITIVO"  # al suscribir, deja de ser promesa
    await db.commit()
    await db.refresh(c)

    await audit_log(
        db, request, user,
        action="marcar_suscrito",
        entity_type="lp_contrato",
        entity_id=str(c.contrato_id),
        entity_label=c.suscriptor_nombre,
        summary=f"LP Contrato SUSCRITO: {c.suscriptor_nombre}",
        before=None,
        after={"estado": "SUSCRITO", "fecha_suscripcion": str(c.fecha_suscripcion)},
    )
    return LpContratoRead.model_validate(c)


@router.post(
    "/{contrato_id}/resolver",
    response_model=LpContratoRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def resolver_contrato(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    request: Request,
    contrato_id: int,
    razon: str = Query(min_length=10, max_length=500),
) -> LpContratoRead:
    """Anula el contrato (resolución por incumplimiento o mutuo acuerdo).
    No genera voucher de reverso automáticamente — si ya estaba pagado,
    el COO crea un REVERSO manual."""
    c = await db.get(LpContrato, contrato_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Contrato no encontrado")

    before_estado = c.estado
    c.estado = "RESUELTO"
    c.observaciones = (
        f"{c.observaciones or ''}\n[RESUELTO {date.today()}] {razon}"
    ).strip()
    c.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(c)

    await audit_log(
        db, request, user,
        action="resolver",
        entity_type="lp_contrato",
        entity_id=str(c.contrato_id),
        entity_label=c.suscriptor_nombre,
        summary=f"LP Contrato RESUELTO: {c.suscriptor_nombre} — razón: {razon[:80]}",
        before={"estado": before_estado},
        after={"estado": "RESUELTO", "razon": razon},
    )
    return LpContratoRead.model_validate(c)
