from __future__ import annotations

import pytest

from app.domain.value_objects.rut import Rut, format_rut, normalize_rut, validate_rut


@pytest.mark.parametrize(
    "raw",
    [
        "77.221.203-8",  # Trongkai
        "77.018.739-7",  # Revtech
        "76.282.088-9",  # Evoque
        "77.826.369-6",  # DTE
        "77.868.887-5",  # CSL
        "77.931.386-7",  # Rho
        "77.423.556-6",  # AFIS
        "77.751.766-K",  # FIP CEHTA ESG
        "77751766-K",
        "77751766K",
        "77751766k",
    ],
)
def test_validate_rut_valid(raw: str) -> None:
    assert validate_rut(raw) is True


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "0",
        "12345678-0",  # wrong verifier
        "77.751.766-1",  # wrong verifier for FIP CEHTA
        "abcdefgh-9",
        "77.751.766-",
    ],
)
def test_validate_rut_invalid(raw: str) -> None:
    assert validate_rut(raw) is False


def test_normalize_rut() -> None:
    assert normalize_rut("77.751.766-K") == "77751766K"
    assert normalize_rut("  77.221.203-8 ") == "772212038"


def test_format_rut() -> None:
    assert format_rut("77751766K") == "77.751.766-K"
    assert format_rut("772212038") == "77.221.203-8"


def test_rut_value_object_accepts_valid() -> None:
    r = Rut.parse("77221203-8")
    assert r.value == "77.221.203-8"
    assert r.body == "77221203"
    assert r.verifier == "8"


def test_rut_value_object_rejects_invalid() -> None:
    with pytest.raises(ValueError, match="RUT inválido"):
        Rut.parse("12345678-0")
