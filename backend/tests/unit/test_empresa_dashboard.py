"""Tests para los helpers puros de `app.api.v1.empresa`.

Sólo lógica sin DB: normalización de conceptos, mapeo a tipo, detección
de operacionales, paleta de colores y constantes.
"""
from __future__ import annotations

from app.api.v1.empresa import (
    APPLE_PALETTE,
    DEFAULT_TREEMAP_EXCLUDE,
    NO_OPERACIONAL,
    TIPO_MAP,
    categorizar_tipo,
    color_for_index,
    is_operacional,
    normalize_concepto,
)


# ---------------------------------------------------------------------
# normalize_concepto
# ---------------------------------------------------------------------
class TestNormalizeConcepto:
    def test_none_devuelve_string_vacio(self) -> None:
        assert normalize_concepto(None) == ""

    def test_string_vacio(self) -> None:
        assert normalize_concepto("") == ""

    def test_lowercases(self) -> None:
        assert normalize_concepto("Capital") == "capital"

    def test_replace_espacios_por_underscore(self) -> None:
        assert normalize_concepto("Pago de Acciones") == "pago_de_acciones"

    def test_strip(self) -> None:
        assert normalize_concepto("  Inversión  ") == "inversión"

    def test_preserve_underscores_originales(self) -> None:
        assert (
            normalize_concepto("Recurso_Humano") == "recurso_humano"
        )


# ---------------------------------------------------------------------
# categorizar_tipo
# ---------------------------------------------------------------------
class TestCategorizarTipo:
    def test_pago_de_acciones_es_capital(self) -> None:
        assert categorizar_tipo("Pago_de_Acciones") == "Capital"

    def test_capital_directo(self) -> None:
        assert categorizar_tipo("Capital") == "Capital"

    def test_inversion_con_acento(self) -> None:
        assert categorizar_tipo("Inversión") == "Tesoreria"

    def test_inversion_sin_acento(self) -> None:
        assert categorizar_tipo("Inversion") == "Tesoreria"

    def test_reversa_es_ajuste(self) -> None:
        assert categorizar_tipo("Reversa") == "Ajuste"

    def test_prestamos_con_acento(self) -> None:
        assert categorizar_tipo("Préstamos") == "Financiero"

    def test_prestamos_sin_acento(self) -> None:
        assert categorizar_tipo("Prestamos") == "Financiero"

    def test_financiamiento(self) -> None:
        assert categorizar_tipo("Financiamiento") == "Financiero"

    def test_desarrollo_proyecto(self) -> None:
        assert categorizar_tipo("Desarrollo_Proyecto") == "Operacional"

    def test_recurso_humano(self) -> None:
        assert categorizar_tipo("Recurso_Humano") == "Operacional"

    def test_administracion(self) -> None:
        assert categorizar_tipo("Administración") == "Operacional"
        assert categorizar_tipo("Administracion") == "Operacional"

    def test_operacion(self) -> None:
        assert categorizar_tipo("Operación") == "Operacional"
        assert categorizar_tipo("Operacion") == "Operacional"

    def test_categoria_desconocida_otros(self) -> None:
        assert categorizar_tipo("Misterio") == "Otros"

    def test_none_otros(self) -> None:
        assert categorizar_tipo(None) == "Otros"


# ---------------------------------------------------------------------
# is_operacional
# ---------------------------------------------------------------------
class TestIsOperacional:
    def test_pago_acciones_no_operacional(self) -> None:
        assert is_operacional("Pago_de_Acciones") is False

    def test_capital_no_operacional(self) -> None:
        assert is_operacional("Capital") is False

    def test_reversa_no_operacional(self) -> None:
        assert is_operacional("Reversa") is False

    def test_administracion_es_operacional(self) -> None:
        assert is_operacional("Administración") is True

    def test_recurso_humano_es_operacional(self) -> None:
        assert is_operacional("Recurso_Humano") is True

    def test_desarrollo_proyecto_es_operacional(self) -> None:
        assert is_operacional("Desarrollo_Proyecto") is True

    def test_inversion_es_operacional(self) -> None:
        # Inversión no está en NO_OPERACIONAL → cuenta como operacional
        # (puede discutirse, pero hoy en día solo excluimos Capital/Reversa)
        assert is_operacional("Inversión") is True

    def test_categoria_desconocida_es_operacional(self) -> None:
        # Default conservador: si no sabemos, es operacional. Mantiene KPI
        # en línea con el screenshot de Rho.
        assert is_operacional("Misterio") is True

    def test_none_no_operacional(self) -> None:
        # Sin categoría → no contamos como operacional (evita doble conteo).
        assert is_operacional(None) is False

    def test_string_vacio_no_operacional(self) -> None:
        assert is_operacional("") is False


# ---------------------------------------------------------------------
# color_for_index
# ---------------------------------------------------------------------
class TestColorForIndex:
    def test_index_cero(self) -> None:
        assert color_for_index(0) == "#1d6f42"  # cehta-green

    def test_index_uno(self) -> None:
        assert color_for_index(1) == "#0a84ff"  # sf-blue

    def test_wrap_around(self) -> None:
        # len(APPLE_PALETTE) = 10 → index 10 vuelve al inicio
        assert color_for_index(len(APPLE_PALETTE)) == APPLE_PALETTE[0]

    def test_index_grande(self) -> None:
        # 21 % 10 = 1 → sf-blue
        assert color_for_index(21) == APPLE_PALETTE[1]


# ---------------------------------------------------------------------
# Constantes / contratos
# ---------------------------------------------------------------------
class TestConstantes:
    def test_no_operacional_solo_keys_normalizadas(self) -> None:
        # NO_OPERACIONAL debe contener solo claves ya normalizadas
        for k in NO_OPERACIONAL:
            assert k == k.lower()
            assert " " not in k

    def test_tipo_map_solo_keys_normalizadas(self) -> None:
        for k in TIPO_MAP:
            assert k == k.lower()
            assert " " not in k

    def test_tipo_map_valores_son_categorias_validas(self) -> None:
        validos = {"Capital", "Tesoreria", "Ajuste", "Financiero", "Operacional"}
        for v in TIPO_MAP.values():
            assert v in validos, f"{v} no es una categoría de tipo válida"

    def test_default_treemap_exclude_keys_normalizadas(self) -> None:
        for k in DEFAULT_TREEMAP_EXCLUDE:
            assert k == k.lower()

    def test_apple_palette_tiene_10_colores(self) -> None:
        assert len(APPLE_PALETTE) == 10

    def test_apple_palette_son_hex_validos(self) -> None:
        for c in APPLE_PALETTE:
            assert c.startswith("#")
            assert len(c) == 7
