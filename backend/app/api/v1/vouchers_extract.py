"""V5++ ola CE — Extraccion de datos para voucher desde upload directo.

Diferencias con /vouchers/from-factura-pdf existente:
  - Acepta upload multipart (no requiere Dropbox path).
  - Soporta PDF, JPG/PNG/HEIC, DOCX y PPTX (el dispatcher de
    `document_analyzer_service` cubre todo).
  - **NO crea el voucher** — devuelve los campos extraidos para que el
    frontend los muestre en un form pre-llenado y editable. El user revisa,
    ajusta lo que haga falta y recien ahi confirma con POST /vouchers/nubox-form.

Flujo:
  1. POST multipart con `file` (cualquier formato soportado) + `empresa_codigo`.
  2. Backend descarga bytes, los pasa por `extract_text` (dispatcher por mime).
  3. Llama `analyze_document(text, tipo="factura")` que invoca Claude con el
     schema "factura" del service.
  4. Mapea los campos crudos del LLM al shape de NuboxFormCreate (proveedor_rut,
     proveedor_nombre, tipo_documento, numero_documento, fecha_documento,
     total) + sugiere lineas iniciales (1 contable con descripcion + total,
     1 financiera con cuenta vacia y mismo total).
  5. Devuelve dict listo para que el FE lo cargue en el state del form Nubox.

Cap de tamaño: 15MB por upload (defensivo — vouchers grandes suelen ser PDFs
de 1-5MB; PPT puede llegar a 10MB).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.rut import format_rut, validate_rut
from app.services.document_analyzer_service import (
    DocumentAnalyzerNotConfigured,
    analyze_document,
    extract_text,
)
from app.services.empresa_scope_service import assert_empresa_access

router = APIRouter()

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB
SUPPORTED_EXTS = {
    "pdf",
    "jpg",
    "jpeg",
    "png",
    "heic",
    "webp",
    "tif",
    "tiff",
    "docx",
    "pptx",
    "ppt",
}


class ExtractedLine(BaseModel):
    """Una linea sugerida para el form (cuenta vacia, user la completa)."""

    comentario: str
    cuenta_codigo: str = ""
    total: str  # string para no perder decimales en el roundtrip JSON


class ExtractedVoucherSuggestion(BaseModel):
    """Sugerencia precargada para el form Nubox-style.

    Todos los campos son tentativos — el FE los renderiza en inputs editables
    y el user ajusta antes de submitir el voucher real con /vouchers/nubox-form.
    """

    empresa_codigo: str
    proveedor_rut: str = ""
    proveedor_nombre: str = ""
    rut_es_valido: bool = False
    tipo_documento: str = "FACTURA"
    numero_documento: str = ""
    forma_pago: str = "TRANSFERENCIA"
    fecha_documento: str  # YYYY-MM-DD
    fecha_vencimiento: str = ""
    glosa: str = ""
    informacion_contable: list[ExtractedLine]
    informacion_financiera: list[ExtractedLine]


class ExtractFromUploadResponse(BaseModel):
    """Respuesta del endpoint: datos crudos del LLM + sugerencia para el form."""

    suggestion: ExtractedVoucherSuggestion
    raw_fields: dict[str, Any]
    warnings: list[str]
    tipo_detectado: str
    confidence: float
    extraction_method: str | None
    ocr_pages: int | None
    filename: str
    file_size_bytes: int


def _ext_from_filename(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def _parse_amount(raw: Any) -> Decimal | None:
    """Coerce posible numero (int, float, str con comas/puntos) a Decimal positivo."""
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
    if value <= 0:
        return None
    return value


def _build_suggestion(
    fields: dict[str, Any],
    empresa_codigo: str,
) -> ExtractedVoucherSuggestion:
    # RUT: normalizar si Claude devolvio uno valido; sino dejarlo crudo
    # y marcar invalido para que el FE muestre el chip rojo.
    proveedor_rut_raw = str(fields.get("proveedor_rut") or "").strip()
    rut_valido = bool(proveedor_rut_raw) and validate_rut(proveedor_rut_raw)
    proveedor_rut = format_rut(proveedor_rut_raw) if rut_valido else proveedor_rut_raw

    fecha_raw = str(fields.get("fecha") or "").strip()
    try:
        fecha_doc = date.fromisoformat(fecha_raw) if fecha_raw else date.today()
    except ValueError:
        fecha_doc = date.today()

    total = _parse_amount(fields.get("total"))
    if total is None:
        total = _parse_amount(fields.get("monto_neto"))  # fallback
    total_str = str(total) if total else "0"

    proveedor_nombre = str(fields.get("proveedor_nombre") or "").strip()
    numero_doc = str(fields.get("numero_factura") or "").strip()
    glosa = str(fields.get("descripcion") or "").strip()
    if not glosa and proveedor_nombre and numero_doc:
        glosa = f"Compra a {proveedor_nombre} — FACTURA folio {numero_doc}"

    # Una linea contable con la descripcion (DEBE = gasto). Cuenta queda
    # vacia para que el user la complete con su plan de cuentas.
    linea_contable = ExtractedLine(
        comentario=glosa or proveedor_nombre or "Compra",
        cuenta_codigo="",
        total=total_str,
    )
    # Una linea financiera con el mismo total (HABER = banco / CxP). Tambien
    # con cuenta vacia.
    linea_financiera = ExtractedLine(
        comentario=f"Pago a {proveedor_nombre}" if proveedor_nombre else "Pago proveedor",
        cuenta_codigo="",
        total=total_str,
    )

    return ExtractedVoucherSuggestion(
        empresa_codigo=empresa_codigo,
        proveedor_rut=proveedor_rut,
        proveedor_nombre=proveedor_nombre,
        rut_es_valido=rut_valido,
        tipo_documento="FACTURA",
        numero_documento=numero_doc,
        forma_pago="TRANSFERENCIA",
        fecha_documento=fecha_doc.isoformat(),
        fecha_vencimiento="",
        glosa=glosa,
        informacion_contable=[linea_contable],
        informacion_financiera=[linea_financiera],
    )


@router.post(
    "/extract-from-upload",
    response_model=ExtractFromUploadResponse,
    status_code=status.HTTP_200_OK,
)
async def extract_from_upload(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    file: Annotated[UploadFile, File(description="Archivo PDF/JPG/PNG/DOCX/PPTX")],
    empresa_codigo: Annotated[str, Form(min_length=2, max_length=20)],
) -> ExtractFromUploadResponse:
    """Lee imagen / PDF / DOCX / PPTX, lo analiza con Claude y sugiere campos
    para el form Nubox de creacion de voucher.

    NO crea el voucher — solo devuelve la sugerencia para que el FE la muestre
    en un form editable. Cuando el usuario confirma, el FE POST a
    /vouchers/nubox-form con los datos ya editados.

    Scope: el `empresa_codigo` se valida con `assert_empresa_access` (multi-tenant).
    """
    # 1) Validaciones de input
    filename = file.filename or "upload"
    ext = _ext_from_filename(filename)
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Formato '.{ext}' no soportado. Soportados: "
                + ", ".join(sorted(SUPPORTED_EXTS))
            ),
        )

    await assert_empresa_access(user, db, empresa_codigo)

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Archivo demasiado grande ({len(content) / 1024 / 1024:.1f}MB). "
                f"Limite: {MAX_UPLOAD_BYTES / 1024 / 1024:.0f}MB."
            ),
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Archivo vacio"
        )

    # 2) Extraer texto del archivo (PDF/imagen/docx/pptx via dispatcher)
    extract_result = await extract_text(
        content, content_type=file.content_type or "", filename=filename
    )
    warnings: list[str] = list(extract_result.warnings)
    if not extract_result.text or len(extract_result.text.strip()) < 20:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"No se pudo extraer texto util del archivo ({extract_result.method}). "
                "Probá con otro archivo, una version digital del PDF, o cargá los datos manualmente."
            ),
        )

    # 3) Analizar con Claude (schema 'factura' — el caso de uso principal)
    try:
        extraction = await analyze_document(
            extract_result.text,
            tipo="factura",
            filename=filename,
            extraction_warnings=warnings,
            extraction_method=extract_result.method,
            ocr_pages=extract_result.ocr_pages,
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    # 4) Construir sugerencia precargada para el form
    suggestion = _build_suggestion(extraction.fields, empresa_codigo)

    return ExtractFromUploadResponse(
        suggestion=suggestion,
        raw_fields=extraction.fields,
        warnings=extraction.warnings,
        tipo_detectado=extraction.tipo_detectado,
        confidence=extraction.confidence,
        extraction_method=extraction.extraction_method,
        ocr_pages=extraction.ocr_pages,
        filename=filename,
        file_size_bytes=len(content),
    )
