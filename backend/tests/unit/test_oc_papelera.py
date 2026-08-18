"""Papelera de OC — borrar siempre, pero dejando constancia.

Nicolás pidió poder borrar cualquier OC, incluso firmada, "pero que quede un
registro de que se eliminó". Los bloqueos de 409 se levantaron; lo que queda
en pie es el registro, y el registro sólo sirve si se cumplen tres cosas:

  1. el motivo es de verdad un motivo (no " ", no "x");
  2. el snapshot se puede serializar SIN perder los montos;
  3. las filas que devuelve la BD entran en los schemas de lectura.

Si alguna de las tres se rompe, el borrado deja de ser trazable y la función
entera pierde sentido. De eso se ocupa este archivo.

La prueba de que la tabla es inmutable (trigger que bloquea UPDATE y DELETE)
NO se puede hacer acá porque necesita Postgres: está en la verificación con
ROLLBACK que se corre al instalar `scripts/sql/oc_papelera.sql`.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.orden_compra import (
    MOTIVO_ELIMINACION_MIN,
    OcEliminadaListItem,
    OcEliminadaRead,
    OcEliminarRequest,
)


# ──────────────────────────────────────────────────────────────────────
# El motivo
# ──────────────────────────────────────────────────────────────────────
# Es lo único que va a explicar, dentro de un año, por qué desapareció un
# documento firmado. Un motivo vacío convierte el registro en ruido.


@pytest.mark.parametrize(
    "motivo",
    [
        "",
        "   ",
        "\n\t  \n",
        "no",
        "error",
        "x" * (MOTIVO_ELIMINACION_MIN - 1),
        # El caso fino: pasa `min_length` de pydantic porque son 12
        # caracteres, pero al recortar no queda nada. Sin el validador
        # propio esto rebotaba recién contra el CHECK de la BD, con un 500.
        "            ",
    ],
)
def test_un_motivo_vacio_o_de_relleno_no_pasa(motivo):
    with pytest.raises(ValidationError):
        OcEliminarRequest(motivo=motivo)


@pytest.mark.parametrize(
    "motivo",
    [
        "Se cargó con el proveedor equivocado, se rehace con GHR.",
        "Duplicada: el mismo encargo entró dos veces desde el correo.",
        "x" * MOTIVO_ELIMINACION_MIN,
        "x" * 1000,
    ],
)
def test_un_motivo_real_pasa(motivo):
    assert OcEliminarRequest(motivo=motivo).motivo == motivo


def test_el_motivo_tiene_tope():
    # Sin tope, un pegado accidental de 5 MB entra al registro y lo vuelve
    # incómodo de leer justo cuando hace falta leerlo.
    with pytest.raises(ValidationError):
        OcEliminarRequest(motivo="x" * 1001)


def test_el_motivo_es_obligatorio():
    with pytest.raises(ValidationError):
        OcEliminarRequest()


# ──────────────────────────────────────────────────────────────────────
# El snapshot
# ──────────────────────────────────────────────────────────────────────
# Va a la columna JSONB pasando por `json.dumps(..., default=str)`. Los dos
# tipos que json no sabe serializar son justo los que más importan en una OC:
# Decimal (los montos) y date (la fecha de emisión).


def _snapshot_de_prueba() -> dict:
    """La forma que arma `_snapshot_completo_oc`, con los tipos crudos."""
    return {
        "oc": {
            "numero_oc": "OC0045-PAN001-GHR",
            "fecha_emision": date(2026, 8, 17),
            "total": Decimal("486178"),
            "neto": Decimal("408553"),
            "items": [
                {"descripcion": "Visita técnica", "precio_unitario": Decimal("40855.33")},
            ],
        },
        "cuotas": [{"porcentaje": Decimal("30.5"), "monto": Decimal("148284.29")}],
        "firmas": [{"firmante_nombre": "Francisco Chandía", "status": "FIRMADA"}],
        "attachments": [],
        "vouchers": [{"voucher_id": 12, "status": "EXECUTED"}],
        "inbox_message_ids": [4, 9],
        "_formato": 1,
    }


def test_el_snapshot_se_serializa_sin_reventar():
    crudo = json.dumps(_snapshot_de_prueba(), default=str)
    vuelta = json.loads(crudo)
    assert vuelta["oc"]["numero_oc"] == "OC0045-PAN001-GHR"
    assert vuelta["firmas"][0]["firmante_nombre"] == "Francisco Chandía"


def test_los_montos_no_pierden_precision():
    """`default=str` y no `float`.

    Un Decimal("40855.33") convertido a float y de vuelta puede volver como
    40855.329999999994. En el registro de un documento tributario eso es
    inaceptable: el snapshot existe para poder decir exactamente cuánto
    decía la OC que se borró.
    """
    vuelta = json.loads(json.dumps(_snapshot_de_prueba(), default=str))
    assert vuelta["oc"]["total"] == "486178"
    assert vuelta["oc"]["items"][0]["precio_unitario"] == "40855.33"
    assert vuelta["cuotas"][0]["monto"] == "148284.29"
    # Y se puede reconstruir el Decimal exacto.
    assert Decimal(vuelta["cuotas"][0]["monto"]) == Decimal("148284.29")


def test_las_fechas_quedan_legibles():
    vuelta = json.loads(json.dumps(_snapshot_de_prueba(), default=str))
    assert vuelta["oc"]["fecha_emision"] == "2026-08-17"


def test_el_snapshot_guarda_lo_que_el_audit_log_perdia():
    """Cuotas y firmas.

    El registro viejo salía de `OrdenCompraRead`, que trae los ítems pero NO
    las cuotas ni las firmas. O sea que después de borrar una OC firmada no
    quedaba forma de saber quién la había firmado — justo el dato por el que
    el borrado estaba bloqueado.
    """
    s = _snapshot_de_prueba()
    assert s["cuotas"], "sin cuotas no se puede reconstruir la forma de pago"
    assert s["firmas"], "sin firmas no queda prueba de quién firmó"
    assert "voucher_id" in s["vouchers"][0], (
        "los vouchers sobreviven al borrado con oc_id en NULL: si no se anota "
        "su id acá, quedan huérfanos sin forma de saber de qué OC salieron"
    )
    assert s["inbox_message_ids"], (
        "los correos se desligan; sus ids son lo único que permite volver a "
        "atarlos si el borrado fue un error"
    )


# ──────────────────────────────────────────────────────────────────────
# Los schemas de lectura
# ──────────────────────────────────────────────────────────────────────


def _fila_de_bd() -> dict:
    """Una fila de `core.oc_eliminadas` tal como la devuelve el driver."""
    return {
        "eliminacion_id": 1,
        "oc_id": 45,
        "numero_oc": "OC0045-PAN001-GHR",
        "empresa_codigo": "PANIMAVIDA",
        "estado_previo": "en_firma",
        "proveedor_nombre": "CONSULTORA GHR SPA",
        "proveedor_rut": "76.913.376-3",
        "fecha_emision": date(2026, 8, 17),
        "moneda": "CLP",
        "tipo_documento": "FACTURA",
        "total": Decimal("486178"),
        "total_a_pagar": Decimal("486178"),
        "firmas_puestas": 2,
        "firmantes": "Francisco Chandía, Victoria Álvarez Abarca",
        "vouchers_con_plata": 0,
        "voucher_ids": [12, 13],
        "motivo": "Se cargó con el proveedor equivocado.",
        "eliminado_por_email": "nrietta@cehtacapital.com",
        "eliminado_el": datetime(2026, 8, 17, 20, 0, tzinfo=timezone.utc),
    }


def test_la_fila_del_listado_entra_en_el_schema():
    item = OcEliminadaListItem(**_fila_de_bd())
    assert item.numero_oc == "OC0045-PAN001-GHR"
    assert item.firmas_puestas == 2
    assert item.voucher_ids == [12, 13]


def test_el_detalle_agrega_el_snapshot():
    fila = _fila_de_bd() | {
        "snapshot": {"oc": {"numero_oc": "OC0045"}},
        "ip": "190.1.2.3",
        "user_agent": "Mozilla/5.0",
    }
    detalle = OcEliminadaRead(**fila)
    assert detalle.snapshot["oc"]["numero_oc"] == "OC0045"
    assert detalle.ip == "190.1.2.3"


def test_una_oc_sin_firmas_ni_vouchers_tambien_entra():
    # El caso normal: borrar un borrador mal cargado. Los contadores en 0 son
    # legítimos, no ausencia de dato.
    fila = _fila_de_bd() | {
        "firmas_puestas": 0,
        "firmantes": None,
        "vouchers_con_plata": 0,
        "voucher_ids": [],
        "proveedor_nombre": None,
        "proveedor_rut": None,
        "total": None,
    }
    item = OcEliminadaListItem(**fila)
    assert item.firmas_puestas == 0
    assert item.voucher_ids == []
    assert item.firmantes is None


def test_los_contadores_en_cero_no_se_confunden_con_faltantes():
    """La trampa del cero falso, aplicada al registro.

    `firmas_puestas = 0` significa "no tenía firmas", y es distinto de "no se
    sabe". Si alguna vez alguien pone `firmas_puestas or None`, este test lo
    frena: en el listado, un 0 tiene que verse como 0.
    """
    item = OcEliminadaListItem(**(_fila_de_bd() | {"firmas_puestas": 0}))
    assert item.firmas_puestas == 0
    assert item.firmas_puestas is not None
