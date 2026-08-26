"""V5++ ola CG — Extracción de Órdenes de Compra desde upload/texto con IA.

Análogo de `vouchers_extract.py` pero para OCs. Acepta:
  - Upload de cotización (PDF, imagen, DOCX, PPTX, XLSX, EML, HTML, TXT)
  - Texto pegado (email forwarded, WhatsApp del proveedor, etc.)

Usa el mismo `analyze_document(tipo="orden_compra")` con el schema
recién agregado al service. Devuelve `OcExtractedSuggestion` con
campos mapeados al `OrdenCompraCreate` que el FE puede mostrar en
un form editable y confirmar.
"""
from __future__ import annotations

import re
import time
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.retencion import (
    IVA_PORCENTAJE_GENERAL,
    porcentaje_retencion_por_fecha,
)
from app.domain.value_objects.rut import format_rut, validate_rut
from app.infrastructure.repositories.integration_repository import IntegrationRepository
from app.services.document_analyzer_service import (
    DocumentAnalyzerNotConfigured,
    analyze_document,
    extract_text,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.empresa_scope_service import assert_empresa_access

log = structlog.get_logger(__name__)

router = APIRouter()

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
SUPPORTED_EXTS = {
    "pdf", "docx", "pptx", "ppt", "xlsx", "xlsm",
    "jpg", "jpeg", "png", "heic", "webp", "tif", "tiff", "gif", "bmp",
    "txt", "md", "csv",
    "eml", "html", "htm", "msg",
}


# =====================================================================
# Schemas
# =====================================================================


class OcExtractedItem(BaseModel):
    descripcion: str
    cantidad: str = "1"
    #: Unidad de medida de la línea (Un, Gl, Días, m³, Ton, Hrs…). La columna
    #: y el PDF la soportan desde hace rondas y el formulario manual la ofrece,
    #: pero este esquema no la transportaba: TODA OC creada con IA nacía con la
    #: unidad en NULL y el PDF imprimía "—". Texto libre, no enum: cada rubro
    #: usa su nomenclatura.
    unidad: str = ""
    precio_unitario: str = "0"
    #: El total que DICE el documento para esa línea. Se conserva aparte de
    #: cantidad × precio a propósito: si no coinciden, uno de los tres números
    #: se leyó mal y hay que avisarlo, no elegir en silencio.
    total: str = "0"


class Conciliacion(BaseModel):
    """Si lo que dice el documento cuadra con lo que suman sus líneas.

    La IA extrae el `neto` del pie del documento Y las líneas del itemizado.
    El backend recomputa el neto desde las líneas (bien), pero antes NADIE
    comparaba los dos: si la IA se saltaba una línea de una cotización de 12
    ítems, la OC salía por menos que el documento original y no había ninguna
    señal. Ése es el "no me cuadra" del equipo.

    Esto NO elige por el operador: le muestra los dos números.
    """

    #: Neto que la IA leyó del pie del documento. None si no aparecía.
    neto_documento: str | None = None
    #: Σ(cantidad × precio) de las líneas extraídas.
    neto_items: str = "0"
    #: Difieren en más de lo que explica un redondeo.
    difieren: bool = False
    #: Diferencia absoluta, para mostrarla sin que la pantalla la recalcule.
    diferencia: str = "0"
    #: Líneas donde el total del documento no es cantidad × precio.
    #: Cada una: {"item": 3, "descripcion": "...", "documento": "...",
    #:            "calculado": "..."}
    lineas_descuadradas: list[dict[str, str]] = []


class OcExtractedSuggestion(BaseModel):
    """Sugerencia precargada para el form de OC nueva."""

    empresa_codigo: str
    empresa_auto_detectada: bool = False
    empresa_receptor_rut_detectado: str | None = None
    proveedor_rut: str = ""
    proveedor_nombre: str = ""
    rut_es_valido: bool = False
    numero_oc: str = ""
    fecha_emision: str
    validez_dias: int = 30
    moneda: str = "CLP"
    neto: str = "0"
    forma_pago: str = ""
    plazo_pago: str = ""
    observaciones: str = ""
    #: Token del catálogo SII: FACTURA | FACTURA_EXENTA | BOLETA | HONORARIOS.
    #: Sin este campo, toda OC creada con IA nacía FACTURA al 19 % y no había
    #: forma de emitir una boleta de honorarios desde este camino.
    tipo_documento: str = "FACTURA"
    #: Tasas sugeridas, coherentes con el tipo. La pantalla las muestra y las
    #: manda; la autoridad sigue siendo el servidor al crear la OC.
    iva_porcentaje: str = "19"
    retencion_porcentaje: str = "0"
    #: Por qué se eligió ese tipo. Se muestra en pantalla: una decisión
    #: tributaria tomada por una IA sin decir en qué se basó no se puede
    #: revisar.
    tipo_documento_motivo: str = ""
    items: list[OcExtractedItem]
    conciliacion: Conciliacion = Conciliacion()


class OcExtractFromUploadResponse(BaseModel):
    suggestion: OcExtractedSuggestion
    raw_fields: dict[str, Any]
    warnings: list[str]
    tipo_detectado: str
    confidence: float
    extraction_method: str | None
    ocr_pages: int | None
    filename: str
    file_size_bytes: int
    dropbox_path: str | None = None
    dropbox_warning: str | None = None


class OcExtractFromTextRequest(BaseModel):
    empresa_codigo: str
    text: str
    source_hint: str | None = None


# =====================================================================
# Helpers
# =====================================================================


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_VALID_FORMA_PAGO = {
    "TRANSFERENCIA", "CHEQUE", "CONTADO", "EFECTIVO",
    "CREDITO_30D", "CREDITO_60D", "CREDITO_90D",
    "TARJETA_CREDITO", "TARJETA_DEBITO", "OTRO",
}
_VALID_MONEDA = {"CLP", "USD", "UF", "EUR"}

#: Los cuatro tokens del catálogo SII, los MISMOS que usa el schema de la OC.
#: Se importan y no se reescriben: toda lista de tokens duplicada termina
#: divergiendo de la original.
_TIPOS_DOCUMENTO_VALIDOS = {"FACTURA", "FACTURA_EXENTA", "BOLETA", "HONORARIOS"}

#: Cuánto puede diferir el documento de la suma de sus líneas antes de que
#: se considere un descuadre. Un peso: lo que explica un redondeo del emisor.
#: Más que eso ya es una línea leída mal o una línea faltante, y hay que
#: avisarlo. No se pone 0 porque casi ningún documento chileno cierra al
#: centavo exacto cuando hay cantidades fraccionarias.
_TOLERANCIA = Decimal("1")

#: Señales de que el documento es una BOLETA DE HONORARIOS. Se buscan sobre el
#: texto plano de todos los campos extraídos, no sólo sobre el tipo que dijo
#: la IA: si la IA no se pronunció, estas palabras alcanzan para no emitir una
#: factura afecta por una prestación de servicios de persona natural.
_SENALES_HONORARIOS = (
    "boleta de honorarios",
    "boleta honorarios",
    "honorarios",
    "segunda categoria",
    "segunda categoría",
)
_SENALES_EXENTA = ("exenta", "exento", "no afecto", "no afecta")


def _detectar_tipo_documento(fields: dict[str, Any]) -> tuple[str, str]:
    """El tipo tributario del documento, y por qué se eligió.

    Devuelve `(token, motivo)`. El motivo se muestra en pantalla: una decisión
    tributaria tomada por una IA sin decir en qué se basó no se puede revisar,
    y ésta cambia si el proveedor cobra IVA o si hay que retenerle 15,25 %.

    Ante la duda devuelve FACTURA, que es el caso mayoritario y el default
    histórico — pero lo dice, para que el operador sepa que nadie se pronunció.
    """
    # 1. Lo que la IA declaró, si es un token válido.
    declarado = str(fields.get("tipo_documento") or "").strip().upper()
    if declarado in _TIPOS_DOCUMENTO_VALIDOS:
        return declarado, "Lo declara el documento."

    # 2. Señales en el texto. Se concatena todo lo extraído porque la palabra
    #    "honorarios" puede venir en el giro, en la glosa o en una línea.
    texto = " ".join(
        str(v) for k, v in fields.items()
        if k != "items" and v is not None
    ).lower()
    items = fields.get("items")
    if isinstance(items, list):
        texto += " " + " ".join(
            str(i.get("descripcion") or "") for i in items if isinstance(i, dict)
        ).lower()

    if any(sig in texto for sig in _SENALES_HONORARIOS):
        return "HONORARIOS", "Dice «honorarios»: se retiene segunda categoría."

    # 3. Aritmética: si hay total y neto y son iguales, no hubo IVA.
    neto = _parse_amount(fields.get("neto"))
    total = _parse_amount(fields.get("total"))
    iva = _parse_amount(fields.get("iva"))
    if iva is not None and iva == 0 and neto and total and neto == total:
        if any(sig in texto for sig in _SENALES_EXENTA):
            return "FACTURA_EXENTA", "Sin IVA y el documento dice «exenta»."
        return "FACTURA_EXENTA", "El documento no tiene IVA: total = neto."

    if any(sig in texto for sig in _SENALES_EXENTA):
        return "FACTURA_EXENTA", "El documento dice «exenta»."

    return "FACTURA", "No se detectó otro tipo; se asume factura afecta."


def _pct_str(valor: Decimal) -> str:
    """Un porcentaje sin ceros de relleno: 19, 12.5, 15.25 — nunca "19.00".

    `IVA_PORCENTAJE_GENERAL` es `Decimal("19.00")` y su `str()` arrastra los
    dos decimales hasta el input del formulario, que es exactamente el
    "si no tienen decimales que se vea sólo el número" que reportó el equipo.
    """
    t = format(valor.normalize(), "f")
    return t if t not in ("", "-") else "0"


def _iva_sugerido(tipo_documento: str, moneda: str) -> str:
    """Tasa de IVA coherente con el tipo y la moneda.

    Espeja la regla del servidor (`_derivar_totales_oc`): exenta y honorarios
    van a 0, y las monedas que no son CLP ni UF también. Sugerir 19 en una
    boleta de honorarios dejaría el formulario con una contradicción cargada
    que el backend después pisa — y el operador vería cambiar el número al
    guardar sin entender por qué.
    """
    if tipo_documento in ("FACTURA_EXENTA", "HONORARIOS"):
        return "0"
    if moneda not in ("CLP", "UF"):
        return "0"
    return _pct_str(IVA_PORCENTAJE_GENERAL)


def _retencion_sugerida(tipo_documento: str, fecha_emision: date | None) -> str:
    """Retención de segunda categoría, por la escala del año.

    Sólo aplica a HONORARIOS. Sale de la escala en código
    (`porcentaje_retencion_por_fecha`), que es un FALLBACK: la fuente de
    verdad es `core.tax_config` y la resuelve el endpoint de creación con la
    fecha de emisión definitiva. Acá es una sugerencia para la pantalla; si
    las dos difieren, manda el servidor.
    """
    if tipo_documento != "HONORARIOS":
        return "0"
    return _pct_str(porcentaje_retencion_por_fecha(fecha_emision))



def _ext_from_filename(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _safe_filename(name: str) -> str:
    base = name.strip().replace(" ", "_")
    safe = _SAFE_FILENAME_RE.sub("-", base)
    return safe[:120] or "upload.bin"


def _parse_amount(raw: Any) -> Decimal | None:
    if raw is None:
        return None
    if isinstance(raw, int | float):
        try:
            value = Decimal(str(raw))
        except InvalidOperation:
            return None
    elif isinstance(raw, str):
        cleaned = raw.strip().replace(".", "").replace(",", ".").replace("$", "")
        cleaned = cleaned.split()[0] if cleaned else ""
        try:
            value = Decimal(cleaned)
        except (InvalidOperation, IndexError):
            return None
    else:
        return None
    if value < 0:
        return None
    return value


def _build_oc_suggestion(
    fields: dict[str, Any],
    empresa_codigo: str,
) -> OcExtractedSuggestion:
    # Proveedor RUT
    proveedor_rut_raw = str(fields.get("proveedor_rut") or "").strip()
    rut_valido = bool(proveedor_rut_raw) and validate_rut(proveedor_rut_raw)
    proveedor_rut = format_rut(proveedor_rut_raw) if rut_valido else proveedor_rut_raw

    # Receptor RUT (para auto-detect empresa)
    receptor_rut_raw = str(fields.get("receptor_rut") or "").strip()
    receptor_rut_canonical: str | None = None
    if receptor_rut_raw and receptor_rut_raw.lower() not in ("null", "none", ""):
        if validate_rut(receptor_rut_raw):
            receptor_rut_canonical = format_rut(receptor_rut_raw)

    # Fecha emision
    fecha_raw = str(fields.get("fecha_emision") or "").strip()
    try:
        fecha_em = date.fromisoformat(fecha_raw) if fecha_raw else date.today()
    except ValueError:
        fecha_em = date.today()

    # Numero OC sugerido por IA (puede estar vacío)
    numero_oc = str(fields.get("numero_oc") or "").strip()

    # Validez días
    validez_raw = fields.get("validez_dias")
    try:
        validez_dias = int(validez_raw) if validez_raw else 30
    except (ValueError, TypeError):
        validez_dias = 30
    if validez_dias < 1:
        validez_dias = 30

    # Moneda
    moneda_raw = str(fields.get("moneda") or "CLP").strip().upper()
    moneda = moneda_raw if moneda_raw in _VALID_MONEDA else "CLP"

    # Forma pago
    forma_pago_raw = str(fields.get("forma_pago") or "").strip().upper()
    forma_pago = forma_pago_raw if forma_pago_raw in _VALID_FORMA_PAGO else ""

    # Neto
    neto = _parse_amount(fields.get("neto"))
    if neto is None:
        # Fallback: usar total y descontar IVA si moneda=CLP (19%)
        total = _parse_amount(fields.get("total"))
        if total is not None and moneda == "CLP":
            # R152UUUUUU — peso entero HALF_UP (antes 0.01/HALF_EVEN:
            # total 1.190.001 sugería neto 1.000.000,84 con centavos).
            neto = (total / Decimal("1.19")).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        elif total is not None:
            neto = total
    neto_str = str(neto) if neto else "0"

    proveedor_nombre = str(fields.get("proveedor_nombre") or "").strip()
    plazo_pago = str(fields.get("plazo_pago") or "").strip()
    observaciones = str(fields.get("observaciones") or "").strip()

    # ── Tipo de documento tributario ─────────────────────────────────────
    # Sin esto, TODA OC creada con IA nacía FACTURA al 19 % y no había forma
    # de emitir una boleta de honorarios (que además necesita la retención)
    # ni una factura exenta desde este camino. Es la queja 2 del equipo.
    tipo_documento, tipo_motivo = _detectar_tipo_documento(fields)

    # ── Items detallados ─────────────────────────────────────────────────
    items_raw = fields.get("items")
    items: list[OcExtractedItem] = []
    lineas_descuadradas: list[dict[str, str]] = []
    if isinstance(items_raw, list) and items_raw:
        for idx, item in enumerate(items_raw[:30], start=1):
            if not isinstance(item, dict):
                continue
            desc = str(item.get("descripcion") or item.get("description") or "").strip()
            if not desc:
                continue
            # `is None` y NO `or Decimal("1")`: una cantidad de 0 es un dato,
            # no una ausencia, y con `or` se convertía en 1 en silencio —
            # cambiando el total de la línea sin que nadie lo viera.
            qty_leida = _parse_amount(item.get("cantidad"))
            qty = qty_leida if qty_leida is not None else Decimal("1")
            price = _parse_amount(item.get("precio_unitario"))
            total_doc = _parse_amount(item.get("total"))
            calculado = qty * (price if price is not None else Decimal("0"))

            # Si el documento declara un total de línea y NO es cantidad ×
            # precio, uno de los tres números se leyó mal. No se elige: se
            # anota para que la pantalla lo muestre.
            if total_doc is not None and abs(total_doc - calculado) > _TOLERANCIA:
                lineas_descuadradas.append({
                    "item": str(idx),
                    "descripcion": desc[:80],
                    "documento": str(total_doc),
                    "calculado": str(calculado),
                })

            unidad = str(item.get("unidad") or item.get("unit") or "").strip()

            items.append(OcExtractedItem(
                descripcion=desc[:500],
                cantidad=str(qty),
                unidad=unidad[:20],
                # `is None` otra vez: un precio de 0 es válido (ítem de
                # cortesía, bonificación) y con `if price` se perdía.
                precio_unitario=str(price) if price is not None else "0",
                total=str(total_doc) if total_doc is not None else str(calculado),
            ))

    # Fallback: 1 item con la descripcion del documento (si hay observaciones útiles)
    if not items:
        items = [OcExtractedItem(
            descripcion=observaciones[:200] if observaciones else (
                f"Compra a {proveedor_nombre}" if proveedor_nombre else "Item"
            ),
            cantidad="1",
            unidad="",
            precio_unitario=neto_str,
            total=neto_str,
        )]

    # ── Conciliación: ¿el documento cuadra con sus líneas? ───────────────
    suma_items = sum(
        (_parse_amount(i.cantidad) or Decimal("0"))
        * (_parse_amount(i.precio_unitario) or Decimal("0"))
        for i in items
    ) or Decimal("0")
    neto_doc = _parse_amount(fields.get("neto"))
    difieren = (
        neto_doc is not None
        and abs(neto_doc - suma_items) > _TOLERANCIA
    )
    conciliacion = Conciliacion(
        neto_documento=str(neto_doc) if neto_doc is not None else None,
        neto_items=str(suma_items),
        difieren=difieren,
        diferencia=str(abs(neto_doc - suma_items)) if difieren else "0",
        lineas_descuadradas=lineas_descuadradas,
    )

    return OcExtractedSuggestion(
        empresa_codigo=empresa_codigo,
        empresa_auto_detectada=False,
        empresa_receptor_rut_detectado=receptor_rut_canonical,
        proveedor_rut=proveedor_rut,
        proveedor_nombre=proveedor_nombre,
        rut_es_valido=rut_valido,
        numero_oc=numero_oc,
        fecha_emision=fecha_em.isoformat(),
        validez_dias=validez_dias,
        moneda=moneda,
        neto=neto_str,
        forma_pago=forma_pago,
        plazo_pago=plazo_pago,
        observaciones=observaciones,
        tipo_documento=tipo_documento,
        iva_porcentaje=_iva_sugerido(tipo_documento, moneda),
        retencion_porcentaje=_retencion_sugerida(tipo_documento, fecha_em),
        tipo_documento_motivo=tipo_motivo,
        items=items,
        conciliacion=conciliacion,
    )


async def _maybe_match_empresa(
    suggestion: OcExtractedSuggestion, db: Any
) -> OcExtractedSuggestion:
    """Si la IA detectó receptor_rut, matchea con core.empresas y actualiza."""
    if not suggestion.empresa_receptor_rut_detectado:
        return suggestion
    from sqlalchemy import text as _text

    row = (
        await db.execute(
            _text(
                "SELECT codigo FROM core.empresas "
                "WHERE rut = :rut AND activo = TRUE LIMIT 1"
            ),
            {"rut": suggestion.empresa_receptor_rut_detectado},
        )
    ).fetchone()
    if not row:
        return suggestion
    return suggestion.model_copy(
        update={
            "empresa_codigo": str(row[0]),
            "empresa_auto_detectada": True,
        }
    )


async def _try_upload_to_dropbox(
    db: Any, content: bytes, filename: str, empresa_codigo: str
) -> tuple[str | None, str | None]:
    """Sube el archivo origen a /Cehta Capital/01-Empresas/{COD}/06-Adjuntos-OCs/{año}/."""
    try:
        integration_repo = IntegrationRepository(db)
        integration = await integration_repo.get_by_provider("dropbox")
    except Exception as exc:  # noqa: BLE001
        return None, f"No pude consultar la integracion Dropbox: {exc}"
    if integration is None or not integration.access_token:
        return None, "Dropbox no conectado — archivo no archivado."
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        return None, f"Dropbox client no configurado: {exc}"
    safe = _safe_filename(filename)
    year = date.today().year
    ts = int(time.time() * 1000)
    path = (
        f"/Cehta Capital/01-Empresas/{empresa_codigo}/06-Adjuntos-OCs/"
        f"{year}/{ts}_{safe}"
    )
    try:
        dbx.upload_file(path, content, overwrite=False)
        log.info("oc_extract.dropbox.uploaded", path=path, size=len(content))
        return path, None
    except Exception as exc:  # noqa: BLE001
        log.warning("oc_extract.dropbox.upload_failed", error=str(exc))
        return None, f"Fallé subiendo a Dropbox: {exc}"


# =====================================================================
# Endpoints
# =====================================================================


@router.post(
    "/extract-from-text",
    response_model=OcExtractFromUploadResponse,
    status_code=status.HTTP_200_OK,
)
# NOTA: @limiter.limit removido (rompe Pydantic schema). Default 100/min.
async def oc_extract_from_text(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    body: OcExtractFromTextRequest,
) -> OcExtractFromUploadResponse:
    """Crear OC desde texto pegado (email, WhatsApp, cotización en texto).

    NO crea la OC — devuelve sugerencia para que el FE muestre el form
    editable y el user confirme con POST /ordenes-compra (existente).
    """
    if not body.text or len(body.text.strip()) < 30:
        raise HTTPException(
            status_code=400,
            detail="Texto demasiado corto (mínimo 30 caracteres).",
        )
    MAX_TEXT = 60_000
    text_input = body.text.strip()[:MAX_TEXT]

    await assert_empresa_access(user, db, body.empresa_codigo)

    try:
        extraction = await analyze_document(
            text_input,
            tipo="orden_compra",
            filename=f"texto-oc-{body.source_hint or 'manual'}.txt",
            extraction_method=body.source_hint or "text_paste",
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    suggestion = _build_oc_suggestion(extraction.fields, body.empresa_codigo)
    suggestion = await _maybe_match_empresa(suggestion, db)

    return OcExtractFromUploadResponse(
        suggestion=suggestion,
        raw_fields=extraction.fields,
        warnings=extraction.warnings,
        tipo_detectado=extraction.tipo_detectado,
        confidence=extraction.confidence,
        extraction_method=extraction.extraction_method,
        ocr_pages=extraction.ocr_pages,
        filename=f"texto-{body.source_hint or 'pegado'}",
        file_size_bytes=len(text_input.encode("utf-8")),
        dropbox_path=None,
        dropbox_warning=None,
    )


@router.post(
    "/extract-from-upload",
    response_model=OcExtractFromUploadResponse,
    status_code=status.HTTP_200_OK,
)
# NOTA: @limiter.limit removido (rompe Pydantic schema). Default 100/min.
async def oc_extract_from_upload(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    file: Annotated[UploadFile, File(description="Cotización en cualquier formato")],
    empresa_codigo: Annotated[str, Form(min_length=2, max_length=20)],
    save_to_dropbox: Annotated[bool, Form()] = True,
) -> OcExtractFromUploadResponse:
    """Extract para OC desde archivo. Mismo pipeline que vouchers/extract-from-upload
    pero con tipo='orden_compra' (schema con campos específicos de OC)."""
    filename = file.filename or "upload"
    ext = _ext_from_filename(filename)
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            status_code=415,
            detail=f"Formato '.{ext}' no soportado.",
        )

    await assert_empresa_access(user, db, empresa_codigo)

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Archivo muy grande ({len(content) / 1024 / 1024:.1f}MB). "
                f"Límite: {MAX_UPLOAD_BYTES / 1024 / 1024:.0f}MB."
            ),
        )

    extract_result = await extract_text(
        content, content_type=file.content_type or "", filename=filename
    )
    warnings: list[str] = list(extract_result.warnings)
    is_image = ext in {"jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"}
    extracted_text = extract_result.text
    extracted_method = extract_result.method
    extracted_ocr_pages = extract_result.ocr_pages

    if not extracted_text or len(extracted_text.strip()) < 20:
        if not is_image:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"No se pudo extraer texto del archivo ({extracted_method}). "
                    "Probá con otro archivo o cargá los datos manualmente."
                ),
            )
        extracted_text = (
            "[OCR no disponible para esta imagen. Analiza directamente la "
            "imagen adjunta y extrae los datos de la cotización/OC.]"
        )
        extracted_method = "vision_only"
        warnings.append("OCR vacio — usando Claude Vision sola.")

    image_content: bytes | None = None
    image_mime: str | None = None
    if is_image:
        image_content = content
        image_mime = file.content_type or f"image/{ext}"

    try:
        extraction = await analyze_document(
            extracted_text,
            tipo="orden_compra",
            filename=filename,
            extraction_warnings=warnings,
            extraction_method=(
                f"{extracted_method}+vision" if image_content else extracted_method
            ),
            ocr_pages=extracted_ocr_pages,
            image_content=image_content,
            image_mime=image_mime,
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    suggestion = _build_oc_suggestion(extraction.fields, empresa_codigo)
    suggestion = await _maybe_match_empresa(suggestion, db)

    dropbox_path: str | None = None
    dropbox_warning: str | None = None
    if save_to_dropbox:
        dropbox_path, dropbox_warning = await _try_upload_to_dropbox(
            db, content, filename, empresa_codigo
        )

    return OcExtractFromUploadResponse(
        suggestion=suggestion,
        raw_fields=extraction.fields,
        warnings=extraction.warnings,
        tipo_detectado=extraction.tipo_detectado,
        confidence=extraction.confidence,
        extraction_method=extraction.extraction_method,
        ocr_pages=extraction.ocr_pages,
        filename=filename,
        file_size_bytes=len(content),
        dropbox_path=dropbox_path,
        dropbox_warning=dropbox_warning,
    )
