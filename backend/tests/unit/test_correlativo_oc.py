"""El correlativo automático, probado contra los formatos REALES.

Cada empresa numera distinto y ninguna coincide con otra. Los casos de este
archivo NO son inventados: son los números que hay hoy en producción. Si
alguien "simplifica" el algoritmo a "tomá el último grupo de dígitos", DTE
salta acá; si lo simplifica a "tomá el primero", salta PANIMAVIDA.
"""
from __future__ import annotations

import pytest

from app.domain.value_objects.correlativo_oc import siguiente_numero_oc


# ──────────────────────────────────────────────────────────────────────
# Los seis formatos que existen en producción
# ──────────────────────────────────────────────────────────────────────


def test_tecmavida_contador_al_final():
    s = siguiente_numero_oc(
        ["OC-T&E-0004", "OC-T&E-0003", "OC-T&E-0002", "OC-T&E-0001"]
    )
    assert s.numero == "OC-T&E-0005"


def test_evoque_contador_al_final_con_puntos():
    s = siguiente_numero_oc(["OC-EE.ADM.0015", "OC-EE.ADM.0014"])
    assert s.numero == "OC-EE.ADM.0016"


def test_dte_el_ano_no_es_el_contador():
    """El caso que rompe "tomá el primer grupo de dígitos".

    En `OC-2026-020` el 2026 es el año. Con un solo número cargado se usa el
    último grupo, que acá es el correcto.
    """
    s = siguiente_numero_oc(["OC-2026-020"])
    assert s.numero == "OC-2026-021"


def test_dte_con_dos_numeros_confirma_cual_cambia():
    # Con dos números, el año se repite y el contador cambia: queda
    # identificado sin ambigüedad.
    s = siguiente_numero_oc(["OC-2026-020", "OC-2026-019"])
    assert s.numero == "OC-2026-021"


def test_panimavida_contador_adelante():
    """El caso que rompe "tomá el último grupo de dígitos".

    `OC0051-PAN001-...`: el contador es el 0051 y el 001 de PAN001 es parte
    del código de centro. Se deduce porque entre dos OC consecutivas el que
    cambia es el primero.
    """
    s = siguiente_numero_oc([
        "OC0051-PAN001-E_Retamal Modulo Sanitario",
        "OC0050-PAN001-E_Retamal Estanque HEA",
    ])
    assert s.numero.startswith("OC0052-PAN001-")


def test_panimavida_no_arrastra_la_descripcion_de_la_oc_anterior():
    """Lo que sigue al contador se conserva sólo si es FIJO.

    `-PAN001-` se repite en todas y se conserva. "E_Retamal Modulo Sanitario"
    es de esa OC puntual: arrastrarlo haría que la OC nueva se llame como la
    vieja, y el número es la identidad del documento.
    """
    s = siguiente_numero_oc([
        "OC0051-PAN001-E_Retamal Modulo Sanitario",
        "OC0050-PAN001-E_Retamal Estanque HEA",
    ])
    assert "Modulo Sanitario" not in s.numero
    assert "Estanque" not in s.numero
    # Se conserva `-PAN001-`, que es la parte FIJA, y se corta ahí. El
    # recorte usa sólo separadores estructurales (`-./`): incluyendo `_` la
    # cola se cortaba dentro de "E_Retamal" y quedaba `-PAN001-E_`, que no
    # es el borde de nada.
    assert s.numero == "OC0052-PAN001-"
    assert not s.numero.endswith(" "), "un número de documento no termina en blanco"


def test_revtech_numero_simple():
    assert siguiente_numero_oc(["OC-100"]).numero == "OC-101"


def test_ciclo_respeta_el_formato_aunque_tenga_una_errata():
    """`0C-2` empieza con un CERO, no con la letra O.

    Es una errata de carga, pero es SU número. Corregirlo desde el código
    rompería la continuidad de su numeración y además pisaría una decisión
    que no es del sistema. Se propone el siguiente en el mismo formato y la
    persona lo edita si quiere.
    """
    s = siguiente_numero_oc(["0C-2"])
    assert s.numero == "0C-3"


# ──────────────────────────────────────────────────────────────────────
# El caso que descubrió la carga con atraso
# ──────────────────────────────────────────────────────────────────────


def test_usa_el_MAYOR_contador_no_el_del_mas_reciente():
    """En producción hay OC0047..OC0051 y, cargada DESPUÉS, una OC0023.

    Seguir del "más reciente" propondría OC0024, que colisiona con toda la
    serie. El contador tiene que salir del máximo.
    """
    s = siguiente_numero_oc([
        "OC0023-PAN001-Geolem EIRL",       # la más reciente por fecha de carga
        "OC0051-PAN001-E_Retamal Modulo",
        "OC0050-PAN001-E_Retamal Estanque",
    ])
    assert s.numero.startswith("OC0052")


def test_nunca_propone_un_numero_ya_usado():
    # Aunque el máximo + 1 esté ocupado (carga desordenada), sigue buscando.
    s = siguiente_numero_oc(["OC-5", "OC-6", "OC-7"])
    assert s.numero == "OC-8"


def test_las_eliminadas_tambien_ocupan_su_numero():
    """Un número que se usó y se borró NO se reutiliza.

    El PDF pudo haber salido al proveedor. Que la fila ya no esté en la tabla
    no significa que el documento no exista en el mundo.
    """
    # La lista que recibe la función ya viene con vivas + eliminadas.
    s = siguiente_numero_oc(["OC-T&E-0004", "OC-T&E-0003"])
    assert s.numero == "OC-T&E-0005"
    assert s.numero not in ("OC-T&E-0004", "OC-T&E-0003")


# ──────────────────────────────────────────────────────────────────────
# El ancho del contador
# ──────────────────────────────────────────────────────────────────────


def test_conserva_los_ceros_de_relleno():
    assert siguiente_numero_oc(["OC-0009"]).numero == "OC-0010"
    assert siguiente_numero_oc(["OC-009"]).numero == "OC-010"
    assert siguiente_numero_oc(["OC-9"]).numero == "OC-10"


def test_al_desbordar_el_ancho_no_recorta_el_numero():
    # 4 dígitos y el contador llega a 10000: se prefiere un número más largo
    # antes que uno truncado o repetido.
    assert siguiente_numero_oc(["OC-9999"]).numero == "OC-10000"


# ──────────────────────────────────────────────────────────────────────
# Bordes
# ──────────────────────────────────────────────────────────────────────


def test_empresa_sin_ninguna_oc_arranca_en_0001():
    s = siguiente_numero_oc([], oc_prefix="OC")
    assert s.numero == "OC-0001"
    assert s.base is None


def test_empresa_sin_oc_y_sin_prefijo_cargado():
    # `oc_prefix` es NULL en 5 empresas (AFIS, CEHTA, CENERGY, FIP_CEHTA...).
    assert siguiente_numero_oc([], oc_prefix=None).numero == "OC-0001"
    assert siguiente_numero_oc([], oc_prefix="   ").numero == "OC-0001"


def test_un_numero_sin_ninguna_cifra_no_se_inventa():
    s = siguiente_numero_oc(["OC-URGENTE"])
    assert s.numero == "OC-URGENTE"
    assert "no se puede deducir" in s.motivo


@pytest.mark.parametrize("basura", [[""], ["   "], ["", "  ", "\n"]])
def test_lista_de_vacios_es_lo_mismo_que_lista_vacia(basura):
    assert siguiente_numero_oc(basura, oc_prefix="OC").numero == "OC-0001"


def test_la_sugerencia_explica_de_donde_salio():
    # Una sugerencia sin motivo se acepta a ciegas, y acá lo que se acepta a
    # ciegas es la identidad de un documento tributario.
    s = siguiente_numero_oc(["OC-T&E-0004", "OC-T&E-0003"])
    assert s.motivo
    assert "OC-T&E-0004" in s.motivo
    assert s.base == "OC-T&E-0004"


def test_nunca_lanza():
    # Se la llama desde un endpoint que el formulario consulta en cada
    # cambio de empresa: una excepción acá dejaría la pantalla sin número.
    for entrada in ([], [""], ["---"], ["...."], ["0"], ["99999999999999999999"]):
        siguiente_numero_oc(entrada)  # no debe lanzar


# ──────────────────────────────────────────────────────────────────────
# El defecto que apareció al correrlo contra los datos reales
# ──────────────────────────────────────────────────────────────────────


def test_una_numeracion_VIEJA_de_la_misma_empresa_no_contamina_el_contador():
    """El caso de EVOQUE, que la primera versión resolvía mal.

    Hoy numera `OC-EE.ADM.0015`, pero arrastra una OC de una numeración
    anterior: `OC-2026-13`. Buscando "el máximo del grupo 0" entre todos sus
    números, el **2026 del año** ganaba y la sugerencia saltaba a
    `OC-EE.ADM.2027`.

    El máximo sólo puede salir de números de la MISMA serie: mismo esqueleto
    hasta el contador (`OC-EE.ADM.#` ≠ `OC-#`).
    """
    s = siguiente_numero_oc(["OC-EE.ADM.0015", "OC-EE.ADM.0014", "OC-2026-13"])
    assert s.numero == "OC-EE.ADM.0016", (
        f"la numeración vieja contaminó el contador: salió {s.numero}"
    )


def test_la_serie_ignora_lo_que_venga_DESPUES_del_contador():
    """Lo contrario del test anterior, y es lo que hace falta para PANIMAVIDA.

    Ahí cada OC termina con su propia descripción, así que exigir que los
    números sean idénticos dejaría fuera a todos y el contador nunca
    avanzaría. Lo que tiene que coincidir es el esqueleto HASTA el contador.
    """
    s = siguiente_numero_oc([
        "OC0049-PAN001-E_Retamal Radier Estanque",
        "OC0051-PAN001-E_Retamal Modulo Sanitario",
        "OC0023-PAN001-Geolem EIRL",
        "OC0046-PAN001-Implementos SA",
    ])
    assert s.numero.startswith("OC0052")


def test_los_formatos_reales_de_produccion_no_colisionan():
    """Barrido sobre los números que hay hoy, empresa por empresa.

    Es la prueba que encontró el defecto de EVOQUE: ningún caso sintético lo
    mostraba, porque nadie inventa una empresa que cambió de formato de
    numeración a mitad de camino.
    """
    produccion = {
        "PANIMAVIDA": ["OC0049-PAN001-E_Retamal Radier Estanque",
                       "OC0051-PAN001-E_Retamal Modulo Sanitario",
                       "OC0023-PAN001-Geolem EIRL"],
        "TECMAVIDA": ["OC-T&E-0004", "OC-T&E-0003", "OC-PRUEBA-TECMAVIDA"],
        "EVOQUE": ["OC-EE.ADM.0015", "OC-EE.ADM.0014", "OC-2026-13"],
        "DTE": ["OC-2026-020"],
        "REVTECH": ["OC-100"],
        "CICLO": ["0C-2"],
        "RHO": ["OC-FLUJO-COMPLETO-9900", "OC-FLUJO-COMPLETO-9901"],
        "AFIS": [],
    }
    esperado = {
        "PANIMAVIDA": "OC0052-PAN001-",
        "TECMAVIDA": "OC-T&E-0005",
        "EVOQUE": "OC-EE.ADM.0016",
        "DTE": "OC-2026-021",
        "REVTECH": "OC-101",
        "CICLO": "0C-3",
        "RHO": "OC-FLUJO-COMPLETO-9902",
        "AFIS": "OC-0001",
    }
    for empresa, numeros in produccion.items():
        s = siguiente_numero_oc(numeros, "OC")
        assert s.numero == esperado[empresa], f"{empresa}: salió {s.numero}"
        assert s.numero not in numeros, f"{empresa}: propuso uno ya usado"
