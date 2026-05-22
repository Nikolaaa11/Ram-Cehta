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

from fastapi import APIRouter, Depends, HTTPException, Request, status
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
from app.services.voucher_service import (
    fetch_proyecto_metadata,
    generate_voucher_code,
    is_area_aplica_a_empresa,
    is_cuenta_habilitada_para_empresa,
    is_period_locked_for,
    validate_corfo_eligibility,
)

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
    # Round 80 — comercio exterior. INVOICE es la factura del proveedor
    # extranjero; necesita DIN + FACTURA_IMPORTACION como adjuntos para
    # ser tributariamente valido en Chile.
    "INVOICE",
    "FACTURA_IMPORTACION",
    "FACTURA_EXPORTACION",
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
        # Round 80 — INVOICE no genera IVA chileno (es factura extranjera).
        # El IVA importacion va via la Factura de Importacion adjunta (DTE 914),
        # que el operador registra como voucher aparte o como adjunto.
        # FACTURA_IMPORTACION y FACTURA_EXPORTACION tampoco aplican IVA 19%
        # standard — la primera tributa IVA importacion ya pagado en aduana,
        # la segunda es exenta por exportacion.
        "INVOICE",
        "FACTURA_IMPORTACION",
        "FACTURA_EXPORTACION",
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
# Observaciones 13/05/2026 — labels en UPPERCASE matchean convención SII/Nubox
# y el documento de observaciones del usuario. Los 15 tipos son la lista oficial
# del catálogo SII para vouchers de compra/venta.
TIPO_DOCUMENTO_LABELS: dict[str, str] = {
    "DECLARACION_INGRESO": "DECLARACION DE INGRESO",
    "FACTURA": "FACTURA",
    "FACTURA_COMPRA": "FACTURA DE COMPRA",
    "FACTURA_COMPRA_ELECTRONICA": "FACTURA DE COMPRA ELECTRONICA",
    "FACTURA_INICIO": "FACTURA DE INICIO",
    "FACTURA_ELECTRONICA": "FACTURA ELECTRONICA",
    "FACTURA_ELECTRONICA_EXENTA": "FACTURA ELECTRONICA EXENTA",
    "FACTURA_EXENTA": "FACTURA EXENTA",
    "LIQUIDACION_FACTURA": "LIQUIDACION FACTURA",
    "LIQUIDACION_FACTURA_ELECTRONICA": "LIQUIDACION FACTURA ELECTRONICA",
    "NOTA_CREDITO": "NOTA DE CREDITO",
    "NOTA_CREDITO_ELECTRONICA": "NOTA DE CREDITO ELECTRONICA",
    "NOTA_DEBITO": "NOTA DE DEBITO",
    "NOTA_DEBITO_ELECTRONICA": "NOTA DE DEBITO ELECTRONICA",
    "SOLICITUD_REGISTRO_FACTURA": "SOLICITUD REGISTRO FACTURA",
    # Round 80 — comercio exterior (importacion / exportacion).
    "INVOICE": "INVOICE (Factura proveedor extranjero)",
    "FACTURA_IMPORTACION": "FACTURA DE IMPORTACION (DTE 914)",
    "FACTURA_EXPORTACION": "FACTURA DE EXPORTACION (DTE 110)",
    # Backward compat (no se muestra en form nuevo, solo lectura).
    "BOLETA": "BOLETA",
    "HONORARIOS": "BOLETA HONORARIOS",
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
    # Round 85 — Bloque E: fuente de financiamiento por línea
    # (CORFO_SUBSIDIO / PTEC_CEHTA / EMPRESA_DIRECTA / IVA_CORPORATIVO / NA).
    # Default NA para back-compat con forms viejos.
    fuente_financiamiento: Literal[
        "CORFO_SUBSIDIO", "PTEC_CEHTA", "EMPRESA_DIRECTA",
        "IVA_CORPORATIVO", "NA",
    ] = "NA"


class NuboxFormCreate(BaseModel):
    """Body del form Nubox-style."""

    # Header obligatorio
    empresa_codigo: str = Field(min_length=2, max_length=20)
    # Round 31 — proveedor OPCIONAL. Se permite crear voucher sin
    # contraparte (gastos genéricos, caja chica, servicios sin RUT, etc.).
    # Si llega vacío/None, no se valida RUT, no se busca/crea proveedor en
    # catálogo, y el voucher queda con contraparte_* en NULL.
    proveedor_rut: str | None = Field(default=None, max_length=20)
    proveedor_nombre: str | None = Field(default=None, max_length=200)
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
        # Round 80 — comercio exterior
        "INVOICE",
        "FACTURA_IMPORTACION",
        "FACTURA_EXPORTACION",
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
    # Round 129 (Observaciones 20/05/2026): el form CORFO ahora envía
    # fecha_pago. Semánticamente mapea a voucher.fecha_ejecucion (fecha
    # en que se planea / se efectúa el pago). Si viene null, queda null
    # y el operador la actualiza al ejecutar la transferencia.
    fecha_pago: date | None = None
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
        if abs(total_contable - total_financiera) >= Decimal("0.01"):
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

    @model_validator(mode="after")
    def _validate_doc_tributario_no_NA(self) -> "NuboxFormCreate":
        """Round 141 — tipo_documento='NA' es ambiguo en un form Nubox que
        siempre crea vouchers tipo COMPRA. Si el operador no tiene un
        documento tributario real (boleta de proveedor sin folio, comprobante
        de caja chica), debería usar el form genérico /vouchers/nuevo con
        tipo EGRESO en vez de hacer pasar el gasto como una COMPRA sin doc.
        Invariante #14 del MAESTRO: COMPRA/VENTA exigen doc_tributario válido.
        """
        if self.tipo_documento == "NA":
            raise ValueError(
                "tipo_documento='NA' no es válido en el form Nubox (siempre "
                "crea vouchers tipo COMPRA y la regla #14 del MAESTRO exige "
                "documento tributario válido). Usá /vouchers/nuevo con tipo "
                "EGRESO si no hay documento."
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
    # Round 31 — los 3 campos de proveedor pasan a opcionales. Cuando se
    # crea un voucher sin contraparte, los 3 devuelven None.
    proveedor_id: int | None = None
    proveedor_creado_automatico: bool = False
    proveedor_rut_canonical: str | None = None


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
    # Subset de tipos que aplican IVA 19% (Total Bruto = Neto * (1 + iva_porcentaje)).
    tipos_documento_afectos_iva: list[str] = []
    # AJUSTE 6/12 spec: NO hardcodear 1.19 en el FE — el factor IVA es
    # un parametro del sistema. Si SII cambia la tasa, se actualiza acá.
    iva_porcentaje: float = 0.19
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

    # QA fix 14/05/2026 — antes hacia 1 SELECT de approvers por empresa
    # (N queries = N round-trips). Ahora 1 query batched con
    # WHERE empresa_codigo = ANY(:codigos) GROUP BY (empresa, role).
    codigos = [er["codigo"] for er in empresas_rows]
    approvers_rows = []
    if codigos:
        approvers_rows = (
            await db.execute(
                text(
                    """
                    SELECT ucr.empresa_codigo, ucr.role,
                           ARRAY_AGG(au.email ORDER BY au.email) AS emails
                    FROM core.user_company_roles ucr
                    LEFT JOIN auth.users au ON au.id::TEXT = ucr.user_id::TEXT
                    WHERE ucr.empresa_codigo = ANY(CAST(:codigos AS text[]))
                      AND ucr.active = TRUE
                    GROUP BY ucr.empresa_codigo, ucr.role
                    ORDER BY ucr.empresa_codigo, ucr.role
                    """
                ),
                {"codigos": codigos},
            )
        ).mappings().all()
    approvers_by_empresa: dict[str, list[dict]] = {}
    for r in approvers_rows:
        approvers_by_empresa.setdefault(r["empresa_codigo"], []).append(
            {"role": r["role"], "emails": r["emails"] or []}
        )

    empresas_list = []
    for er in empresas_rows:
        aprobadores = approvers_by_empresa.get(er["codigo"], [])
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
    request: Request,
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
    #
    # Round 31 — el proveedor es OPCIONAL. Si llega vacío/None, saltamos
    # toda la validación/creación de proveedor y el voucher queda sin
    # contraparte. Útil para gastos genéricos, caja chica, etc.
    proveedor_rut_input = (body.proveedor_rut or "").strip()
    proveedor_nombre_input = (body.proveedor_nombre or "").strip()
    proveedor_rut_canonical: str | None = None
    proveedor = None
    proveedor_creado_automatico = False

    if proveedor_rut_input:
        # Si vino RUT, validar + canonicalizar.
        if not validate_rut(proveedor_rut_input):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"RUT proveedor '{proveedor_rut_input}' inválido "
                    "(dígito verificador incorrecto). Revisá el dato antes de continuar."
                ),
            )
        proveedor_rut_canonical = format_rut(proveedor_rut_input)
        prov_repo = ProveedorRepository(db)
        proveedor = await prov_repo.get_by_rut(proveedor_rut_canonical)
        if proveedor is None:
            # Crear en catálogo. Si no llegó nombre, usamos el RUT como
            # fallback de razon_social (ProveedorCreate.razon_social tiene
            # min_length=1, no acepta vacío).
            proveedor = await prov_repo.create(
                ProveedorCreate(
                    rut=proveedor_rut_canonical,
                    razon_social=proveedor_nombre_input or proveedor_rut_canonical,
                )
            )
            proveedor_creado_automatico = True

    # 3. Validar cuentas (todas imputables) + traer flags CORFO para
    # validación de elegibilidad en linea-proyecto (R138).
    todas_cuentas = (
        [l.cuenta_codigo for l in body.informacion_contable]
        + [l.cuenta_codigo for l in body.informacion_financiera]
    )
    cuentas_check = (await db.execute(
        text(
            """
            SELECT codigo, imputable, activa,
                   corfo_elegible, tipo_gasto_corfo
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

    # 3.1 Validar habilitación cuenta-empresa (matriz plan_cuenta_empresa)
    for codigo in set(todas_cuentas):
        if not await is_cuenta_habilitada_para_empresa(
            db, codigo, body.empresa_codigo
        ):
            raise HTTPException(
                400,
                detail=(
                    f"Cuenta '{codigo}' no está habilitada para empresa "
                    f"{body.empresa_codigo}"
                ),
            )

    # 3.2 Validar período contable cerrado
    if await is_period_locked_for(db, body.empresa_codigo, body.fecha_documento):
        raise HTTPException(
            400,
            detail=(
                f"Fecha documento {body.fecha_documento} está en período cerrado "
                f"para empresa {body.empresa_codigo}."
            ),
        )

    # 3.3 Round 138 — Paridad con POST /vouchers: validar
    #     proyecto-empresa, CORFO eligibility y área-empresa por cada línea.
    # Antes el form nubox saltaba estos checks → un user podía imputar gasto
    # a un proyecto de otra empresa, marcar fuente CORFO en cuenta no
    # elegible, o usar un área que no aplica. Riesgo serio para rendiciones
    # CORFO (gastos no elegibles imputados al pozo).
    all_lines_with_section: list[tuple[str, int, object]] = [
        ("contable", idx + 1, line)
        for idx, line in enumerate(body.informacion_contable)
    ] + [
        ("financiera", idx + 1, line)
        for idx, line in enumerate(body.informacion_financiera)
    ]
    for section, idx, line in all_lines_with_section:
        cuenta_info = cuentas_map.get(line.cuenta_codigo)
        if cuenta_info is None:
            # No deberia llegar acá (ya validado arriba) pero defensivo.
            continue

        if line.proyecto_codigo:
            proy = await fetch_proyecto_metadata(db, line.proyecto_codigo)
            if proy is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Línea {section} #{idx}: proyecto "
                        f"'{line.proyecto_codigo}' no existe"
                    ),
                )
            if proy["empresa_codigo"] != body.empresa_codigo:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Línea {section} #{idx}: proyecto "
                        f"'{line.proyecto_codigo}' pertenece a "
                        f"{proy['empresa_codigo']}, no a {body.empresa_codigo}"
                    ),
                )
            # CORFO eligibility — protege rendiciones del fondo CORFO
            corfo_err = validate_corfo_eligibility(
                cuenta_corfo_elegible=cuenta_info["corfo_elegible"],
                cuenta_tipo_gasto_corfo=cuenta_info["tipo_gasto_corfo"],
                proyecto_es_corfo=(proy["tipo_financiamiento"] == "CORFO"),
                proyecto_eligible_types=list(
                    proy["tipos_gasto_elegibles"] or []
                ),
            )
            if corfo_err:
                raise HTTPException(
                    status_code=400,
                    detail=f"Línea {section} #{idx}: {corfo_err}",
                )

        if line.area_codigo and not await is_area_aplica_a_empresa(
            db, line.area_codigo, body.empresa_codigo
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Línea {section} #{idx}: área '{line.area_codigo}' "
                    f"no aplica a empresa '{body.empresa_codigo}'"
                ),
            )

    # 4. Total y glosa
    total_contable = sum(l.total for l in body.informacion_contable)
    total_financiera = sum(l.total for l in body.informacion_financiera)
    # Ya validado en Pydantic que son iguales

    # DB check constraint vouchers_glosa_check exige length(glosa) >= 5.
    # Si user manda glosa < 5 chars (o vacia), usamos la auto-generada que
    # siempre es mas larga. Evita 500 IntegrityError opaco al usuario.
    #
    # Round 31 — la glosa auto-generada se adapta si no hay proveedor:
    #   con proveedor:  "Compra a {nombre} — {tipo_doc} folio {folio}"
    #   sin proveedor:  "Compra — {tipo_doc} folio {folio}"
    glosa_input = (body.glosa or "").strip()
    if len(glosa_input) < 5:
        prov_label = (
            f" a {proveedor_nombre_input}" if proveedor_nombre_input else ""
        )
        glosa = (
            f"Compra{prov_label} — "
            f"{body.tipo_documento} folio {body.numero_documento}"
        )
    else:
        glosa = glosa_input

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
        # Round 31 — contraparte_* es None cuando no se ingresó proveedor.
        # contraparte_tipo se mantiene "PROVEEDOR" si hay datos parciales
        # (al menos RUT o nombre), o None si totalmente vacío.
        contraparte_rut=proveedor_rut_canonical,
        contraparte_nombre=(proveedor_nombre_input or None),
        contraparte_tipo=(
            "PROVEEDOR"
            if (proveedor_rut_canonical or proveedor_nombre_input)
            else None
        ),
        doc_tributario_tipo=body.tipo_documento,
        doc_tributario_folio=body.numero_documento,
        forma_pago=body.forma_pago,
        fecha_vencimiento=body.fecha_vencimiento,
        # Round 129 — fecha_pago del form → fecha_ejecucion del voucher
        # (fecha planeada / efectiva del pago). Si está null queda null.
        fecha_ejecucion=body.fecha_pago,
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
            fuente_financiamiento=line.fuente_financiamiento,
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
            fuente_financiamiento=line.fuente_financiamiento,
        )
        db.add(vl)
        line_num += 1

    # Capturar IDs ANTES del commit (que en async puede expirar la instancia
    # despite expire_on_commit=False cuando operaciones subsiguientes ejecutan
    # raw SQL en la misma session). Acceder a voucher.voucher_id después
    # del commit triggea lazy-load → pool.connect() → 500.
    voucher_id_local = voucher.voucher_id
    # Round 31 — proveedor puede ser None (proveedor opcional).
    proveedor_id_local: int | None = (
        proveedor.proveedor_id if proveedor is not None else None
    )

    await db.commit()

    # 9. Audit log — Round 138 fix: pasar Request para que el audit log
    # capture IP del cliente (antes `None` → IP no quedaba registrada).
    try:
        await audit_log(
            db, request, user,
            action="create_nubox_form",
            entity_type="voucher",
            entity_id=str(voucher_id_local),
            entity_label=codigo,
            summary=(
                # Round 31 — proveedor opcional: si vacío, mostramos "sin proveedor".
                f"Voucher COMPRA Nubox-form creado: "
                f"{proveedor_nombre_input or 'sin proveedor'} — "
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
    except Exception as exc:
        import structlog
        structlog.get_logger(__name__).warning(
            "voucher_nubox_audit_failed",
            voucher_id=voucher_id_local,
            error=str(exc),
        )

    # V5++ ola CE — Webhook voucher.imported para vouchers que vienen del
    # flujo de IA. Best-effort (no rompe la creacion si el dispatcher falla).
    if (body.source or "").lower() == "ai_import":
        try:
            from app.services.webhook_dispatcher import publish_event

            await publish_event(
                db,
                "voucher.imported",
                {
                    "voucher_id": voucher_id_local,
                    "codigo": codigo,
                    "empresa_codigo": body.empresa_codigo,
                    # Round 31 — pueden ser None si no se ingresó proveedor.
                    "proveedor_rut": proveedor_rut_canonical,
                    "proveedor_nombre": proveedor_nombre_input or None,
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
        voucher_id=voucher_id_local,
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
        proveedor_id=proveedor_id_local,
        proveedor_creado_automatico=proveedor_creado_automatico,
        proveedor_rut_canonical=proveedor_rut_canonical,
    )
