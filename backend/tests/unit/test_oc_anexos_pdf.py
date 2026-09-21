"""El anexo llega de verdad al PDF de la OC (merge real con pypdf/reportlab/Pillow).

Sin Dropbox: se prueba `_merge_cover_with_attachments`, que es lo que usa el
PDF v2 de la OC (`oc_pdf_v2_service`) con los bytes ya descargados.
"""
from __future__ import annotations

import io

import pytest

pypdf = pytest.importorskip("pypdf")
pytest.importorskip("reportlab")
PIL = pytest.importorskip("PIL")

from PIL import Image  # noqa: E402
from pypdf import PdfReader, PdfWriter  # noqa: E402

from app.services import voucher_pdf_service as vps  # noqa: E402


def _pdf(paginas: int, clave: str | None = None) -> bytes:
    w = PdfWriter()
    for _ in range(paginas):
        w.add_blank_page(width=300, height=300)
    if clave:
        w.encrypt(user_password=clave)
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def _foto_girada() -> bytes:
    """JPEG apaisado (400x200) con EXIF Orientation=6 (el celular lo sacó vertical)."""
    img = Image.new("RGB", (400, 200), (30, 140, 90))
    exif = img.getexif()
    exif[0x0112] = 6
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif)
    return out.getvalue()


def _texto(pdf: bytes) -> str:
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages)


def test_pdf_imagen_y_excel_llegan_al_pdf_de_la_oc():
    cover = _pdf(2)
    atts = [
        {"file_name": "cotizacion.pdf", "mime_type": "application/pdf", "bytes": _pdf(3)},
        {"file_name": "foto.jpg", "mime_type": "image/jpeg", "bytes": _foto_girada()},
        {"file_name": "presupuesto.xlsx",
         "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "bytes": b"PK\x03\x04..."},
    ]
    out = vps._merge_cover_with_attachments(cover, atts)
    lector = PdfReader(io.BytesIO(out))
    # 2 carátula + 3 del PDF + 1 foto + 1 hoja que nombra al Excel
    assert len(lector.pages) == 7
    assert "presupuesto.xlsx" in _texto(out)


def test_la_foto_respeta_la_orientacion_exif():
    pagina = vps._image_bytes_to_pdf_page(_foto_girada(), "foto.jpg")
    assert pagina is not None
    lector = PdfReader(io.BytesIO(pagina))
    imagenes = list(lector.pages[0].images)
    assert imagenes, "la página debe traer la foto"
    img = Image.open(io.BytesIO(imagenes[0].data))
    # Orientation=6 → se gira 90°: 400x200 pasa a 200x400 (vertical).
    assert img.height > img.width


def _primera_imagen(pagina: bytes):
    primera = next(iter(PdfReader(io.BytesIO(pagina)).pages[0].images))
    return Image.open(io.BytesIO(primera.data))


def test_un_jpeg_grande_se_achica_antes_de_entrar_al_pdf():
    grande = io.BytesIO()
    Image.new("RGB", (6000, 4000), (200, 200, 200)).save(grande, format="JPEG")
    pagina = vps._image_bytes_to_pdf_page(grande.getvalue(), "foto.jpg")
    assert max(_primera_imagen(pagina).size) <= vps._IMG_LADO_MAX


def test_una_panoramica_jpeg_tambien_se_achica():
    pano = io.BytesIO()
    Image.new("RGB", (9000, 2000), (10, 10, 10)).save(pano, format="JPEG")
    img = _primera_imagen(vps._image_bytes_to_pdf_page(pano.getvalue(), "pano.jpg"))
    assert max(img.size) <= vps._IMG_LADO_MAX


def test_png_que_no_cabe_en_memoria_no_se_decodifica():
    """72 MB decodificado (6000x4000 RGB): va como hoja, no tumba la VM."""
    grande = io.BytesIO()
    Image.new("RGB", (6000, 4000), (200, 200, 200)).save(grande, format="PNG")
    assert vps._image_bytes_to_pdf_page(grande.getvalue(), "plano.png") is None


def test_png_con_transparencia_sale_con_fondo_blanco():
    png = io.BytesIO()
    Image.new("RGBA", (300, 200), (0, 0, 0, 0)).save(png, format="PNG")
    img = _primera_imagen(vps._image_bytes_to_pdf_page(png.getvalue(), "logo.png"))
    assert img.convert("L").getextrema()[0] > 240  # blanco, no negro


def test_escaneo_de_16_bits_no_sale_en_blanco():
    esc = Image.new("I;16", (400, 300), 60000)
    for x in range(100, 300):
        for y in range(140, 160):
            esc.putpixel((x, y), 4000)  # "texto" oscuro
    out = io.BytesIO()
    esc.save(out, format="PNG")
    img = _primera_imagen(vps._image_bytes_to_pdf_page(out.getvalue(), "escaneo.png"))
    minimo, maximo = img.convert("L").getextrema()
    assert minimo < 60 and maximo > 200


def test_mpo_de_camara_se_trata_como_jpeg():
    base = Image.new("RGB", (400, 300), (50, 90, 200))
    out = io.BytesIO()
    base.save(out, format="MPO", save_all=True, append_images=[Image.new("RGB", (160, 120))])
    assert Image.open(io.BytesIO(out.getvalue())).format == "MPO"
    assert vps._image_bytes_to_pdf_page(out.getvalue(), "IMG_1234.JPG") is not None


def test_una_imagen_absurda_no_se_decodifica(monkeypatch):
    monkeypatch.setattr(vps, "_IMG_BYTES_DECODIFICADOS_MAX", 100)
    chica = io.BytesIO()
    Image.new("RGB", (20, 20)).save(chica, format="PNG")
    assert vps._image_bytes_to_pdf_page(chica.getvalue(), "x.png") is None


def test_otros_archivos_no_se_presentan_como_excel_word():
    out = vps._merge_cover_with_attachments(
        _pdf(1),
        [{"file_name": "factura.xml", "mime_type": "application/xml", "bytes": b"<DTE/>"}],
    )
    texto = _texto(out)
    assert "factura.xml" in texto and "Excel/Word" not in texto


def test_errores_no_filtran_detalles_tecnicos_al_pdf():
    cover = _pdf(1)
    atts = [
        # descarga fallida (como la deja _fetch_attachment_bytes)
        {"file_name": "perdido.pdf", "mime_type": "application/pdf", "bytes": None,
         "error": "No se pudo descargar este anexo de Dropbox al generar el PDF."},
        # PDF con contraseña que entró antes de la validación
        {"file_name": "clave.pdf", "mime_type": "application/pdf", "bytes": _pdf(1, "x")},
        # PDF basura
        {"file_name": "roto.pdf", "mime_type": "application/pdf", "bytes": b"%PDF-1.4 roto"},
    ]
    out = vps._merge_cover_with_attachments(cover, atts)
    texto = _texto(out)
    assert len(PdfReader(io.BytesIO(out)).pages) == 4
    for fuga in ("Traceback", "Error(", "Exception", "PdfRead", "FileNotDecrypted"):
        assert fuga not in texto
    assert "guardado en la plataforma" in texto
