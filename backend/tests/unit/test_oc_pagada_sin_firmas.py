"""Marcar pagada una OC con firmas pendientes — sólo con motivo.

TECMAVIDA tenía tres OC ya pagadas al proveedor trabadas en `en_firma`
porque un firmante nunca entró a la plataforma. Se permite marcarlas
pagadas, pero dejando constancia: motivo obligatorio + quiénes no firmaron.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.v1.ordenes_compra import (
    _MOTIVO_PAGO_SIN_FIRMAS_MIN,
    _motivo_pago_sin_firmas_invalido,
)
from app.schemas.bulk import BulkUpdateEstadoRequest
from app.schemas.orden_compra import EstadoUpdateRequest


def test_sin_firmas_pendientes_no_pide_motivo():
    assert _motivo_pago_sin_firmas_invalido(None, [], "pagada") is None


@pytest.mark.parametrize(
    "motivo",
    [None, "", "   ", "ok", "x" * (_MOTIVO_PAGO_SIN_FIRMAS_MIN - 1),
     # 12 caracteres pero al recortar son 3: no es un motivo.
     "    pag     "],
)
def test_con_firmas_pendientes_un_motivo_de_relleno_no_pasa(motivo):
    msg = _motivo_pago_sin_firmas_invalido(motivo, ["José Maturana"], "pagada")
    assert msg is not None
    # El mensaje dice QUIÉN falta: es lo que el usuario necesita para decidir.
    assert "José Maturana" in msg
    assert "1 firma pendiente" in msg
    assert "pagada" in msg


def test_con_firmas_pendientes_y_motivo_real_pasa():
    motivo = "Proveedor pagado por transferencia el 15-09; José no firmó en la app"
    assert _motivo_pago_sin_firmas_invalido(motivo, ["José Maturana"], "pagada") is None


def test_mensaje_en_plural_y_recortado_a_cinco_nombres():
    nombres = [f"Firmante {i}" for i in range(7)]
    msg = _motivo_pago_sin_firmas_invalido(None, nombres, "parcial")
    assert "7 firmas pendientes" in msg
    assert "Firmante 4" in msg and "Firmante 5" not in msg
    assert "…" in msg
    assert "parcial" in msg


def test_los_schemas_aceptan_motivo_opcional():
    assert EstadoUpdateRequest(estado="pagada").motivo is None
    assert EstadoUpdateRequest(estado="pagada", motivo="x" * 20).motivo == "x" * 20
    assert BulkUpdateEstadoRequest(ids=[1], estado="pagada").motivo is None
    assert BulkUpdateEstadoRequest(ids=[1], estado="pagada", motivo="abc").motivo == "abc"


def test_el_motivo_tiene_techo():
    with pytest.raises(ValidationError):
        EstadoUpdateRequest(estado="pagada", motivo="x" * 501)
