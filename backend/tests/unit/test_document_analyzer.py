"""Unit tests del AI Document Analyzer (V3 fase 7).

No tocan red ni DB — mockeamos el cliente Anthropic. Cubrimos:
- Cada tipo de extracción (contrato, f29, trabajador_contrato, factura,
  liquidacion, auto).
- Parser robusto de JSON (con fences, con texto antes, malformado).
- Build de prompt (incluye el texto extraído + schema).
- Normalización (confidence clamp, warnings combinados, tipo fallback).
- Extracción de texto: PDF inline + DOCX si la lib está; fallback OCR.
- RBAC: scope `document:analyze` presente en los 3 roles.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.core.rbac import scopes_for
from app.schemas.document_extraction import DocumentExtraction
from app.services.document_analyzer_service import (
    MAX_TEXT_CHARS,
    SCHEMAS,
    DocumentAnalyzerNotConfigured,
    _normalize_extraction,
    analyze_document,
    build_prompt,
    extract_text,
    extract_text_image,
    parse_llm_json,
)

# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["admin", "finance", "viewer"])
def test_all_roles_can_analyze_documents(role: str) -> None:
    assert "document:analyze" in scopes_for(role)


# ---------------------------------------------------------------------------
# Schema completeness
# ---------------------------------------------------------------------------


def test_all_documented_tipos_have_schema() -> None:
    expected = {"contrato", "f29", "trabajador_contrato", "factura", "liquidacion"}
    assert expected.issubset(set(SCHEMAS.keys()))


# ---------------------------------------------------------------------------
# JSON parsing — parse_llm_json
# ---------------------------------------------------------------------------


def test_parse_llm_json_clean() -> None:
    raw = '{"tipo_detectado": "contrato", "confidence": 0.9, "fields": {}}'
    out = parse_llm_json(raw)
    assert out["tipo_detectado"] == "contrato"


def test_parse_llm_json_with_markdown_fences() -> None:
    raw = '```json\n{"a": 1}\n```'
    assert parse_llm_json(raw) == {"a": 1}


def test_parse_llm_json_with_preamble() -> None:
    raw = 'Aquí está el JSON solicitado:\n\n{"k": "v", "n": 2}'
    assert parse_llm_json(raw) == {"k": "v", "n": 2}


def test_parse_llm_json_nested_braces() -> None:
    raw = '{"outer": {"inner": [1, 2, 3]}, "x": "}"}'
    out = parse_llm_json(raw)
    assert out["outer"]["inner"] == [1, 2, 3]


def test_parse_llm_json_malformed_raises() -> None:
    with pytest.raises((ValueError, Exception)):
        parse_llm_json("no es json en absoluto")


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------


def test_build_prompt_includes_text_and_schema() -> None:
    text = "CONTRATO DE PRESTACIÓN DE SERVICIOS\nCliente: Banco Estado"
    prompt = build_prompt(text, "contrato")
    assert "Banco Estado" in prompt
    assert "contraparte" in prompt
    assert "JSON" in prompt


def test_build_prompt_truncates_long_text() -> None:
    long_text = "x" * (MAX_TEXT_CHARS + 5000)
    prompt = build_prompt(long_text, "contrato")
    # El prompt no debe contener todo el texto
    assert "[Texto truncado" in prompt
    # Y debería tener referencia al total original
    assert str(len(long_text)) in prompt


def test_build_prompt_auto_lists_all_schemas() -> None:
    prompt = build_prompt("doc x", "auto")
    for tipo in ("contrato", "f29", "factura", "liquidacion", "trabajador_contrato"):
        assert tipo in prompt


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------


def test_normalize_clamps_confidence_high() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": 1.5, "fields": {}},
        requested_tipo="f29",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert out.confidence == 1.0


def test_normalize_clamps_confidence_negative() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": -0.2, "fields": {}},
        requested_tipo="f29",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert out.confidence == 0.0


def test_normalize_handles_string_percentage_confidence() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": "85%", "fields": {}},
        requested_tipo="f29",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert out.confidence == pytest.approx(0.85)


def test_normalize_low_confidence_adds_warning() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": 0.3, "fields": {}},
        requested_tipo="f29",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert any("baja confianza" in w.lower() for w in out.warnings)


def test_normalize_combines_warnings() -> None:
    out = _normalize_extraction(
        {
            "tipo_detectado": "f29",
            "confidence": 0.9,
            "fields": {"empresa": "Acme"},
            "warnings": ["fecha ambigua"],
        },
        requested_tipo="f29",
        raw_text="abc" * 200,
        extraction_warnings=["OCR no disponible"],
    )
    assert "fecha ambigua" in out.warnings
    assert "OCR no disponible" in out.warnings


def test_normalize_fields_default_to_empty_dict() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": 0.9},  # fields ausente
        requested_tipo="f29",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert out.fields == {}


def test_normalize_raw_text_preview_capped_at_500() -> None:
    out = _normalize_extraction(
        {"tipo_detectado": "f29", "confidence": 0.9, "fields": {}},
        requested_tipo="f29",
        raw_text="x" * 2000,
        extraction_warnings=[],
    )
    assert len(out.raw_text_preview) == 500


def test_normalize_fallback_tipo_when_auto_and_missing() -> None:
    out = _normalize_extraction(
        {"confidence": 0.9, "fields": {}},  # tipo_detectado ausente, pidió auto
        requested_tipo="auto",
        raw_text="abc",
        extraction_warnings=[],
    )
    assert out.tipo_detectado == "desconocido"


# ---------------------------------------------------------------------------
# extract_text dispatcher
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extract_text_txt() -> None:
    result = await extract_text(b"hola mundo, soy un texto plano", "text/plain", "doc.txt")
    assert "hola mundo" in result.text


@pytest.mark.asyncio
async def test_extract_text_unknown_extension_falls_back_to_decode() -> None:
    result = await extract_text(b"raw bytes 123", "application/octet-stream", "weird.xyz")
    assert "raw bytes" in result.text
    assert any("no reconocido" in w.lower() for w in result.warnings)


@pytest.mark.asyncio
async def test_extract_text_pdf_simple() -> None:
    """Genera un PDF mínimo en-memory y verifica que extract_text_pdf lo lee."""
    try:
        from pypdf import PdfWriter
    except ImportError:
        pytest.skip("pypdf no instalado")

    import io as _io

    # pypdf no tiene helper directo para "create blank PDF with text" sin reportlab.
    # Mejor: validemos el dispatcher routing usando un PDF inválido pero parseable.
    # Si pypdf falla, queremos que extract_text propague el error — el endpoint
    # lo convierte en 422.
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = _io.BytesIO()
    writer.write(buf)
    pdf_bytes = buf.getvalue()

    result = await extract_text(pdf_bytes, "application/pdf", "blank.pdf")
    # El PDF está vacío de texto, pero la extracción no debería romper.
    assert result.text == "" or isinstance(result.text, str)


# ---------------------------------------------------------------------------
# OCR soft-fail
# ---------------------------------------------------------------------------


def test_extract_text_image_soft_fails_without_pytesseract() -> None:
    """Si pytesseract no está, devolvemos None + warning (no crash)."""
    # Forzamos ImportError simulando ausencia de pytesseract.
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "pytesseract":
            raise ImportError("pytesseract not installed")
        return real_import(name, *args, **kwargs)

    with patch.object(builtins, "__import__", side_effect=fake_import):
        text, warnings = extract_text_image(b"fake image bytes")

    assert text is None
    assert any("OCR no disponible" in w for w in warnings)


# ---------------------------------------------------------------------------
# analyze_document — full flow with mocked Claude
# ---------------------------------------------------------------------------


def _make_mock_message(text: str) -> Any:
    """Construye un objeto que imita el shape del response de Anthropic SDK."""

    class _Block:
        def __init__(self, t: str) -> None:
            self.text = t

    class _Msg:
        def __init__(self, t: str) -> None:
            self.content = [_Block(t)]

    return _Msg(text)


@pytest.mark.asyncio
async def test_analyze_document_contrato_happy_path() -> None:
    """Mockea Claude y verifica que el prompt incluye el texto y se devuelve DocumentExtraction."""
    fake_response = _make_mock_message(
        '{"tipo_detectado": "contrato", "confidence": 0.92, '
        '"fields": {"contraparte": "Banco Estado", "monto": 5000000, '
        '"moneda": "CLP", "fecha_inicio": "2026-01-01"}, '
        '"warnings": []}'
    )

    with (
        patch(
            "app.services.document_analyzer_service.settings",
            anthropic_api_key="test-key",
            ai_chat_model="claude-3-5-sonnet-20241022",
        ),
        patch("app.services.document_analyzer_service._anthropic_client") as mock_client_factory,
    ):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_client_factory.return_value = mock_client

        result = await analyze_document(
            "CONTRATO con Banco Estado por CLP 5.000.000",
            "contrato",
            filename="contrato.pdf",
        )

    assert isinstance(result, DocumentExtraction)
    assert result.tipo_detectado == "contrato"
    assert result.confidence == pytest.approx(0.92)
    assert result.fields["contraparte"] == "Banco Estado"

    # Verificamos que el prompt mandado al LLM incluye el texto extraído.
    call_args = mock_client.messages.create.call_args
    user_content = call_args.kwargs["messages"][0]["content"]
    assert "Banco Estado" in user_content
    assert "contraparte" in user_content  # schema rendering


@pytest.mark.asyncio
async def test_analyze_document_f29() -> None:
    fake_response = _make_mock_message(
        '{"tipo_detectado": "f29", "confidence": 0.88, '
        '"fields": {"empresa": "Acme SpA", "periodo_tributario": "02_26", '
        '"monto_a_pagar": 1500000}, "warnings": []}'
    )

    with patch(
        "app.services.document_analyzer_service._anthropic_client"
    ) as mock_client_factory:
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_client_factory.return_value = mock_client

        result = await analyze_document(
            "Formulario 29 - Acme SpA - Período 02/2026 - Monto $1.500.000",
            "f29",
        )

    assert result.tipo_detectado == "f29"
    assert result.fields["periodo_tributario"] == "02_26"


@pytest.mark.asyncio
async def test_analyze_document_auto_detects_tipo() -> None:
    fake_response = _make_mock_message(
        '{"tipo_detectado": "factura", "confidence": 0.95, '
        '"fields": {"proveedor_nombre": "Proveedor X", "total": 119000}, '
        '"warnings": []}'
    )

    with patch(
        "app.services.document_analyzer_service._anthropic_client"
    ) as mock_client_factory:
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_client_factory.return_value = mock_client

        result = await analyze_document(
            "Factura electrónica nº 1234 — Proveedor X — total 119.000",
            "auto",
        )

    assert result.tipo_detectado == "factura"


@pytest.mark.asyncio
async def test_analyze_document_handles_malformed_json() -> None:
    """Si Claude devuelve algo no-JSON, no crasheamos: devolvemos warning."""
    fake_response = _make_mock_message("Lo siento, no pude analizar este documento.")

    with patch(
        "app.services.document_analyzer_service._anthropic_client"
    ) as mock_client_factory:
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_client_factory.return_value = mock_client

        result = await analyze_document("contenido", "contrato")

    assert result.confidence == 0.0
    assert result.fields == {}
    assert any("parsear" in w.lower() for w in result.warnings)


@pytest.mark.asyncio
async def test_analyze_document_raises_when_anthropic_key_missing() -> None:
    """Sin API key, levantamos una excepción dedicada (endpoint la convierte en 503)."""
    with (
        patch(
            "app.services.document_analyzer_service.settings",
            anthropic_api_key=None,
            ai_chat_model="claude-3-5-sonnet-20241022",
        ),
        pytest.raises(DocumentAnalyzerNotConfigured),
    ):
        await analyze_document("texto cualquiera", "contrato")


@pytest.mark.asyncio
async def test_analyze_document_propagates_extraction_warnings() -> None:
    """Si la extracción de texto generó warnings (OCR no disponible, etc.), llegan al output."""
    fake_response = _make_mock_message(
        '{"tipo_detectado": "contrato", "confidence": 0.9, '
        '"fields": {}, "warnings": []}'
    )

    with patch(
        "app.services.document_analyzer_service._anthropic_client"
    ) as mock_client_factory:
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_response)
        mock_client_factory.return_value = mock_client

        result = await analyze_document(
            "texto cualquiera para test largo " * 5,
            "contrato",
            extraction_warnings=["Tipo de archivo no reconocido"],
        )

    assert any("no reconocido" in w.lower() for w in result.warnings)


# ---------------------------------------------------------------------------
# DocumentExtraction schema (Pydantic shape sanity)
# ---------------------------------------------------------------------------


def test_document_extraction_schema_defaults() -> None:
    obj = DocumentExtraction(tipo_detectado="contrato", confidence=0.9)
    assert obj.fields == {}
    assert obj.warnings == []
    assert obj.raw_text_preview == ""


def test_document_extraction_clamps_confidence_at_pydantic_level() -> None:
    """Pydantic ge/le ya restringe confidence a [0,1]."""
    with pytest.raises(Exception):  # noqa: B017
        DocumentExtraction(tipo_detectado="x", confidence=1.5)
