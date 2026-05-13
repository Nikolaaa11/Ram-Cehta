"""V5++ ola AM — Vouchers Nubox-style form.

Implementa exactamente el form del Excel "documento para claude boucher":

Header Nubox (13 campos):
    1. ID de Gasto          — auto-generado (bloqueado)
    2. Proveedor            — combo de core.proveedores
    3. Tipo Documento       — FACTURA / BOLETA / NC / ND / HONORARIOS / NA
    4. Número Documento     — int (folio)
    5. Documento            — file upload (se sube a Dropbox)
    6. Razón social receptor — bloqueado, viene de empresa
    7. Comuna receptor      — bloqueado, viene de empresa
    8. Dirección receptor   — bloqueado, viene de empresa
    9. Forma de pago        — combo TRANSFERENCIA / CHEQUE / CONTADO / CRÉDITO 30D...
    10. Fecha documento     — calendar
    11. Fecha vencimiento   — calendar
    12. Aprobador 1         — bloqueado (del approval_rules por empresa)
    13. Aprobador 2         — bloqueado (idem)

Información Contable (N líneas):
    Comentario / Cuenta / Total de línea (DEBE)
    Estas líneas afectan el resultado contable (gasto).

Información Financiera (N líneas):
    Comentario / Cuenta / Total de línea (HABER)
    Estas líneas afectan el flujo financiero (cuenta por pagar / banco).

Σ Contable = Σ Financiera = total del voucher (doble partida cuadrada).

Endpoints:
    GET  /vouchers/form-metadata          — todo lo que el form necesita
    GET  /vouchers/form-metadata/{empresa} — empresa-specific (aprobadores)
    POST /vouchers/nubox-form              — crea voucher desde el form
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.models.voucher import Voucher, VoucherLine
from app.schemas.proveedor import ProveedorCreate
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.voucher_service import generate_voucher_code

router = APIRouter()


FORMA_PAGO_OPCIONES = [
    "TRANSFERENCIA",
    "CHEQUE",
    "CONTADO",
    "EFECTIVO",
    "CREDITO_30D",
    "CREDITO_60D",
    "CREDITO_90D",
    "TARJETA_CREDITO",
    "TARJETA_DEBITO",
    "OTRO",
]

# V5++ ola CH — Catalogo SII expandido (Nicolas, sesion 3 cont.)
# Reemplaza el set chico anterior por los 15 tipos tributarios reales.
# `BOLETA`, `HONORARIOS` y `NA` se mantienen para compatibilidad con
# vouchers ya creados (deserializan OK al leerlos). El form nuevo usa
# solo los del catalogo expandido.
TIPO_DOCUMENTO_OPCIONES = [
    "DECLARACION_INGRESO",
    "FACTURA",
    "FACTURA_COMPRA",
    "FACTURA_COMPRA_ELECTRONICA",
    "FACTURA_INICIO",
    "FACTURA_ELECTRONICA",
    "FACTURA_ELECTRONICA_EXENTA",
    "FACTURA_EXENTA",
    "LIQUIDACION_FACTURA",
    "LIQUIDACION_FACTURA_ELECTRONICA",
    "NOTA_CREDITO",
    "NOTA_CREDITO_ELECTRONICA",
    "NOTA_DEBITO",
    "NOTA_DEBITO_ELECTRONICA",
    "SOLICITUD_REGISTRO_FACTURA",
    # Backward compat (vouchers viejos):
    "BOLETA",
    "HONORARIOS",
    "NA",
]

# Subsets para calculo de Total Bruto = Neto + IVA.
# Documentos AFECTOS a IVA 19% (Total Bruto = Neto x 1.19).
TIPO_DOC_AFECTOS_IVA: frozenset[str] = frozenset(
    {
        "FACTURA",
        "FACTURA_COMPRA",
        "FACTURA_COMPRA_ELECTRONICA",
        "FACTURA_INICIO",
        "FACTURA_ELECTRONICA",
        "LIQUIDACION_FACTURA",
        "LIQUIDACION_FACTURA_ELECTRONICA",
        "NOTA_CREDITO",
        "NOTA_CREDITO_ELECTRONICA",
        "NOTA_DEBITO",
        "NOTA_DEBITO_ELECTRONICA",
    }
)
# Documentos EXENTOS (Total Bruto = Neto, sin IVA).
TIPO_DOC_EXENTOS: frozenset[str] = frozenset(
    {
        "FACTURA_EXENTA",
        "FACTURA_ELECTRONICA_EXENTA",
    }
)
# Otros (DI, SRF) — el bruto se trata como neto por defecto. Para
# Declaracion de Ingreso aplicaria IVA importacion pero se valida caso
# por caso con contabilidad. Por ahora bruto = neto.
TIPO_DOC_OTROS: frozenset[str] = frozenset(
    {
        "DECLARACION_INGRESO",
        "SOLICITUD_REGISTRO_FACTURA",
        # Backward compat (boletas/honorarios viejos no afectan a IVA en
        # el voucher Nubox; el FE muestra Bruto=Neto)
        "BOLETA",
        "HONORARIOS",
        "NA",
    }
)


def tipo_doc_aplica_iva(tipo: str) -> bool:
    """True si el tipo doc tiene IVA 19% al calcular Total Bruto."""
    return tipo in TIPO_DOC_AFECTOS_IVA


# Labels human-readable para FE (titulos UI). Mantenido en backend para
# que un cambio sea idempotente (el FE solo expone, no hardcodea).
TIPO_DOCUMENTO_LABELS: dict[str, str] = {
    "DECLARACION_INGRESO": "Declaración de ingreso",
    "FACTURA": "Factura",
    "FACTURA_COMPRA": "Factura de compra",
    "FACTURA_COMPRA_ELECTRONICA": "Factura de compra electrónica",
    "FACTURA_INICIO": "Factura de inicio",
    "FACTURA_ELECTRONICA": "Factura electrónica",
    "FACTURA_ELECTRONICA_EXENTA": "Factura electrónica exenta",
    "FACTURA_EXENTA": "Factura exenta",
    "LIQUIDACION_FACTURA": "Liquidación factura",
    "LIQUIDACION_FACTURA_ELECTRONICA": "Liquidación factura electrónica",
    "NOTA_CREDITO": "Nota de crédito",
    "NOTA_CREDITO_ELECTRONICA": "Nota de crédito electrónica",
    "NOTA_DEBITO": "Nota de débito",
    "NOTA_DEBITO_ELECTRONICA": "Nota de débito electrónica",
    "SOLICITUD_REGISTRO_FACTURA": "Solicitud registro factura",
    # Backward compat (no se muestra en form nuevo, solo lectura).
    "BOLETA": "Boleta",
    "HONORARIOS": "Boleta honorarios",
    "NA": "No aplica",
}


# =====================================================================
# Schemas
# =====================================================================


class NuboxFormLine(BaseModel):
    """Una línea del form: Comentario + Cuenta + Total."""

    comentario: str = Field(min_length=1, max_length=500)
    cuenta_codigo: str = Field(min_length=1, max_length=20)
    total: Decimal = Field(gt=0, description="Monto > 0")
    proyecto_codigo: str | None = None
    area_codigo: str | None = None


class NuboxFormCreate(BaseModel):
    """Body del form Nubox-style."""

    # Header obligatorio
    empresa_codigo: str = Field(min_length=2, max_length=20)
    proveedor_rut: str = Field(min_length=8, max_length=20)
    proveedor_nombre: str = Field(min_length=1, max_length=200)
    # V5++ ola CE — Origen para tracking (ver migration 0055). Default nubox_form.
    source: str | None = Field(default=None, max_length=40)
    # V5++ ola CH: catalogo expandido (15 tipos SII + 3 backward-compat).
    # Si llega un tipo nuevo del FE este Literal lo acepta; los antiguos
    # (BOLETA, HONORARIOS, NA) siguen aceptados para vouchers heredados.
    tipo_documento: Literal[
        "DECLARACION_INGRESO",
        "FACTURA",
        "FACTURA_COMPRA",
        "FACTURA_COMPRA_ELECTRONICA",
        "FACTURA_INICIO",
        "FACTURA_ELECTRONICA",
        "FACTURA_ELECTRONICA_EXENTA",
        "FACTURA_EXENTA",
        "LIQUIDACION_FACTURA",
        "LIQUIDACION_FACTURA_ELECTRONICA",
        "NOTA_CREDITO",
        "NOTA_CREDITO_ELECTRONICA",
        "NOTA_DEBITO",
        "NOTA_DEBITO_ELECTRONICA",
        "SOLICITUD_REGISTRO_FACTURA",
        "BOLETA",
        "HONORARIOS",
        "NA",
    ]
    numero_documento: str = Field(min_length=1, max_length=50)
    forma_pago: Literal[
        "TRANSFERENCIA", "CHEQUE", "CONTADO", "EFECTIVO",
        "CREDITO_30D", "CREDITO_60D", "CREDITO_90D",
        "TARJETA_CREDITO", "TARJETA_DEBITO", "OTRO",
    ]
    fecha_documento: date
    fecha_vencimiento: date | None = None
    documento_dropbox_path: str | None = None

    # Header opcional (se pueden omitir, default empty)
    glosa: str | None = None

    # Las 2 listas de líneas
    informacion_contable: list[NuboxFormLine] = Field(min_length=1)
    informacion_financiera: list[NuboxFormLine] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_partida_doble(self) -> "NuboxFormCreate":
        """Σ Contable debe ser igual a Σ Financiera (partida doble)."""
        total_contable = sum(l.total for l in self.informacion_contable)
        total_financiera = sum(l.total for l in self.informacion_financiera)
        if total_contable != total_financiera:
            raise ValueError(
                f"Partida doble descuadrada: Información Contable suma "
                f"${total_contable:,} pero Información Financiera suma "
                f"${total_financiera:,}. La diferencia es ${total_contable - total_financiera:,}."
            )
        return self

    @model_validator(mode="after")
    def _validate_vencimiento(self) -> "NuboxFormCreate":
        if (
            self.fecha_vencimiento is not None
            and self.fecha_vencimiento < self.fecha_documento
        ):
            raise ValueError(
                "fecha_vencimiento no puede ser anterior a fecha_documento"
            )
        return self


class NuboxFormResponse(BaseModel):
    voucher_id: int
    codigo: str
    status: str
    empresa_codigo: str
    total_contable: Decimal
    total_financiera: Decimal
    lines_count: int
    proxima_accion: str
    proveedor_id: int
    proveedor_creado_automatico: bool
    proveedor_rut_canonical: str


class EmpresaMetadata(BaseModel):
    codigo: str
    razon_social: str
    rut: str
    direccion: str | None = None
    comuna: str | None = None
    aprobadores: list[dict]  # [{role: 'GG', emails: [...]}, ...]


class FormMetadataResponse(BaseModel):
    formas_pago: list[str]
    tipos_documento: list[str]
    # V5++ ola CH — label + clasificacion IVA por tipo doc, para que el FE
    # muestre nombre humano y calcule Total Bruto sin hardcodear logica.
    tipo_documento_labels: dict[str, str] = {}
    # Subset de tipos que aplican IVA 19% (Total Bruto = Neto * 1.19).
    tipos_documento_afectos_iva: list[str] = []
    cuentas_contables_sample: list[dict]  # primeras N cuentas imputables
    empresas: list[EmpresaMetadata]


class DuplicateVoucherHit(BaseModel):
    voucher_id: int
    codigo: str
    status: str
    fecha_documento: str | None
    total: str | None
    glosa: str | None


class CheckDuplicateResponse(BaseModel):
    """Respuesta de /vouchers/check-duplicate.

    Detecta vouchers existentes con la misma combinacion (empresa,
    proveedor_rut, tipo_documento, numero_documento) — la firma natural
    de un documento tributario. Si hay match, devuelve los duplicados
    para que el FE muestre warning antes del submit.
    """

    duplicates: list[DuplicateVoucherHit]
    rut_canonical: str | None = None


# =====================================================================
# GET /vouchers/form-metadata
# =====================================================================


@router.get("/form-metadata", response_model=FormMetadataResponse)
async def get_form_metadata(
    user: CurrentUser, db: DBSession, scope: EmpresaScopeDep,
) -> FormMetadataResponse:
    """Devuelve TODO lo que el form Nubox necesita para llenar selectores:

    - Listas estáticas (formas_pago, tipos_documento)
    - Muestra de cuentas contables imputables (primeras 200)
    - Empresas con su razón social/RUT/comuna/dirección + aprobadores
      (matching de approval_rules + user_company_roles)

    V5++ ola CH fase 3: las empresas se filtran por el scope del user.
    Antes este endpoint devolvia las 9 empresas a todos los users, y al
    intentar guardar el POST devolvia 403 — el dropdown del FE permitia
    elegir empresas que el user no podia usar. Ahora el dropdown solo
    muestra las que el user puede operar.

    El frontend cachea este endpoint con stale-while-revalidate 5min.
    """
    # Cuentas imputables (sample para autocompletado inicial)
    cuentas_rows = (await db.execute(
        text(
            """
            SELECT codigo, nombre, nivel, activa, imputable
            FROM core.plan_cuentas
            WHERE imputable = TRUE AND activa = TRUE
            ORDER BY codigo
            LIMIT 200
            """
        )
    )).mappings().all()

    # Empresas con datos del receptor. core.empresas usa 'ciudad' como
    # equivalente a "comuna" en el Excel.
    # V5++ ola CH fase 3 — scope filter.
    empresa_scope = scope.filter_codes(None)
    if empresa_scope is None:
        # Admin global ve todas las empresas activas.
        empresas_rows = (await db.execute(
            text(
                """
                SELECT codigo, razon_social, COALESCE(rut, '') as rut,
                       COALESCE(direccion, '') as direccion,
                       COALESCE(ciudad, '') as comuna
                FROM core.empresas
                WHERE activo = TRUE
                ORDER BY codigo
                """
            )
        )).mappings().all()
    elif not empresa_scope:
        # User sin empresas asignadas → lista vacia (no hay donde ingresar)
        empresas_rows = []
    else:
        empresas_rows = (await db.execute(
            text(
                """
                SELECT codigo, razon_social, COALESCE(rut, '') as rut,
                       COALESCE(direccion, '') as direccion,
                       COALESCE(ciudad, '') as comuna
                FROM core.empresas
                WHERE activo = TRUE
                  AND codigo = ANY(CAST(:scope AS text[]))
                ORDER BY codigo
                """
            ),
            {"scope": empresa_scope},
        )).mappings().all()

    empresas_list = []
    for er in empresas_rows:
        # Aprobadores: roles en user_company_roles + matching de approval_rules
        approvers_by_role = (await db.execute(
            text(
                """
                SELECT ucr.role,
                       ARRAY_AGG(au.email ORDER BY au.email) as emails
                FROM core.user_company_roles ucr
                LEFT JOIN auth.users au ON au.id::TEXT = ucr.user_id::TEXT
                WHERE ucr.empresa_codigo = :empresa
                  AND ucr.active = TRUE
                GROUP BY ucr.role
                """
            ),
            {"empresa": er["codigo"]},
        )).mappings().all()

        aprobadores = [
            {"role": a["role"], "emails": a["emails"] or []}
            for a in approvers_by_role
        ]

        empresas_list.append(
            EmpresaMetadata(
                codigo=er["codigo"],
                razon_social=er["razon_social"],
                rut=er["rut"],
                direccion=er.get("direccion") or "",
                comuna=er.get("comuna") or "",
                aprobadores=aprobadores,
            )
        )

    return FormMetadataResponse(
        formas_pago=FORMA_PAGO_OPCIONES,
        tipos_documento=TIPO_DOCUMENTO_OPCIONES,
        tipo_documento_labels=TIPO_DOCUMENTO_LABELS,
        tipos_documento_afectos_iva=sorted(TIPO_DOC_AFECTOS_IVA),
        cuentas_contables_sample=[dict(c) for c in cuentas_rows],
        empresas=empresas_list,
    )


# =====================================================================
# GET /vouchers/check-duplicate
# =====================================================================


@router.get("/check-duplicate", response_model=CheckDuplicateResponse)
async def check_duplicate_voucher(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, "Empresa receptora"],
    proveedor_rut: Annotated[str, "RUT en cualquier formato"],
    numero_documento: Annotated[str, "Folio del documento"],
    tipo_documento: Annotated[
        Literal[
            "DECLARACION_INGRESO",
            "FACTURA",
            "FACTURA_COMPRA",
            "FACTURA_COMPRA_ELECTRONICA",
            "FACTURA_INICIO",
            "FACTURA_ELECTRONICA",
            "FACTURA_ELECTRONICA_EXENTA",
            "FACTURA_EXENTA",
            "LIQUIDACION_FACTURA",
            "LIQUIDACION_FACTURA_ELECTRONICA",
            "NOTA_CREDITO",
            "NOTA_CREDITO_ELECTRONICA",
            "NOTA_DEBITO",
            "NOTA_DEBITO_ELECTRONICA",
            "SOLICITUD_REGISTRO_FACTURA",
            "BOLETA",
            "HONORARIOS",
            "NA",
        ],
        "Tipo documento",
    ] = "FACTURA",
) -> CheckDuplicateResponse:
    """Busca vouchers ya creados con la misma firma (empresa+RUT+folio+tipo).

    Pensado para que el FE Nubox llame ANTES del submit cuando ya tiene
    proveedor + folio + tipo + empresa, y muestre un warning si el voucher
    parece duplicado. No bloquea — solo avisa. El submit final puede ignorar
    el warning (a veces el mismo folio se reusa legitimamente, ej. notas
    de credito que referencian la factura).

    Devuelve hasta 5 hits para no spamear la UI.
    """
    from app.services.empresa_scope_service import assert_empresa_access

    await assert_empresa_access(user, db, empresa_codigo)

    rut_canonical: str | None = None
    rut_search = proveedor_rut.strip()
    if validate_rut(rut_search):
        rut_canonical = format_rut(rut_search)
        rut_search = rut_canonical

    rows = (
        await db.execute(
            text(
                """
                SELECT voucher_id, codigo, status, fecha_documento::text,
                       total_debit::text AS total, glosa
                FROM core.vouchers
                WHERE empresa_codigo = :emp
                  AND contraparte_rut = :rut
                  AND doc_tributario_folio = :folio
                  AND doc_tributario_tipo = :tipo
                  AND status NOT IN ('VOIDED', 'CANCELLED')
                ORDER BY voucher_id DESC
                LIMIT 5
                """
            ),
            {
                "emp": empresa_codigo,
                "rut": rut_search,
                "folio": numero_documento,
                "tipo": tipo_documento,
            },
        )
    ).mappings().all()

    return CheckDuplicateResponse(
        duplicates=[
            DuplicateVoucherHit(
                voucher_id=int(r["voucher_id"]),
                codigo=str(r["codigo"]),
                status=str(r["status"]),
                fecha_documento=r["fecha_documento"],
                total=r["total"],
                glosa=r["glosa"],
            )
            for r in rows
        ],
        rut_canonical=rut_canonical,
    )


# =====================================================================
# POST /vouchers/nubox-form
# =====================================================================


@router.post(
    "/nubox-form",
    response_model=NuboxFormResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_voucher_nubox_form(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: NuboxFormCreate,
) -> NuboxFormResponse:
    """Crea un voucher desde el form Nubox-style del Excel.

    Mapeo:
      empresa_codigo         -> voucher.empresa_codigo
      proveedor_rut+nombre   -> voucher.contraparte_rut + contraparte_nombre
      tipo_documento         -> voucher.doc_tributario_tipo
      numero_documento       -> voucher.doc_tributario_folio
      forma_pago             -> voucher.forma_pago (nuevo en 0052)
      fecha_documento        -> voucher.fecha_documento
      fecha_vencimiento      -> voucher.fecha_vencimiento (nuevo)
      documento_dropbox_path -> voucher.documento_dropbox_path (nuevo)
      informacion_contable[] -> voucher_lines con DEBE + tipo_imputacion=CONTABLE
      informacion_financiera[] -> voucher_lines con HABER + tipo_imputacion=FINANCIERA

    Tipo de voucher = COMPRA (porque viene de factura proveedor).
    Glosa autogenerada si no se pasa: "Compra a {proveedor} folio {n}"

    Status inicial: DRAFT (lo aprueban Líder + Director después).
    """
    # 1. Scope check
    await assert_empresa_access(user, db, body.empresa_codigo)

    # 2. Empresa existe + activa
    empresa_ok = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"),
        {"c": body.empresa_codigo},
    )
    if not empresa_ok:
        raise HTTPException(
            status_code=400,
            detail=f"Empresa '{body.empresa_codigo}' no existe o está inactiva",
        )

    # 2.5 Validar RUT proveedor (modulo 11) y auto-crear en catalogo si no existe.
    # Esto evita que el catalogo core.proveedores quede desactualizado cuando
    # operativamente se tipea un proveedor nuevo en el form. La proxima vez que
    # se use el mismo RUT, search-by-rut lo va a encontrar y precargar.
    if not validate_rut(body.proveedor_rut):
        raise HTTPException(
            status_code=400,
            detail=(
                f"RUT proveedor '{body.proveedor_rut}' inválido "
                "(dígito verificador incorrecto). Revisá el dato antes de continuar."
            ),
        )
    proveedor_rut_canonical = format_rut(body.proveedor_rut)
    prov_repo = ProveedorRepository(db)
    proveedor = await prov_repo.get_by_rut(proveedor_rut_canonical)
    proveedor_creado_automatico = False
    if proveedor is None:
        proveedor = await prov_repo.create(
            ProveedorCreate(
                rut=proveedor_rut_canonical,
                razon_social=body.proveedor_nombre.strip(),
            )
        )
        proveedor_creado_automatico = True

    # 3. Validar cuentas (todas imputables)
    todas_cuentas = (
        [l.cuenta_codigo for l in body.informacion_contable]
        + [l.cuenta_codigo for l in body.informacion_financiera]
    )
    cuentas_check = (await db.execute(
        text(
            """
            SELECT codigo, imputable, activa
            FROM core.plan_cuentas
            WHERE codigo = ANY(:codes)
            """
        ),
        {"codes": list(set(todas_cuentas))},
    )).mappings().all()
    cuentas_map = {c["codigo"]: c for c in cuentas_check}

    for codigo in todas_cuentas:
        c = cuentas_map.get(codigo)
        if not c:
            raise HTTPException(400, detail=f"Cuenta '{codigo}' no existe")
        if not c["imputable"]:
            raise HTTPException(
                400, detail=f"Cuenta '{codigo}' no es imputable (solo nivel 4)"
            )
        if not c["activa"]:
            raise HTTPException(400, detail=f"Cuenta '{codigo}' está inactiva")

    # 4. Total y glosa
    total_contable = sum(l.total for l in body.informacion_contable)
    total_financiera = sum(l.total for l in body.informacion_financiera)
    # Ya validado en Pydantic que son iguales

    glosa = body.glosa or (
        f"Compra a {body.proveedor_nombre} — "
        f"{body.tipo_documento} folio {body.numero_documento}"
    )

    # 5. Generar código
    codigo = await generate_voucher_code(
        db, body.empresa_codigo, body.fecha_documento.year, "COMPRA"
    )

    # 6. Crear voucher
    voucher = Voucher(
        codigo=codigo,
        empresa_codigo=body.empresa_codigo,
        tipo="COMPRA",
        status="DRAFT",
        fecha_documento=body.fecha_documento,
        fecha_contable=body.fecha_documento,
        glosa=glosa[:500],
        total_debit=total_contable,
        total_credit=total_financiera,
        moneda="CLP",
        contraparte_rut=proveedor_rut_canonical,
        contraparte_nombre=body.proveedor_nombre.strip(),
        contraparte_tipo="PROVEEDOR",
        doc_tributario_tipo=body.tipo_documento,
        doc_tributario_folio=body.numero_documento,
        forma_pago=body.forma_pago,
        fecha_vencimiento=body.fecha_vencimiento,
        documento_dropbox_path=body.documento_dropbox_path,
        source=body.source or "nubox_form",
        created_by=str(user.sub),
        requested_by=str(user.sub),
    )
    db.add(voucher)
    await db.flush()

    # 7. Líneas — Contables (DEBE)
    line_num = 1
    for line in body.informacion_contable:
        vl = VoucherLine(
            voucher_id=voucher.voucher_id,
            line_number=line_num,
            cuenta_codigo=line.cuenta_codigo,
            proyecto_codigo=line.proyecto_codigo,
            area_codigo=line.area_codigo,
            debit=line.total,
            credit=Decimal("0"),
            descripcion=line.comentario,
            tipo_imputacion="CONTABLE",
        )
        db.add(vl)
        line_num += 1

    # 8. Líneas — Financieras (HABER)
    for line in body.informacion_financiera:
        vl = VoucherLine(
            voucher_id=voucher.voucher_id,
            line_number=line_num,
            cuenta_codigo=line.cuenta_codigo,
            proyecto_codigo=line.proyecto_codigo,
            area_codigo=line.area_codigo,
            debit=Decimal("0"),
            credit=line.total,
            descripcion=line.comentario,
            tipo_imputacion="FINANCIERA",
        )
        db.add(vl)
        line_num += 1

    await db.commit()

    # 9. Audit log
    try:
        await audit_log(
            db, None, user,
            action="create_nubox_form",
            entity_type="voucher",
            entity_id=str(voucher.voucher_id),
            entity_label=codigo,
            summary=(
                f"Voucher COMPRA Nubox-form creado: {body.proveedor_nombre} — "
                f"{body.tipo_documento} folio {body.numero_documento} — "
                f"${total_contable:,.0f} CLP"
            ),
            before=None,
            after={
                "codigo": codigo,
                "forma_pago": body.forma_pago,
                "tipo_documento": body.tipo_documento,
                "total": str(total_contable),
                "lineas_contables": len(body.informacion_contable),
                "lineas_financieras": len(body.informacion_financiera),
            },
        )
    except Exception:
        pass  # audit es best-effort

    # V5++ ola CE — Webhook voucher.imported para vouchers que vienen del
    # flujo de IA. Best-effort (no rompe la creacion si el dispatcher falla).
    if (body.source or "").lower() == "ai_import":
        try:
            from app.services.webhook_dispatcher import publish_event

            await publish_event(
                db,
                "voucher.imported",
                {
                    "voucher_id": voucher.voucher_id,
                    "codigo": codigo,
                    "empresa_codigo": body.empresa_codigo,
                    "proveedor_rut": proveedor_rut_canonical,
                    "proveedor_nombre": body.proveedor_nombre.strip(),
                    "tipo_documento": body.tipo_documento,
                    "numero_documento": body.numero_documento,
                    "total": str(total_contable),
                    "source": "ai_import",
                    "created_by": str(user.sub),
                },
            )
        except Exception:
            pass

    return NuboxFormResponse(
        voucher_id=voucher.voucher_id,
        codigo=codigo,
        status="DRAFT",
        empresa_codigo=body.empresa_codigo,
        total_contable=total_contable,
        total_financiera=total_financiera,
        lines_count=line_num - 1,
        proxima_accion=(
            "El voucher está en DRAFT. Click 'Enviar a aprobación' para "
            "que pase a PENDING y los aprobadores firmen."
        ),
        proveedor_id=proveedor.proveedor_id,
        proveedor_creado_automatico=proveedor_creado_automatico,
        proveedor_rut_canonical=proveedor_rut_canonical,
    )
