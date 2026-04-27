"""Integration tests para `/api/v1/suscripciones` (V2)."""
from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


def _payload(
    empresa: str = "FIP_CEHTA",
    fecha: str = "2026-04-15",
    acciones: int = 100,
    monto_clp: int = 1_000_000,
    firmado: bool = False,
) -> dict:
    return {
        "empresa_codigo": empresa,
        "fecha_recibo": fecha,
        "acciones_pagadas": acciones,
        "monto_clp": monto_clp,
        "firmado": firmado,
    }


# ---------- POST ----------
async def test_create_suscripcion_with_finance_returns_201(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/suscripciones", json=_payload(), headers=finance_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["empresa_codigo"] == "FIP_CEHTA"
    assert Decimal(body["monto_clp"]) == Decimal("1000000")
    assert body["firmado"] is False


async def test_create_suscripcion_with_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/suscripciones", json=_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_create_suscripcion_negative_acciones_returns_422(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    bad = _payload(acciones=-5)
    r = await test_client_with_db.post(
        "/api/v1/suscripciones", json=bad, headers=finance_headers
    )
    assert r.status_code == 422


# ---------- GET list ----------
async def test_list_suscripciones_filter_by_empresa(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/suscripciones",
        json=_payload(empresa="FIP_CEHTA", fecha="2026-01-15"),
        headers=finance_headers,
    )
    await test_client_with_db.post(
        "/api/v1/suscripciones",
        json=_payload(empresa="AFIS", fecha="2026-02-15"),
        headers=finance_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/suscripciones",
        params={"empresa_codigo": "FIP_CEHTA"},
        headers=viewer_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert all(item["empresa_codigo"] == "FIP_CEHTA" for item in body["items"])


async def test_list_suscripciones_viewer_can_read(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/suscripciones", headers=viewer_headers
    )
    assert r.status_code == 200


async def test_list_suscripciones_unauthenticated(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/suscripciones")
    assert r.status_code == 401


# ---------- GET /totals ----------
async def test_totals_returns_aggregated_per_empresa(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/suscripciones",
        json=_payload(empresa="FIP_CEHTA", fecha="2026-01-10", acciones=50, monto_clp=500_000),
        headers=finance_headers,
    )
    await test_client_with_db.post(
        "/api/v1/suscripciones",
        json=_payload(
            empresa="FIP_CEHTA",
            fecha="2026-02-10",
            acciones=30,
            monto_clp=300_000,
            firmado=True,
        ),
        headers=finance_headers,
    )

    r = await test_client_with_db.get(
        "/api/v1/suscripciones/totals", headers=viewer_headers
    )
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    fip = next((it for it in items if it["empresa_codigo"] == "FIP_CEHTA"), None)
    assert fip is not None
    assert Decimal(fip["total_acciones"]) >= Decimal("80")
    assert Decimal(fip["total_clp"]) >= Decimal("800000")
    assert fip["recibos_firmados"] >= 1
