"""Unit tests para app/services/pdf_qr_util.py (Round 21).

Verifica:
- qr_png_bytes() devuelve PNG válido cuando hay URL + lib disponible
- qr_png_bytes(None/"") devuelve None
- Soft-fail si qrcode no está instalado (simulado via monkeypatch)
- draw_qr_on_canvas() no crashea con bytes válidos
"""
from __future__ import annotations

import io

import pytest

from app.services import pdf_qr_util


def _qrcode_available() -> bool:
    try:
        import qrcode  # noqa: F401
    except ImportError:
        return False
    return True


@pytest.mark.skipif(not _qrcode_available(), reason="qrcode lib no instalada")
def test_qr_png_bytes_genera_png_valido() -> None:
    """URL → PNG bytes con header PNG válido."""
    png = pdf_qr_util.qr_png_bytes("https://cehta-capital.vercel.app/vouchers/123")
    assert png is not None
    # Magic header PNG: 89 50 4E 47 0D 0A 1A 0A
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    # No vacío
    assert len(png) > 100


def test_qr_png_bytes_url_vacia_devuelve_none() -> None:
    """URL vacía → None (no genera QR trivial)."""
    assert pdf_qr_util.qr_png_bytes("") is None
    assert pdf_qr_util.qr_png_bytes(None) is None  # type: ignore[arg-type]


def test_qr_png_bytes_soft_fail_sin_qrcode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Si import qrcode falla, devuelve None sin crashear."""
    import builtins
    real_import = builtins.__import__

    def fake_import(name: str, *args, **kwargs):
        if name == "qrcode":
            raise ImportError("simulated: qrcode not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    result = pdf_qr_util.qr_png_bytes("https://example.com")
    assert result is None


@pytest.mark.skipif(not _qrcode_available(), reason="qrcode lib no instalada")
def test_draw_qr_on_canvas_no_crashea_con_bytes_validos() -> None:
    """draw_qr_on_canvas con un canvas reportlab real no levanta excepción."""
    from reportlab.pdfgen.canvas import Canvas

    png = pdf_qr_util.qr_png_bytes("https://cehta.app/oc/42")
    assert png is not None

    buf = io.BytesIO()
    canv = Canvas(buf)
    # No debe lanzar
    pdf_qr_util.draw_qr_on_canvas(canv, png, x_mm=170, y_mm=10, size_mm=20)
    canv.save()
    # Output PDF contiene la imagen embedded → bytes no vacíos
    assert len(buf.getvalue()) > 500


def test_draw_qr_on_canvas_bytes_invalidos_no_crashea() -> None:
    """Si los bytes no son PNG válido, el helper loggea y sigue (no excepción)."""
    from reportlab.pdfgen.canvas import Canvas

    buf = io.BytesIO()
    canv = Canvas(buf)
    # No debe lanzar incluso con basura
    pdf_qr_util.draw_qr_on_canvas(canv, b"not-a-png", x_mm=170, y_mm=10, size_mm=20)
    canv.save()
