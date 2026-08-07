"""Test de PARIDAD backend↔frontend del nombre de archivo del PDF de la OC.

Por qué existe además de `test_oc_filename_util.py`: aquel compara el backend
contra expectativas escritas a mano en el mismo archivo, así que no puede
detectar que el frontend se desincronice. El frontend PISA el
Content-Disposition con `a.download` en las descargas por blob — si divergen,
gana el frontend y el usuario ve un nombre distinto al que anuncia el backend
(y al del adjunto que le llega por correo).

El mecanismo es un snapshot COMPARTIDO: este test y
`frontend/lib/__tests__/oc-filename-paridad.test.ts` leen el MISMO
`oc_filename_esperado.json`. Si alguien toca una de las dos implementaciones y
no la otra, uno de los dos suites falla. Ambos corren en CI
(backend-ci.yml y frontend-ci.yml).

Para regenerar el snapshot después de un cambio deliberado de las reglas:
    python -c "import json,sys; sys.path.insert(0,'backend'); \
from app.services.oc_filename_util import oc_pdf_filename as f; \
d=json.load(open('backend/tests/fixtures/oc_filename_esperado.json',encoding='utf-8')); \
d['casos']={k:f(k) for k in d['casos']}; \
open('backend/tests/fixtures/oc_filename_esperado.json','w',encoding='utf-8')\
.write(json.dumps(d,ensure_ascii=False,indent=2))"
y después correr el suite del frontend para confirmar que sigue coincidiendo.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.oc_filename_util import (
    oc_pdf_content_disposition,
    oc_pdf_filename,
)

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
_ESPERADO = json.loads(
    (_FIXTURES / "oc_filename_esperado.json").read_text(encoding="utf-8")
)["casos"]


@pytest.mark.parametrize(("numero_oc", "esperado"), sorted(_ESPERADO.items()))
def test_paridad_con_snapshot_compartido(numero_oc: str, esperado: str) -> None:
    """El backend produce exactamente lo que dice el snapshot compartido."""
    assert oc_pdf_filename(numero_oc) == esperado


@pytest.mark.parametrize("numero_oc", sorted(_ESPERADO))
def test_header_siempre_codifica_en_latin1(numero_oc: str) -> None:
    """Starlette codifica los headers en latin-1: un carácter fuera de ese
    rango en el número de OC tiraría un 500 al descargar el PDF. El patrón
    RFC 5987 tiene que dejar el `filename=` en ASCII puro siempre."""
    oc_pdf_content_disposition(numero_oc).encode("latin-1")


def test_el_corpus_cubre_los_numeros_reales_de_produccion() -> None:
    """Guard contra un corpus que se vacíe o pierda los casos que importan.

    Estos 3 números son los que existían en producción cuando se escribió el
    helper, y son justamente los que exponían el bug original (los 3 ya
    empiezan con OC, así que anteponer el prefijo a ciegas daba 'OC-OC...').
    """
    for real in (
        "OC-FLUJO-COMPLETO-9901",
        "OC0041-PAN001-Comercializadora los Canelos jv",
    ):
        assert real in _ESPERADO, f"falta el caso real {real!r} en el corpus"
        # Ninguno debe salir con el prefijo duplicado.
        assert not _ESPERADO[real].upper().startswith("OC-OC")
