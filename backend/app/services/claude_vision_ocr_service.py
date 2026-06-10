"""Claude Vision OCR — fallback para PDFs escaneados que pypdf no extrae.

Cuando `parse_cartola_pdf` o `extract_text_pdf` devuelven texto vacío
(PDF escaneado/imagen), este servicio:
  1. Convierte cada página del PDF a imagen base64
  2. Manda las imágenes a Claude Sonnet 4.5 (modelo con vision)
  3. Pide extraer texto formato cartola/factura
  4. Devuelve texto reconstituido (compatible con el flow existente)

Costos estimados:
  - 1 página de cartola → ~1000 tokens input + 500 output → ~$0.015
  - 10 páginas → ~$0.15

Defensive:
  - Cap a 10 páginas por documento (cartolas suelen ser <5 páginas)
  - Soft-fail si Anthropic API falla
  - Fallback a string vacío si no se puede convertir el PDF a imagen

Dependencias:
  - pdf2image (que requiere poppler-utils en el host) — opcional
  - Si no está instalado, este servicio devuelve "not_available" y el
    flow caller marca el run como failed_ocr_required (igual que ahora).
"""
from __future__ import annotations

import base64
import logging
from io import BytesIO

from app.core.config import settings

log = logging.getLogger(__name__)


# Cap defensivo — un PDF escaneado de 100 páginas tomaría minutos y costaría
# ~$1.50 por documento. Cartolas reales son <10 páginas.
MAX_PAGES_VISION = 10


class ClaudeVisionNotAvailable(Exception):
    """Raised cuando pdf2image o anthropic no están disponibles."""


def _pdf_to_images_b64(content: bytes) -> list[str]:
    """Convierte un PDF a lista de PNGs base64.

    Requiere `pdf2image` y `poppler-utils` en el host (apt install poppler-utils).
    Si falla, raisea ClaudeVisionNotAvailable para que el caller decida.
    """
    try:
        from pdf2image import convert_from_bytes  # type: ignore[import-untyped]
    except ImportError as exc:
        raise ClaudeVisionNotAvailable(
            "pdf2image no instalado. Para activar OCR vision: "
            "pip install pdf2image + apt install poppler-utils"
        ) from exc

    try:
        images = convert_from_bytes(
            content,
            dpi=200,  # 200 DPI: balance calidad/peso (~150KB por imagen)
            fmt="png",
            first_page=1,
            last_page=MAX_PAGES_VISION,
        )
    except Exception as exc:
        raise ClaudeVisionNotAvailable(
            f"pdf2image conversion falló (poppler missing?): {exc}"
        ) from exc

    out: list[str] = []
    for img in images:
        buf = BytesIO()
        img.save(buf, format="PNG")
        out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    return out


_OCR_PROMPT_CARTOLA = """Esta es una cartola bancaria chilena escaneada.
Extraé TODO el texto que veas en formato planchado, una línea por movimiento.

Por cada movimiento incluí en la misma línea: fecha (DD/MM/YYYY), descripción
completa, y monto (con $ y separador de miles).

Si ves saldos, ponelos al final de la línea.

NO inventes datos — si una columna está vacía, ponela como —.
NO agregues comentarios ni explicaciones — solo el texto extraído.

Output esperado (ejemplo):
01/12/2025 TRANSFERENCIA RECIBIDA EMPRESA X $1.500.000 $5.000.000
05/12/2025 PAGO PROVEEDOR ACME LTDA $850.000 $4.150.000
..."""


_OCR_PROMPT_FACTURA = """Esta es una factura tributaria chilena (Boleta o Factura electrónica).
Extraé TODO el texto que veas, manteniendo estructura de bloques.

Datos críticos a preservar:
- RUT y Razón social del emisor
- Número de folio
- Fecha de emisión
- Detalle de productos/servicios
- Monto neto, IVA, Total

NO inventes datos. NO agregues comentarios."""


async def extract_text_with_claude_vision(
    content: bytes,
    *,
    document_type: str = "cartola",
) -> tuple[str, dict]:
    """Extrae texto de un PDF escaneado usando Claude Vision.

    Args:
        content: bytes del PDF
        document_type: "cartola" | "factura" — elige el prompt

    Returns:
        (texto_extraído, metadata) donde metadata tiene:
        - method: "claude_vision"
        - pages_processed: int
        - tokens_used: int (si Anthropic devuelve usage)

    Raises:
        ClaudeVisionNotAvailable: si pdf2image o anthropic no están disponibles
    """
    if not settings.anthropic_api_key:
        raise ClaudeVisionNotAvailable("ANTHROPIC_API_KEY no configurado")

    images_b64 = _pdf_to_images_b64(content)
    if not images_b64:
        return "", {"method": "claude_vision", "pages_processed": 0}

    try:
        from anthropic import AsyncAnthropic
    except ImportError as exc:
        raise ClaudeVisionNotAvailable("anthropic SDK no instalado") from exc

    client = AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=120.0, max_retries=3)  # R152FFFFFF

    prompt = (
        _OCR_PROMPT_CARTOLA if document_type == "cartola" else _OCR_PROMPT_FACTURA
    )

    # Construir mensaje multimodal con todas las páginas
    user_content: list[dict] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": img,
            },
        }
        for img in images_b64
    ]
    user_content.append({"type": "text", "text": prompt})

    try:
        message = await client.messages.create(
            model=settings.ai_chat_model,
            max_tokens=4000,
            messages=[{"role": "user", "content": user_content}],
        )
    except Exception as exc:
        log.exception("claude_vision.api_failed", error=str(exc))
        raise

    text_extracted = ""
    for block in getattr(message, "content", []) or []:
        text_attr = getattr(block, "text", None)
        if text_attr:
            text_extracted += text_attr + "\n"

    tokens_in = getattr(getattr(message, "usage", None), "input_tokens", 0) or 0
    tokens_out = (
        getattr(getattr(message, "usage", None), "output_tokens", 0) or 0
    )

    return text_extracted.strip(), {
        "method": "claude_vision",
        "pages_processed": len(images_b64),
        "tokens_input": tokens_in,
        "tokens_output": tokens_out,
        "model": settings.ai_chat_model,
    }
