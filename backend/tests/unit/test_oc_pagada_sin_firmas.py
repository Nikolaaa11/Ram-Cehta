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


# ──────────────────────────────────────────────────────────────────────
# Revisión pre-deploy 2026-09-21
# ──────────────────────────────────────────────────────────────────────


class _DBFirmas:
    """Doble mínimo: guarda el SQL y devuelve los pendientes pedidos."""

    def __init__(self, filas):
        self.filas = filas
        self.sql = []

    async def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))
        filas = self.filas

        class _R:
            def scalars(self):
                return self

            def all(self):
                return filas

        return _R()

    async def scalar(self, stmt, params=None):
        q = str(stmt)
        if "auth.users" in q:
            return "gg@empresa.cl"
        if "now()" in q:
            from datetime import UTC, datetime

            return datetime(2026, 9, 21, 15, 0, tzinfo=UTC)
        raise AssertionError(q)


async def test_los_externos_que_firman_en_papel_no_cuentan_como_pendientes():
    """Los firmantes sin correo (placeholder @sin-correo…) firman a mano y
    quedan PENDIENTE para siempre: `firmar` ya los excluye al dar la OC por
    completa. Contarlos hacía que OC firmadas pidieran motivo para pagarse."""
    from app.api.v1.oc_firmas import _SIN_EMAIL_DOMAIN
    from app.api.v1.ordenes_compra import _firmas_pendientes_oc

    db = _DBFirmas(["José Antonio Maturana"])
    assert await _firmas_pendientes_oc(db, 59) == ["José Antonio Maturana"]
    sql, params = db.sql[0]
    assert "NOT LIKE" in sql and ":dom" in sql
    assert params["dom"] == _SIN_EMAIL_DOMAIN


async def test_la_constancia_tiene_motivo_quien_cuando_y_quienes_faltaban():
    from types import SimpleNamespace

    from app.api.v1.ordenes_compra import _constancia_pago_sin_firmas

    c = await _constancia_pago_sin_firmas(
        _DBFirmas([]),
        SimpleNamespace(sub="11111111-1111-1111-1111-111111111111"),
        motivo="Transferido el 15-09; José aprobó por correo",
        pendientes=["José Antonio Maturana"],
        estado_previo="en_firma",
        estado_nuevo="pagada",
        via="ficha",
    )
    assert c["motivo"].startswith("Transferido")
    assert c["firmas_pendientes"] == ["José Antonio Maturana"]
    assert c["por_email"] == "gg@empresa.cl"
    assert c["estado_previo"] == "en_firma" and c["estado_nuevo"] == "pagada"
    assert c["el"].startswith("2026-09-21")
    assert c["via"] == "ficha"


def test_el_modelo_y_el_schema_exponen_la_constancia():
    from app.models.orden_compra import OrdenCompra
    from app.schemas.orden_compra import OrdenCompraRead

    assert "pago_sin_firmas" in OrdenCompra.__table__.columns
    assert "pago_sin_firmas" in OrdenCompraRead.model_fields
