"""Unit tests para schemas V2 — F29Update, OrdenCompraUpdate, SuscripcionCreate."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.f29 import F29Update
from app.schemas.orden_compra import OrdenCompraUpdate
from app.schemas.suscripcion import SuscripcionCreate

# ---------------------------------------------------------------------------
# F29Update — cross-field validation (estado=pagado ↔ fecha_pago)
# ---------------------------------------------------------------------------


def test_f29_update_pagado_without_fecha_pago_raises() -> None:
    with pytest.raises(ValidationError) as exc:
        F29Update(estado="pagado")
    assert "fecha_pago" in str(exc.value)


def test_f29_update_pagado_with_fecha_pago_ok() -> None:
    u = F29Update(estado="pagado", fecha_pago=date(2026, 5, 1))
    assert u.estado == "pagado"
    assert u.fecha_pago == date(2026, 5, 1)


def test_f29_update_pendiente_with_fecha_pago_none_clears_it() -> None:
    """Si limpia el pago (estado→pendiente, fecha_pago=None) → ok."""
    u = F29Update(estado="pendiente", fecha_pago=None)
    assert u.estado == "pendiente"
    assert u.fecha_pago is None


def test_f29_update_partial_only_url() -> None:
    """Solo cambia comprobante_url, sin tocar estado."""
    u = F29Update(comprobante_url="https://example.com/recibo.pdf")
    assert u.estado is None
    assert u.fecha_pago is None
    assert u.comprobante_url == "https://example.com/recibo.pdf"


def test_f29_update_only_monto() -> None:
    u = F29Update(monto_a_pagar=Decimal("123456"))
    assert u.monto_a_pagar == Decimal("123456")


def test_f29_update_invalid_estado() -> None:
    with pytest.raises(ValidationError):
        F29Update(estado="basura")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# OrdenCompraUpdate — campos prohibidos ignorados
# ---------------------------------------------------------------------------


def test_oc_update_ignores_critical_fields() -> None:
    """Pydantic v2 con extra='ignore' descarta los campos no declarados.

    Garantiza que el cliente NO pueda editar numero_oc, total, estado, etc.
    aunque los mande en el body.
    """
    u = OrdenCompraUpdate.model_validate(
        {
            "observaciones": "actualizada",
            "numero_oc": "OC-HACK-999",
            "total": 99999999,
            "estado": "pagada",
            "neto": 100,
            "iva": 19,
        }
    )
    assert u.observaciones == "actualizada"
    # No existe el atributo en el modelo → garantía de que no se filtra al UPDATE
    assert not hasattr(u, "numero_oc")
    assert not hasattr(u, "total")
    assert not hasattr(u, "estado")
    assert not hasattr(u, "neto")


def test_oc_update_only_allowed_fields() -> None:
    u = OrdenCompraUpdate(
        forma_pago="Transferencia",
        plazo_pago="30 dias",
        validez_dias=60,
        observaciones="OK",
        pdf_url="https://x/y.pdf",
    )
    dump = u.model_dump(exclude_unset=True)
    assert set(dump.keys()) == {
        "forma_pago",
        "plazo_pago",
        "validez_dias",
        "observaciones",
        "pdf_url",
    }


def test_oc_update_validez_dias_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        OrdenCompraUpdate(validez_dias=0)


def test_oc_update_partial_empty_body() -> None:
    """Body vacío es válido (no-op update)."""
    u = OrdenCompraUpdate()
    assert u.model_dump(exclude_unset=True) == {}


# ---------------------------------------------------------------------------
# SuscripcionCreate
# ---------------------------------------------------------------------------


def test_suscripcion_create_basic_clp() -> None:
    s = SuscripcionCreate(
        empresa_codigo="FIP_CEHTA",
        fecha_recibo=date(2026, 4, 1),
        acciones_pagadas=Decimal("100"),
        monto_clp=Decimal("1000000"),
    )
    assert s.empresa_codigo == "FIP_CEHTA"
    assert s.firmado is False
    assert s.monto_uf is None


def test_suscripcion_create_requires_positive_acciones() -> None:
    with pytest.raises(ValidationError):
        SuscripcionCreate(
            empresa_codigo="FIP_CEHTA",
            fecha_recibo=date(2026, 4, 1),
            acciones_pagadas=Decimal("0"),
            monto_clp=Decimal("1000000"),
        )


def test_suscripcion_create_with_uf() -> None:
    s = SuscripcionCreate(
        empresa_codigo="FIP_CEHTA",
        fecha_recibo=date(2026, 4, 1),
        acciones_pagadas=Decimal("50"),
        monto_uf=Decimal("28.5"),
        monto_clp=Decimal("1100000"),
        firmado=True,
    )
    assert s.monto_uf == Decimal("28.5")
    assert s.firmado is True
