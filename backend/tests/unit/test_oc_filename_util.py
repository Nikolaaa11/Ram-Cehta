"""Unit tests para app/services/oc_filename_util.py (OC-FILENAME).

El cliente pidió que el PDF de la OC se descargue con un nombre que empiece
con "OC" en mayúscula. El riesgo real no es la mayúscula sino los bordes:

- Las 3 OCs vivas en producción YA empiezan con "OC"
  ('OC0041-PAN001-Comercializadora los Canelos jv', 'OC-FLUJO-COMPLETO-9901',
  'OC-FLUJO-COMPLETO-9900') → anteponer el prefijo a ciegas daba 'OC-OC0041-...'.
- Los números los tipea el usuario: traen espacios, pueden traer tildes
  (Panimávida) y podrían traer caracteres que Windows prohíbe en un filename.
- Starlette codifica los headers en latin-1: un carácter fuera de latin-1 en
  el Content-Disposition tira un 500 al descargar.
"""
from __future__ import annotations

import pytest

from app.services.oc_filename_util import (
    oc_pdf_content_disposition,
    oc_pdf_filename,
)

# ── Prefijo "OC" ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("numero", "esperado"),
    [
        # Números REALES de producción — no deben duplicar el prefijo.
        ("OC-FLUJO-COMPLETO-9901", "OC-FLUJO-COMPLETO-9901.pdf"),
        ("OC-FLUJO-COMPLETO-9900", "OC-FLUJO-COMPLETO-9900.pdf"),
        ("OC0041-PAN001", "OC0041-PAN001.pdf"),
        # Prefijo presente pero en minúscula → se normaliza, no se duplica.
        ("oc0041-PAN001", "OC0041-PAN001.pdf"),
        ("oC-123", "OC-123.pdf"),
        # "OC" pelado.
        ("OC", "OC.pdf"),
    ],
)
def test_numero_que_ya_empieza_con_oc_no_duplica_prefijo(
    numero: str, esperado: str
) -> None:
    assert oc_pdf_filename(numero) == esperado


@pytest.mark.parametrize(
    ("numero", "esperado"),
    [
        ("1234", "OC-1234.pdf"),
        ("2026-001", "OC-2026-001.pdf"),
        ("PAN001-42", "OC-PAN001-42.pdf"),
        # 'OCTUBRE' NO es el prefijo: OC seguido de letra no cuenta.
        ("OCTUBRE-01", "OC-OCTUBRE-01.pdf"),
    ],
)
def test_numero_sin_prefijo_recibe_oc_mayuscula(
    numero: str, esperado: str
) -> None:
    assert oc_pdf_filename(numero) == esperado


def test_numero_entero_no_rompe() -> None:
    """El outbox cae al oc_id (int) cuando la OC no tiene número cargado."""
    assert oc_pdf_filename(28) == "OC-28.pdf"


# ── Espacios ──────────────────────────────────────────────────────────────


def test_numero_con_espacios_colapsa_a_guion_bajo() -> None:
    """Número real de PANIMAVIDA: viene con espacios en el nombre del prov."""
    assert (
        oc_pdf_filename("OC0041-PAN001-Comercializadora los Canelos jv")
        == "OC0041-PAN001-Comercializadora_los_Canelos_jv.pdf"
    )


def test_espacios_multiples_y_bordes_se_limpian() -> None:
    assert oc_pdf_filename("  1234   con    espacios  ") == (
        "OC-1234_con_espacios.pdf"
    )


# ── Tildes ────────────────────────────────────────────────────────────────


def test_numero_con_tildes_conserva_acentos_en_el_nombre() -> None:
    """El nombre que ve el usuario mantiene la tilde (Panimávida)."""
    assert (
        oc_pdf_filename("OC-2026-Panimávida") == "OC-2026-Panimávida.pdf"
    )


def test_tildes_se_pliegan_a_ascii_en_el_fallback_del_header() -> None:
    """`filename=` va sin tilde; `filename*=` lleva el nombre real UTF-8."""
    header = oc_pdf_content_disposition("OC-2026-Panimávida")
    assert 'filename="OC-2026-Panimavida.pdf"' in header
    assert "filename*=UTF-8''OC-2026-Panim%C3%A1vida.pdf" in header


# ── Caracteres inválidos de Windows ───────────────────────────────────────


def test_caracteres_invalidos_de_windows_se_reemplazan() -> None:
    r"""\ / : * ? " < > | no pueden llegar a un nombre de archivo."""
    assert oc_pdf_filename('12/34\\56:78*90?A"B<C>D|E') == (
        "OC-12-34-56-78-90-A-B-C-D-E.pdf"
    )


def test_caracteres_de_control_se_reemplazan() -> None:
    assert oc_pdf_filename("123\x00\x1f456") == "OC-123--456.pdf"


def test_numero_solo_de_caracteres_invalidos_cae_al_fallback() -> None:
    assert oc_pdf_filename("///") == "OC.pdf"


@pytest.mark.parametrize("numero", [None, "", "   "])
def test_numero_vacio_cae_al_fallback(numero: object) -> None:
    assert oc_pdf_filename(numero) == "OC.pdf"


def test_numero_cero_no_se_pierde() -> None:
    """Chequeo `is not None`/vacío explícito, no `or`: 0 es un valor legítimo.

    Mismo patrón que el bug del IVA 0% que se mostraba como 19%.
    """
    assert oc_pdf_filename(0) == "OC-0.pdf"
    assert oc_pdf_filename("0") == "OC-0.pdf"


def test_no_termina_en_punto_ni_espacio() -> None:
    """Windows rechaza nombres cuyo stem termina en punto o espacio."""
    assert oc_pdf_filename("1234. ") == "OC-1234.pdf"


def test_numero_absurdamente_largo_se_trunca() -> None:
    filename = oc_pdf_filename("X" * 500)
    assert filename.endswith(".pdf")
    assert filename.startswith("OC-XXX")
    assert len(filename) <= 124  # 120 de stem + ".pdf"


# ── Content-Disposition ───────────────────────────────────────────────────


def test_content_disposition_tiene_ambos_filenames() -> None:
    header = oc_pdf_content_disposition("OC-FLUJO-COMPLETO-9901")
    assert header == (
        'attachment; filename="OC-FLUJO-COMPLETO-9901.pdf"; '
        "filename*=UTF-8''OC-FLUJO-COMPLETO-9901.pdf"
    )


@pytest.mark.parametrize(
    "numero",
    [
        "OC-2026-Panimávida",          # latin-1 OK pero con tilde
        "OC-2026-—guion-largo",        # em dash: FUERA de latin-1
        "OC-2026-日本",                 # CJK: fuera de latin-1
        "OC-2026-🚀",                   # emoji: fuera de latin-1
    ],
)
def test_content_disposition_siempre_es_latin1_encodable(numero: str) -> None:
    """Starlette codifica headers en latin-1: esto es lo que evitaba el 500."""
    header = oc_pdf_content_disposition(numero)
    header.encode("latin-1")  # no debe levantar UnicodeEncodeError


def test_content_disposition_no_rompe_las_comillas_del_header() -> None:
    """Una comilla en el número no puede cerrar el quoted-string del header."""
    header = oc_pdf_content_disposition('12"34')
    assert '"' not in header.split('filename="', 1)[1].split('"', 1)[0]


def test_fallback_ascii_nunca_queda_vacio() -> None:
    """Si el número no tiene NADA convertible a ASCII, igual hay filename."""
    header = oc_pdf_content_disposition("日本語")
    assert 'filename="OC.pdf"' in header


# ── Contrato con el frontend ──────────────────────────────────────────────


def test_filename_del_header_coincide_con_el_utf8() -> None:
    """`filename*` (lo que usa el navegador) == lo que pone el frontend en
    `a.download` (frontend/lib/oc-filename.ts). Si esto se rompe, backend y
    frontend vuelven a divergir."""
    numero = "OC0041-PAN001-Comercializadora los Canelos jv"
    esperado = oc_pdf_filename(numero)
    header = oc_pdf_content_disposition(numero)
    assert f"filename*=UTF-8''{esperado}" in header
