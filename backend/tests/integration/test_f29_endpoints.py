"""Integration tests para `/api/v1/f29`.

Cubre:
- POST con finance → 201.
- POST con período inválido (regex MM_YY) → la API lo acepta como string libre
  pero nuestro validador de schema no lo restringe; se valida el branch real
  via UPSERT (mismo empresa+periodo reemplaza).
- GET list filtrando por empresa_codigo y estado.
- POST con viewer → 403.
- 401 sin token.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


def _f29_payload(
    empresa: str = "TRONGKAI",
    periodo: str = "04_26",
    monto: int = 500_000,
    estado: str = "pendiente",
) -> dict:
    return {
        "empresa_codigo": empresa,
        "periodo_tributario": periodo,
        "fecha_vencimiento": "2026-05-12",
        "monto_a_pagar": monto,
        "estado": estado,
    }


# ---------- POST ----------
async def test_create_f29_as_finance_returns_201(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/f29", json=_f29_payload(), headers=finance_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["empresa_codigo"] == "TRONGKAI"
    assert body["periodo_tributario"] == "04_26"
    assert Decimal(body["monto_a_pagar"]) == Decimal("500000")
    assert body["estado"] == "pendiente"


async def test_create_f29_as_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/f29", json=_f29_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_create_f29_invalid_estado_returns_422(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    bad = _f29_payload(estado="basura")
    r = await test_client_with_db.post("/api/v1/f29", json=bad, headers=finance_headers)
    assert r.status_code == 422


async def test_create_f29_upsert_same_empresa_periodo(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    """ON CONFLICT (empresa, periodo) DO UPDATE — el segundo POST reemplaza."""
    r1 = await test_client_with_db.post(
        "/api/v1/f29",
        json=_f29_payload(empresa="REVTECH", periodo="03_26", monto=100_000),
        headers=finance_headers,
    )
    assert r1.status_code == 201
    f29_id_1 = r1.json()["f29_id"]

    r2 = await test_client_with_db.post(
        "/api/v1/f29",
        json=_f29_payload(empresa="REVTECH", periodo="03_26", monto=999_999),
        headers=finance_headers,
    )
    # 201 idempotente — la API siempre devuelve 201 en POST aunque sea UPSERT
    assert r2.status_code == 201
    assert r2.json()["f29_id"] == f29_id_1
    assert Decimal(r2.json()["monto_a_pagar"]) == Decimal("999999")


# ---------- GET list ----------
async def test_list_f29_filter_by_empresa(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/f29",
        json=_f29_payload(empresa="TRONGKAI", periodo="01_26"),
        headers=finance_headers,
    )
    await test_client_with_db.post(
        "/api/v1/f29",
        json=_f29_payload(empresa="REVTECH", periodo="01_26"),
        headers=finance_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/f29", params={"empresa_codigo": "TRONGKAI"}, headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert all(item["empresa_codigo"] == "TRONGKAI" for item in body["items"])


async def test_list_f29_filter_by_estado_pendiente(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/f29",
        json=_f29_payload(empresa="TRONGKAI", periodo="02_26", estado="pendiente"),
        headers=finance_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/f29", params={"estado": "pendiente"}, headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert all(item["estado"] == "pendiente" for item in body["items"])
    assert body["total"] >= 1


async def test_list_f29_unauthenticated(test_client_with_db: AsyncClient) -> None:
    r = await test_client_with_db.get("/api/v1/f29")
    assert r.status_code == 401
