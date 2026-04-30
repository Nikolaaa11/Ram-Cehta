"""Tests para `MovimientoManualCreate` — validaciones de borde.

El endpoint POST /movimientos en sí se prueba en integración. Acá
validamos las reglas del schema (mutuamente excluyentes, derivación de
periodo/anio).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.movimiento import MovimientoManualCreate


def _base_payload(**overrides) -> dict:
    base = {
        "fecha": date(2025, 6, 15),
        "empresa_codigo": "CENERGY",
        "descripcion": "Ajuste contable",
        "abono": Decimal("0"),
        "egreso": Decimal("100000"),
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------
# Reglas de monto
# ---------------------------------------------------------------------
class TestMontoValidation:
    def test_acepta_solo_abono(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(abono=Decimal("50000"), egreso=Decimal("0"))
        )
        assert m.abono == Decimal("50000")
        assert m.egreso == Decimal("0")

    def test_acepta_solo_egreso(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(abono=Decimal("0"), egreso=Decimal("75000"))
        )
        assert m.egreso == Decimal("75000")

    def test_ambos_cero_falla(self) -> None:
        with pytest.raises(ValidationError) as exc_info:
            MovimientoManualCreate.model_validate(
                _base_payload(abono=Decimal("0"), egreso=Decimal("0"))
            )
        assert "abono" in str(exc_info.value).lower()

    def test_ambos_positivos_falla(self) -> None:
        # No tiene sentido contable tener abono Y egreso en mismo movimiento
        with pytest.raises(ValidationError):
            MovimientoManualCreate.model_validate(
                _base_payload(
                    abono=Decimal("100000"), egreso=Decimal("50000")
                )
            )

    def test_negativos_fallan(self) -> None:
        with pytest.raises(ValidationError):
            MovimientoManualCreate.model_validate(
                _base_payload(abono=Decimal("-100"), egreso=Decimal("0"))
            )


# ---------------------------------------------------------------------
# Derivación de periodo / anio
# ---------------------------------------------------------------------
class TestDerivedPeriodo:
    def test_periodo_format_mm_yy(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(fecha=date(2025, 6, 15))
        )
        assert m.derived_periodo() == "06_25"
        assert m.derived_anio() == 2025

    def test_enero_padding(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(fecha=date(2025, 1, 1))
        )
        assert m.derived_periodo() == "01_25"

    def test_anio_distinto(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(fecha=date(2024, 12, 31))
        )
        assert m.derived_periodo() == "12_24"
        assert m.derived_anio() == 2024

    def test_2030(self) -> None:
        # YY wrap — 2030 es "30"
        m = MovimientoManualCreate.model_validate(
            _base_payload(fecha=date(2030, 7, 4))
        )
        assert m.derived_periodo() == "07_30"


# ---------------------------------------------------------------------
# Campos requeridos / opcionales
# ---------------------------------------------------------------------
class TestRequiredFields:
    def test_descripcion_vacia_falla(self) -> None:
        with pytest.raises(ValidationError):
            MovimientoManualCreate.model_validate(
                _base_payload(descripcion="")
            )

    def test_descripcion_500_chars_aceptada(self) -> None:
        m = MovimientoManualCreate.model_validate(
            _base_payload(descripcion="x" * 500)
        )
        assert len(m.descripcion) == 500

    def test_descripcion_501_chars_falla(self) -> None:
        with pytest.raises(ValidationError):
            MovimientoManualCreate.model_validate(
                _base_payload(descripcion="x" * 501)
            )

    def test_empresa_codigo_vacio_falla(self) -> None:
        with pytest.raises(ValidationError):
            MovimientoManualCreate.model_validate(
                _base_payload(empresa_codigo="")
            )

    def test_campos_opcionales_default_none(self) -> None:
        m = MovimientoManualCreate.model_validate(_base_payload())
        assert m.concepto_general is None
        assert m.concepto_detallado is None
        assert m.proyecto is None
        assert m.banco is None
