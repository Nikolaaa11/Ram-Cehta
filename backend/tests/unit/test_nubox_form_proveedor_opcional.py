"""Unit tests para Round 31 — proveedor opcional en POST /vouchers/nubox-form.

Valida que el schema `NuboxFormCreate` ahora acepta:
  - proveedor_rut + proveedor_nombre como None
  - proveedor_rut="" + proveedor_nombre=""
  - solo uno de los dos (RUT o nombre)
sin levantar `ValidationError` de Pydantic.

No probamos el endpoint completo aca (eso requiere DB + session) — solo
el schema, que es donde estaba la restriccion `min_length=8` / `min_length=1`.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.v1.vouchers_nubox_form import NuboxFormCreate, NuboxFormLine


def _payload_base(**overrides):
    """Payload mínimo valido para NuboxFormCreate. Sobrescribi con kwargs."""
    base = {
        "empresa_codigo": "TRONGKAI",
        "tipo_documento": "FACTURA",
        "numero_documento": "12345",
        "forma_pago": "TRANSFERENCIA",
        "fecha_documento": date(2026, 5, 15),
        "informacion_contable": [
            NuboxFormLine(
                comentario="Gasto X",
                cuenta_codigo="5101001",
                total=Decimal("100000"),
            )
        ],
        "informacion_financiera": [
            NuboxFormLine(
                comentario="Pago X",
                cuenta_codigo="1101001",
                total=Decimal("100000"),
            )
        ],
    }
    base.update(overrides)
    return base


def test_nubox_acepta_proveedor_none() -> None:
    """proveedor_rut=None + proveedor_nombre=None → schema valido."""
    payload = _payload_base(proveedor_rut=None, proveedor_nombre=None)
    obj = NuboxFormCreate(**payload)
    assert obj.proveedor_rut is None
    assert obj.proveedor_nombre is None


def test_nubox_acepta_proveedor_ausente() -> None:
    """Sin pasar las keys → quedan en None (default)."""
    payload = _payload_base()
    obj = NuboxFormCreate(**payload)
    assert obj.proveedor_rut is None
    assert obj.proveedor_nombre is None


def test_nubox_acepta_solo_rut_sin_nombre() -> None:
    """proveedor_rut="76.123.456-7" + proveedor_nombre=None → ok."""
    payload = _payload_base(
        proveedor_rut="76.123.456-7", proveedor_nombre=None
    )
    obj = NuboxFormCreate(**payload)
    assert obj.proveedor_rut == "76.123.456-7"
    assert obj.proveedor_nombre is None


def test_nubox_acepta_solo_nombre_sin_rut() -> None:
    """proveedor_nombre="Caja chica" + proveedor_rut=None → ok."""
    payload = _payload_base(
        proveedor_rut=None, proveedor_nombre="Caja chica"
    )
    obj = NuboxFormCreate(**payload)
    assert obj.proveedor_nombre == "Caja chica"
    assert obj.proveedor_rut is None


def test_nubox_rechaza_rut_demasiado_largo() -> None:
    """max_length=20 sigue aplicando."""
    with pytest.raises(ValidationError):
        NuboxFormCreate(
            **_payload_base(proveedor_rut="X" * 21, proveedor_nombre="OK")
        )


def test_nubox_rechaza_nombre_demasiado_largo() -> None:
    """max_length=200 sigue aplicando."""
    with pytest.raises(ValidationError):
        NuboxFormCreate(
            **_payload_base(
                proveedor_rut="76.123.456-7", proveedor_nombre="X" * 201
            )
        )
