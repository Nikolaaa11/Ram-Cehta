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

import re
import time
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
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

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15MB
SUPPORTED_EXTS = {
    # PDFs y office
    "pdf",
    "docx",
    "pptx",
    "ppt",
    "xlsx",
    "xlsm",
    # Imagenes
    "jpg",
    "jpeg",
    "png",
    "heic",
    "webp",
    "tif",
    "tiff",
    "gif",
    "bmp",
    # Texto plano y derivados
    "txt",
    "md",
    "csv",
    # Email y web
    "eml",
    "html",
    "htm",
    "msg",  # outlook (parsea como text de mejor esfuerzo)
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
    # V5++ ola CE — Si save_to_dropbox=true y la integracion esta activa,
    # el archivo se sube a /Apps/CehtaCapital/Adjuntos-Vouchers/{empresa}/{año}/
    # y aca devolvemos el path para que el FE lo pase al nubox-form como
    # documento_dropbox_path.
    dropbox_path: str | None = None
    dropbox_warning: str | None = None


def _ext_from_filename(filename: str) -> str:
    if "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    """Normaliza un filename para path Dropbox: ASCII-ish, sin espacios/raros."""
    base = name.strip().replace(" ", "_")
    safe = _SAFE_FILENAME_RE.sub("-", base)
    return safe[:120] or "upload.bin"


async def _try_upload_to_dropbox(
    db: Any, content: bytes, filename: str, empresa_codigo: str
) -> tuple[str | None, str | None]:
    """Sube `content` a Dropbox bajo Adjuntos-Vouchers/{empresa}/{año}/.

    Devuelve (path, warning):
      - (path, None) si exitoso
      - (None, "razon") si la integracion no esta activa o falla algo

    Soft-fail: nunca lanza. El endpoint sigue funcionando si Dropbox falla.
    """
    try:
        integration_repo = IntegrationRepository(db)
        integration = await integration_repo.get_by_provider("dropbox")
    except Exception as exc:  # noqa: BLE001
        return None, f"No pude consultar la integracion Dropbox: {exc}"
    if integration is None or not integration.access_token:
        return None, (
            "Dropbox no esta conectado. Conectalo en /admin/integraciones "
            "para que los archivos importados se archiven automaticamente."
        )
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
    path = f"/Apps/CehtaCapital/Adjuntos-Vouchers/{empresa_codigo}/{year}/{ts}_{safe}"
    try:
        # upload_file es sync — Fastapi corre el endpoint async, asi que
        # tecnicamente bloquea el event loop. Para uploads de hasta 15MB es
        # aceptable; si crece, mover a run_in_threadpool.
        dbx.upload_file(path, content, overwrite=False)
        log.info("vouchers_extract.dropbox.uploaded", path=path, size=len(content))
        return path, None
    except Exception as exc:  # noqa: BLE001
        log.warning("vouchers_extract.dropbox.upload_failed", error=str(exc))
        return None, f"Falle subiendo a Dropbox: {exc}"


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


class ExtractFromTextRequest(BaseModel):
    """Body de /vouchers/extract-from-text. El user pega un texto crudo
    (email forwarded, WhatsApp copiado, nota a mano) y Claude extrae
    los campos de factura igual que con un archivo."""

    empresa_codigo: str
    text: str
    source_hint: str | None = None  # "email" | "whatsapp" | "manual" — info para audit


@router.post(
    "/extract-from-text",
    response_model=ExtractFromUploadResponse,
    status_code=status.HTTP_200_OK,
)
async def extract_from_text(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: ExtractFromTextRequest,
) -> ExtractFromUploadResponse:
    """Extrae datos de factura desde un texto pegado (sin archivo).

    Casos de uso:
      - Email forwarded copiado y pegado en un textarea.
      - Mensaje de WhatsApp del proveedor con los datos del cobro.
      - Nota a mano transcrita.

    NO crea voucher — devuelve la misma `ExtractedVoucherSuggestion` que
    /extract-from-upload para que el FE muestre el form editable. No sube
    nada a Dropbox (no hay archivo).

    Cap: 60.000 chars (suficiente para emails largos + thread, evita pasar
    novelas enteras al LLM por costo).
    """
    if not body.text or len(body.text.strip()) < 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El texto es demasiado corto para extraer datos "
                "(minimo 30 caracteres)."
            ),
        )
    MAX_TEXT = 60_000
    text_input = body.text.strip()[:MAX_TEXT]

    await assert_empresa_access(user, db, body.empresa_codigo)

    try:
        extraction = await analyze_document(
            text_input,
            tipo="factura",
            filename=f"texto-pegado-{body.source_hint or 'manual'}.txt",
            extraction_warnings=[],
            extraction_method=body.source_hint or "text_paste",
            ocr_pages=None,
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    suggestion = _build_suggestion(extraction.fields, body.empresa_codigo)

    return ExtractFromUploadResponse(
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
    response_model=ExtractFromUploadResponse,
    status_code=status.HTTP_200_OK,
)
async def extract_from_upload(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    file: Annotated[UploadFile, File(description="Archivo PDF/JPG/PNG/DOCX/PPTX")],
    empresa_codigo: Annotated[str, Form(min_length=2, max_length=20)],
    save_to_dropbox: Annotated[bool, Form()] = True,
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

    # 5) Si el user pidio archivar, subimos a Dropbox y devolvemos el path
    #    en la response. El FE lo persiste como documento_dropbox_path al
    #    confirmar el voucher en nubox-form.
    dropbox_path: str | None = None
    dropbox_warning: str | None = None
    if save_to_dropbox:
        dropbox_path, dropbox_warning = await _try_upload_to_dropbox(
            db, content, filename, empresa_codigo
        )

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
        dropbox_path=dropbox_path,
        dropbox_warning=dropbox_warning,
    )
