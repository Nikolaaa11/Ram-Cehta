"""Integration tests para `/api/v1/movimientos`.

Cubre:
- GET sin filtros con DB vacía → page vacío.
- Filtros: empresa_codigo, anio, real_proyectado, periodo, proyecto.
- Pagination (size + page).
- 401 sin token.
- viewer permitido (movimiento:read).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def test_list_movimientos_empty(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/movimientos", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1


async def test_list_movimientos_filter_empresa_anio(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/movimientos",
        params={"empresa_codigo": "TRONGKAI", "anio": 2026},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []


async def test_list_movimientos_filter_real_proyectado(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/movimientos",
        params={"real_proyectado": "Real"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert all(m["real_proyectado"] == "Real" for m in body["items"])


async def test_list_movimientos_filter_periodo_proyecto(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/movimientos",
        params={"periodo": "04_26", "proyecto": "General"},
        headers=auth_headers,
    )
    assert r.status_code == 200


async def test_list_movimientos_pagination_params_validated(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # size > 200 (cap) → 422
    r = await test_client_with_db.get(
        "/api/v1/movimientos", params={"size": 500}, headers=auth_headers
    )
    assert r.status_code == 422

    # page < 1 → 422
    r2 = await test_client_with_db.get(
        "/api/v1/movimientos", params={"page": 0}, headers=auth_headers
    )
    assert r2.status_code == 422


async def test_list_movimientos_viewer_can_read(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/movimientos", headers=viewer_headers)
    assert r.status_code == 200


async def test_list_movimientos_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/movimientos")
    assert r.status_code == 401
