"""Document analyzer endpoint (V3 fase 7).

Este router expone POST /documents/analyze: el frontend manda un archivo
arbitrario (PDF/DOCX/imagen/txt) + el `tipo` esperado, y devolvemos los
campos estructurados que el LLM pudo extraer. NO crea recursos en DB —
es una utilidad pura para auto-rellenar formularios. El usuario aún tiene
que confirmar y submitir el form que corresponda.

Por qué un router aparte (no dentro de `ai.py`):
- Privacy: el contenido del archivo NO toca la KB ni se persiste.
- Permisos: scope `document:analyze` distinto de `ai:chat`/`ai:index`.
- Cost control: límites distintos (10 MB, max_tokens=1000).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.api.deps import CurrentUser, require_scope
from app.schemas.document_extraction import DocumentExtraction, DocumentTipo
from app.services.document_analyzer_service import (
    MIN_TEXT_CHARS,
    DocumentAnalyzerNotConfigured,
    analyze_document,
    extract_text,
)

router = APIRouter()

# 10 MB cap. PDFs típicos de contratos < 2 MB; nos da margen para escaneos.
MAX_FILE_BYTES = 10 * 1024 * 1024


@router.post(
    "/analyze",
    response_model=DocumentExtraction,
    dependencies=[Depends(require_scope("document:analyze"))],
)
async def analyze_uploaded_document(
    user: CurrentUser,
    tipo: Annotated[DocumentTipo, Form(...)],
    file: Annotated[UploadFile, File(...)],
) -> DocumentExtraction:
    """Analiza un archivo y devuelve los campos extraídos.

    Status codes:
    - 200: extracción ok (puede tener confidence baja o warnings).
    - 413: archivo > 10 MB.
    - 422: no se pudo extraer texto (PDF de imágenes sin OCR, archivo vacío…).
    - 503: ANTHROPIC_API_KEY no configurada en backend.
    """
    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo excede {MAX_FILE_BYTES // (1024 * 1024)} MB.",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Archivo vacío.",
        )

    try:
        extraction = await extract_text(
            content,
            file.content_type or "",
            filename=file.filename,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No pude leer el archivo: {exc}",
        ) from exc

    if not extraction.text or len(extraction.text.strip()) < MIN_TEXT_CHARS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "No se pudo extraer texto del archivo. "
                "Si es un PDF escaneado, instalá OCR o transcribí el contenido."
            ),
        )

    try:
        return await analyze_document(
            extraction.text,
            tipo,
            filename=file.filename,
            extraction_warnings=list(extraction.warnings),
            extraction_method=extraction.method,
            ocr_pages=extraction.ocr_pages,
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        # No exponemos detalles del LLM al usuario final.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error al analizar con IA: {exc}",
        ) from exc
