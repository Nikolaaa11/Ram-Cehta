from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.orden_compra import OCDetalleCreate, OrdenCompraCreate
from app.schemas.proveedor import ProveedorCreate, ProveedorUpdate

# ---------------------------------------------------------------------------
# ProveedorCreate — RUT validation
# ---------------------------------------------------------------------------

VALID_RUT = "77.221.203-8"
INVALID_RUT = "12.345.678-0"  # wrong check digit


def test_proveedor_create_accepts_valid_rut() -> None:
    p = ProveedorCreate(razon_social="Empresa Test", rut=VALID_RUT)
    assert p.rut == VALID_RUT


def test_proveedor_create_rejects_invalid_rut() -> None:
    with pytest.raises(ValidationError) as exc_info:
        ProveedorCreate(razon_social="Empresa Test", rut=INVALID_RUT)
    assert "RUT inválido" in str(exc_info.value)


def test_proveedor_create_formats_rut_canonically() -> None:
    # Input without dots — should be normalised to "77.221.203-8"
    p = ProveedorCreate(razon_social="Empresa Test", rut="77221203-8")
    assert p.rut == "77.221.203-8"


def test_proveedor_create_allows_none_rut() -> None:
    p = ProveedorCreate(razon_social="Empresa Test", rut=None)
    assert p.rut is None


def test_proveedor_create_omitted_rut_defaults_to_none() -> None:
    p = ProveedorCreate(razon_social="Empresa Test")
    assert p.rut is None


# ---------------------------------------------------------------------------
# ProveedorUpdate — partial update
# ---------------------------------------------------------------------------


def test_proveedor_update_partial_only_razon_social() -> None:
    u = ProveedorUpdate(razon_social="Nueva Razón Social")
    assert u.razon_social == "Nueva Razón Social"
    assert u.rut is None
    assert u.giro is None


def test_proveedor_update_all_fields_optional() -> None:
    u = ProveedorUpdate()
    assert u.razon_social is None


# ---------------------------------------------------------------------------
# OrdenCompraCreate — IVA & total computation
# ---------------------------------------------------------------------------

_ITEM = OCDetalleCreate(item=1, descripcion="Servicio", precio_unitario=Decimal("1000"), cantidad=Decimal("1"))


def _make_oc(moneda: str, neto: str) -> OrdenCompraCreate:
    return OrdenCompraCreate(
        numero_oc="OC-001",
        empresa_codigo="EMP-01",
        fecha_emision=date(2025, 1, 1),
        moneda=moneda,  # type: ignore[arg-type]
        neto=Decimal(neto),
        items=[_ITEM],
    )


def test_oc_create_iva_calculado_clp() -> None:
    oc = _make_oc("CLP", "100000")
    assert oc.iva_calculado == Decimal("19000")


def test_oc_create_total_calculado_clp() -> None:
    oc = _make_oc("CLP", "100000")
    assert oc.total_calculado == Decimal("119000")


def test_oc_create_iva_zero_for_usd() -> None:
    oc = _make_oc("USD", "1000")
    assert oc.iva_calculado == Decimal("0")


def test_oc_create_total_equals_neto_for_usd() -> None:
    oc = _make_oc("USD", "1000")
    assert oc.total_calculado == Decimal("1000")


def test_oc_create_iva_rounding() -> None:
    # 1 * 0.19 = 0.19 → rounds to 0
    oc = _make_oc("CLP", "1")
    assert oc.iva_calculado == Decimal("0")


def test_oc_create_requires_at_least_one_item() -> None:
    with pytest.raises(ValidationError):
        OrdenCompraCreate(
            numero_oc="OC-001",
            empresa_codigo="EMP-01",
            fecha_emision=date(2025, 1, 1),
            moneda="CLP",
            neto=Decimal("100000"),
            items=[],
        )
