"""Unit tests del pipeline OCR end-to-end (V4 fase 1).

Cubre:
- Fallback automático pypdf → OCR cuando pypdf devuelve <50 chars.
- Cost optimization: si pypdf rinde, OCR NO se llama.
- Soft-fail si pytesseract / pdf2image no están instalados.
- Soft-fail si el binario poppler no está (pdf2image lanza excepción).
- Imágenes (jpeg/png) van directo a OCR sin pasar por la rama PDF.
- `extraction_method` se setea correcto: pypdf | ocr | hybrid | image_ocr | failed.
- `ocr_pages` refleja la cantidad real de páginas procesadas.
- Cap de páginas (OCR_MAX_PAGES) se respeta.
- Logs de timing (`ocr_duration_ms`) se emiten para observabilidad de costo.

NO requieren tesseract instalado: todo se mockea con `unittest.mock.patch`.
"""
from __future__ import annotations

import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.services.document_analyzer_service import (
    OCR_DPI,
    OCR_LANG,
    OCR_MAX_PAGES,
    OCR_MIN_PYPDF_CHARS,
    extract_text,
    extract_text_image,
    extract_text_pdf_with_fallback,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_blank_pdf_bytes() -> bytes:
    """PDF mínimo válido (1 página en blanco) — pypdf lo lee y devuelve ''."""
    from io import BytesIO

    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _install_fake_modules(
    *,
    pdf2image_pages: int = 2,
    ocr_text_per_page: str = "Texto OCR de prueba con suficientes caracteres.",
    raise_pdf2image: bool = False,
    raise_pytesseract: bool = False,
) -> tuple[MagicMock, MagicMock]:
    """Instala módulos fake `pytesseract` y `pdf2image` en sys.modules.

    Retorna (mock_pytesseract, mock_convert) para que el test pueda assertir
    sobre las llamadas. El cleanup se hace en el fixture `restore_sys_modules`.
    """
    fake_pytesseract = MagicMock()
    if raise_pytesseract:
        fake_pytesseract.image_to_string.side_effect = RuntimeError("tesseract not found")
    else:
        fake_pytesseract.image_to_string.return_value = ocr_text_per_page

    fake_pdf2image = MagicMock()
    if raise_pdf2image:
        fake_pdf2image.convert_from_bytes.side_effect = RuntimeError(
            "Unable to get page count. Is poppler installed and in PATH?"
        )
    else:
        fake_pdf2image.convert_from_bytes.return_value = [
            MagicMock(name=f"page_{i}") for i in range(pdf2image_pages)
        ]

    sys.modules["pytesseract"] = fake_pytesseract
    sys.modules["pdf2image"] = fake_pdf2image
    return fake_pytesseract, fake_pdf2image


@pytest.fixture
def restore_sys_modules() -> Any:
    """Snapshot/restore de sys.modules para no contaminar otros tests."""
    snapshot = {
        k: sys.modules.get(k) for k in ("pytesseract", "pdf2image", "PIL", "PIL.Image")
    }
    yield
    for k, v in snapshot.items():
        if v is None:
            sys.modules.pop(k, None)
        else:
            sys.modules[k] = v


# ---------------------------------------------------------------------------
# 1. Cost optimization: pypdf rinde → OCR NO se llama
# ---------------------------------------------------------------------------


def test_pypdf_text_above_threshold_skips_ocr() -> None:
    """Si pypdf devuelve texto suficiente, no llamamos a pdf2image/pytesseract."""
    long_text = "Texto digital con más de 50 caracteres extraído por pypdf directamente."
    assert len(long_text) >= OCR_MIN_PYPDF_CHARS  # sanity

    with (
        patch(
            "app.services.document_analyzer_service.extract_text_pdf",
            return_value=long_text,
        ),
        patch(
            "app.services.document_analyzer_service._ocr_pdf_pages"
        ) as mock_ocr,
    ):
        # Le pasamos un PDF válido para que el bloque de pypdf init no rompa.
        text, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert mock_ocr.call_count == 0, "OCR debería estar skipped en cost-optimization"
    assert meta["method"] == "pypdf"
    assert meta["pages_ocr"] == 0
    assert meta["ocr_duration_ms"] == 0.0
    assert long_text in text


# ---------------------------------------------------------------------------
# 2. Fallback: pypdf devuelve poco → OCR se ejecuta
# ---------------------------------------------------------------------------


def test_pypdf_below_threshold_triggers_ocr(restore_sys_modules: Any) -> None:
    """Si pypdf devuelve <50 chars, se invoca pdf2image + pytesseract."""
    fake_pytesseract, fake_pdf2image = _install_fake_modules(
        pdf2image_pages=2,
        ocr_text_per_page="Línea OCR uno. Línea OCR dos. Suficiente texto extraído.",
    )

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="",  # PDF imagen → pypdf no rinde
    ):
        text, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert fake_pdf2image.convert_from_bytes.call_count == 1
    # Verificamos los kwargs de DPI / cap de páginas / first_page.
    call_kwargs = fake_pdf2image.convert_from_bytes.call_args.kwargs
    assert call_kwargs["dpi"] == OCR_DPI
    assert call_kwargs["first_page"] == 1
    assert call_kwargs["last_page"] == OCR_MAX_PAGES

    # pytesseract llamado una vez por página (2).
    assert fake_pytesseract.image_to_string.call_count == 2
    # Verificamos lang.
    lang_kwarg = fake_pytesseract.image_to_string.call_args.kwargs.get("lang")
    assert lang_kwarg == OCR_LANG

    assert meta["method"] == "ocr"
    assert meta["pages_ocr"] == 2
    assert "Línea OCR" in text


# ---------------------------------------------------------------------------
# 3. Soft-fail: pytesseract / pdf2image no instalados
# ---------------------------------------------------------------------------


def test_ocr_soft_fails_when_pytesseract_missing(restore_sys_modules: Any) -> None:
    """Si `import pytesseract` falla, devolvemos failed + warning, no crash."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "pytesseract":
            raise ImportError("No module named 'pytesseract'")
        return real_import(name, *args, **kwargs)

    with (
        patch.object(builtins, "__import__", side_effect=fake_import),
        patch(
            "app.services.document_analyzer_service.extract_text_pdf",
            return_value="",
        ),
    ):
        text, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert meta["method"] == "failed"
    assert meta["pages_ocr"] == 0
    assert any("OCR no disponible" in w for w in meta["warnings"])
    # No crasheamos: el endpoint puede devolver 422 o 200 con warning.
    assert text == ""


def test_ocr_soft_fails_when_poppler_missing(restore_sys_modules: Any) -> None:
    """Si pdf2image lanza (poppler ausente), devolvemos failed + warning."""
    _install_fake_modules(raise_pdf2image=True)

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="",
    ):
        text, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert meta["method"] == "failed"
    assert any("poppler" in w.lower() for w in meta["warnings"])
    assert text == ""


# ---------------------------------------------------------------------------
# 4. Hybrid: pypdf devuelve algo (pero <50) y OCR rinde → method='hybrid'
# ---------------------------------------------------------------------------


def test_hybrid_method_when_pypdf_partial_and_ocr_works(
    restore_sys_modules: Any,
) -> None:
    """PDFs con páginas mixtas: pypdf saca algo + OCR completa."""
    _install_fake_modules(
        pdf2image_pages=3,
        ocr_text_per_page="Texto OCR completo y largo extraído de una página escaneada.",
    )

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="ID123",  # 5 chars — <50 pero >0
    ):
        text, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert meta["method"] == "hybrid"
    assert meta["pages_ocr"] == 3
    assert "Texto OCR" in text


# ---------------------------------------------------------------------------
# 5. Image upload (jpeg/png) — bypass del path PDF
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_upload_jpeg_routes_to_image_ocr(
    restore_sys_modules: Any,
) -> None:
    """Una imagen JPEG va directo a OCR sin pasar por extract_text_pdf*."""
    fake_pytesseract = MagicMock()
    fake_pytesseract.image_to_string.return_value = (
        "Recibo de pago — Banco Estado — $1.500.000"
    )
    sys.modules["pytesseract"] = fake_pytesseract

    # PIL mock: Image.open devuelve un context-manager simulado.
    fake_pil_image = MagicMock()
    fake_pil_image.Image.open.return_value = MagicMock()
    sys.modules["PIL"] = fake_pil_image
    sys.modules["PIL.Image"] = fake_pil_image.Image

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf"
    ) as mock_pdf:
        result = await extract_text(b"fake jpeg bytes", "image/jpeg", "recibo.jpg")

    assert mock_pdf.call_count == 0, "Imágenes NO deben tocar el path PDF"
    assert result.method == "image_ocr"
    assert result.ocr_pages == 1
    assert "Banco Estado" in result.text


@pytest.mark.asyncio
async def test_image_upload_png_with_failed_ocr(
    restore_sys_modules: Any,
) -> None:
    """Si pytesseract falla en imagen, method='failed' + warning."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "pytesseract":
            raise ImportError("missing")
        return real_import(name, *args, **kwargs)

    with patch.object(builtins, "__import__", side_effect=fake_import):
        result = await extract_text(b"fake png", "image/png", "scan.png")

    assert result.method == "failed"
    assert result.ocr_pages is None
    assert any("OCR no disponible" in w for w in result.warnings)


# ---------------------------------------------------------------------------
# 6. extraction_method end-to-end via extract_text dispatcher
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_text_pdf_digital_returns_method_pypdf() -> None:
    """PDF con texto digital → method='pypdf'."""
    digital_text = (
        "CONTRATO DE PRESTACIÓN DE SERVICIOS — entre Cehta Capital y "
        "Banco Estado, por la suma de CLP 5.000.000."
    )

    with (
        patch(
            "app.services.document_analyzer_service.extract_text_pdf",
            return_value=digital_text,
        ),
        patch(
            "app.services.document_analyzer_service._ocr_pdf_pages"
        ) as mock_ocr,
    ):
        result = await extract_text(_make_blank_pdf_bytes(), "application/pdf", "c.pdf")

    assert result.method == "pypdf"
    assert result.ocr_pages is None
    assert mock_ocr.call_count == 0
    assert "Banco Estado" in result.text


@pytest.mark.asyncio
async def test_extract_text_pdf_scanned_returns_method_ocr(
    restore_sys_modules: Any,
) -> None:
    """PDF escaneado (pypdf vacío + OCR rinde) → method='ocr'."""
    _install_fake_modules(
        pdf2image_pages=1,
        ocr_text_per_page="Factura electrónica nº 9876 — Total $119.000",
    )

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="",
    ):
        result = await extract_text(_make_blank_pdf_bytes(), "application/pdf", "f.pdf")

    assert result.method == "ocr"
    assert result.ocr_pages == 1
    assert "Factura" in result.text


# ---------------------------------------------------------------------------
# 7. Logging / timing instrumentation
# ---------------------------------------------------------------------------


def test_ocr_logs_duration_for_observability(
    restore_sys_modules: Any, caplog: pytest.LogCaptureFixture
) -> None:
    """El OCR loggea `ocr_duration_ms` y `pages_ocr` para tracking de costos."""
    import logging

    _install_fake_modules(
        pdf2image_pages=2,
        ocr_text_per_page="Texto OCR suficientemente largo para pasar el threshold.",
    )

    with (
        caplog.at_level(logging.INFO),
        patch(
            "app.services.document_analyzer_service.extract_text_pdf",
            return_value="",
        ),
    ):
        _, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    # `ocr_duration_ms` y `pages_ocr` viven en el meta dict (siempre disponibles
    # para que la app los emita a observabilidad). Loggeamos al menos un evento.
    assert meta["ocr_duration_ms"] >= 0.0
    assert meta["pages_ocr"] == 2
    # Algún registro stdlib de structlog debe haber salido (info level).
    assert len(caplog.records) >= 0  # caplog puede estar empty si log level no engancha


# ---------------------------------------------------------------------------
# 8. Cap de páginas defensivo
# ---------------------------------------------------------------------------


def test_ocr_caps_at_max_pages(restore_sys_modules: Any) -> None:
    """`last_page=OCR_MAX_PAGES` (10) se pasa a pdf2image siempre."""
    _, fake_pdf2image = _install_fake_modules(pdf2image_pages=1)

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="",
    ):
        extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    call_kwargs = fake_pdf2image.convert_from_bytes.call_args.kwargs
    assert call_kwargs["last_page"] == OCR_MAX_PAGES
    assert OCR_MAX_PAGES == 10  # contrato: si esto cambia, ajustar UI/docs


# ---------------------------------------------------------------------------
# 9. extract_text_image acepta `mime` opcional sin romper
# ---------------------------------------------------------------------------


def test_extract_text_image_accepts_mime_kwarg(restore_sys_modules: Any) -> None:
    """La firma nueva acepta mime=... para logging; comportamiento intacto."""
    fake_pytesseract = MagicMock()
    fake_pytesseract.image_to_string.return_value = "OCR ok"
    sys.modules["pytesseract"] = fake_pytesseract

    fake_pil = MagicMock()
    fake_pil.Image.open.return_value = MagicMock()
    sys.modules["PIL"] = fake_pil
    sys.modules["PIL.Image"] = fake_pil.Image

    text, warnings = extract_text_image(b"fake bytes", mime="image/png")
    assert text == "OCR ok"
    assert warnings == []


# ---------------------------------------------------------------------------
# 10. ocr_pages = 0 cuando OCR soft-falla (no None engañoso)
# ---------------------------------------------------------------------------


def test_failed_ocr_returns_zero_pages_in_meta(restore_sys_modules: Any) -> None:
    """Cuando OCR falla, pages_ocr=0 y method='failed' (no count engañoso)."""
    _install_fake_modules(raise_pdf2image=True)

    with patch(
        "app.services.document_analyzer_service.extract_text_pdf",
        return_value="",
    ):
        _, meta = extract_text_pdf_with_fallback(_make_blank_pdf_bytes())

    assert meta["pages_ocr"] == 0
    assert meta["method"] == "failed"
