"""Tests para f22_sync_service.

Cubre el regex de matching de filenames F22. Las funciones IO-bound
(`sync_f22_dropbox`) requieren mocks de Dropbox + DB; mejor en
integración. Acá testeamos la lógica pura del regex y casos edge.
"""
from __future__ import annotations

import pytest

from app.services.f22_sync_service import _F22_FILENAME_RE


class TestF22FilenameRegex:
    """Casos canónicos que SÍ deben matchear."""

    @pytest.mark.parametrize(
        "filename,expected_year",
        [
            ("2025.pdf", 2025),
            ("2024.pdf", 2024),
            ("F22_2025.pdf", 2025),
            ("F22-2025.pdf", 2025),
            ("F22 2025.pdf", 2025),
            ("f22_2025.pdf", 2025),  # case insensitive
            ("F22_2025_v2.pdf", 2025),
            ("2025_final.pdf", 2025),
            ("2025-presentado.pdf", 2025),
            ("2025 borrador.pdf", 2025),
            ("2025.PDF", 2025),  # uppercase ext
        ],
    )
    def test_matches_canonical(self, filename: str, expected_year: int) -> None:
        m = _F22_FILENAME_RE.match(filename)
        assert m is not None, f"Esperaba match en {filename!r}"
        assert int(m.group(1)) == expected_year

    @pytest.mark.parametrize(
        "filename",
        [
            "Borrador_2024_v2025.pdf",  # 2024 random en medio, año en sufijo
            "Plantilla.pdf",  # sin año
            "F22.pdf",  # sin año
            "informe-2025.docx",  # no-PDF
            "2025_F22.pdf",  # año primero pero raro: matchea 2025 OK
            "factura_proveedor_2024.pdf",  # NO debe matchear (no posición canónica)
            "2099_test.pdf",  # 2099 OK pero igual matcheable; documentar
        ],
    )
    def test_rejects_or_matches_correctly(self, filename: str) -> None:
        """Algunos rechazo, otros aceptables. Aquí testeo que el comportamiento
        sea predecible — específicamente:
        - filenames con año NO en posición canónica (pre-fix daban falso positivo)
          ahora se rechazan
        """
        m = _F22_FILENAME_RE.match(filename)
        if filename == "factura_proveedor_2024.pdf":
            assert m is None, "filename con año en medio NO debe matchear"
        elif filename == "Borrador_2024_v2025.pdf":
            assert m is None, "patrón de filename ambiguo NO debe matchear"
        elif filename in ("Plantilla.pdf", "F22.pdf"):
            assert m is None
        elif filename == "informe-2025.docx":
            assert m is None
        elif filename == "2025_F22.pdf":
            # Empieza con año → matchea 2025 (ok semánticamente)
            assert m is not None
            assert int(m.group(1)) == 2025
        elif filename == "2099_test.pdf":
            # Empieza con 2099 → matchea (puede ser realmente F22 2099)
            assert m is not None

    def test_does_not_match_partial_year(self) -> None:
        # 2025 con caracter inmediatamente antes (no es prefix limpio)
        # debería NO matchear
        assert _F22_FILENAME_RE.match("foo2025.pdf") is None
        assert _F22_FILENAME_RE.match("F22extra2025.pdf") is None

    def test_year_must_be_2000_2099(self) -> None:
        # El regex es `20\d{2}` — años 1999 NO entran
        assert _F22_FILENAME_RE.match("1999.pdf") is None
        assert _F22_FILENAME_RE.match("F22_1999.pdf") is None

    def test_three_digit_year_rejected(self) -> None:
        assert _F22_FILENAME_RE.match("999.pdf") is None
        assert _F22_FILENAME_RE.match("25.pdf") is None
