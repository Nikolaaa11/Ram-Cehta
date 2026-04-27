"""Integration tests para `/api/v1/catalogos`.

Cubre:
- GET /catalogos/empresas: devuelve las empresas seed (TRONGKAI, REVTECH, FIP_CEHTA, ...).
- GET /catalogos: response incluye todas las listas (concepto_general, etc.).
- 401 sin token.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

EXPECTED_KEYS = {
    "empresas",
    "concepto_general",
    "concepto_detallado",
    "tipo_egreso",
    "fuente",
    "proyecto",
    "banco",
}


async def test_list_empresas_returns_seed(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/catalogos/empresas", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    codigos = {e["codigo"] for e in body}
    # schema.sql siembra al menos estas tres
    assert {"TRONGKAI", "REVTECH", "FIP_CEHTA"}.issubset(codigos)
    # estructura mínima
    sample = next(e for e in body if e["codigo"] == "TRONGKAI")
    assert "razon_social" in sample
    assert "rut" in sample
    assert "oc_prefix" in sample


async def test_get_catalogos_returns_all_lists(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/catalogos", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert EXPECTED_KEYS.issubset(body.keys())
    # empresas no debería estar vacía con el seed
    assert len(body["empresas"]) >= 3
    # los demás pueden estar vacíos sin Excel cargado, pero deben ser listas
    for k in EXPECTED_KEYS - {"empresas"}:
        assert isinstance(body[k], list)


async def test_get_catalogos_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/catalogos")
    assert r.status_code == 401


async def test_list_empresas_viewer_can_read(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/catalogos/empresas", headers=viewer_headers
    )
    assert r.status_code == 200
