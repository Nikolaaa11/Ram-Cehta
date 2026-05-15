"""Utilidad compartida para generar QR codes en los PDFs (Round 21).

Soft-fail: si `qrcode` no está instalado en runtime, devuelve None y el
caller debe omitir el dibujado del QR (no rompe el PDF).

Uso típico:

    from app.services.pdf_qr_util import qr_png_bytes, draw_qr_on_canvas

    png = qr_png_bytes(f"{settings.frontend_url}/vouchers/{voucher_id}")
    if png:
        draw_qr_on_canvas(canvas, png, x_mm=170, y_mm=10, size_mm=22)
"""
from __future__ import annotations

import io
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from reportlab.pdfgen.canvas import Canvas

log = logging.getLogger(__name__)


def qr_png_bytes(url: str, *, box_size: int = 4, border: int = 1) -> bytes | None:
    """Genera un PNG con el QR de `url`. Devuelve None si la lib no está.

    Parámetros:
      - box_size: tamaño de cada "celda" en pixeles. 4 = buena calidad sin peso.
      - border: módulos de quiet zone alrededor del QR. Mínimo recomendado: 1.

    Versión auto (None) → reportlab y qrcode eligen el menor tamaño que
    encaje el contenido. Error correction L (~7%) — suficiente para URLs.
    """
    if not url:
        return None
    try:
        import qrcode  # type: ignore[import-not-found]
    except ImportError:
        log.debug("qrcode_lib_not_installed, omitiendo QR en PDF")
        return None
    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=box_size,
            border=border,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as exc:  # noqa: BLE001
        log.warning("qr_generation_failed url=%s err=%s", url[:80], exc)
        return None


def draw_qr_on_canvas(
    canvas: "Canvas",
    png_bytes: bytes,
    *,
    x_mm: float,
    y_mm: float,
    size_mm: float = 22.0,
) -> None:
    """Dibuja un PNG QR sobre el canvas de reportlab en coordenadas mm.

    El origen (0,0) es bottom-left de la página en reportlab.
    """
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader

    try:
        reader = ImageReader(io.BytesIO(png_bytes))
        canvas.drawImage(
            reader,
            x_mm * mm,
            y_mm * mm,
            width=size_mm * mm,
            height=size_mm * mm,
            mask="auto",
            preserveAspectRatio=True,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("qr_draw_failed err=%s", exc)
