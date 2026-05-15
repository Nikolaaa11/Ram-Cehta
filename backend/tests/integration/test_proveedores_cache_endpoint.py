"""Integration tests — Round 48 — endpoint GET /api/v1/proveedores/cache.

Cubre el endpoint que devuelve el catálogo completo para precarga
client-side (Round 44). Tests:
- 401 sin token
- 200 con admin/finance/viewer (cualquiera autenticado puede leer)
- Devuelve solo proveedores activos
- Items mínimos: proveedor_id + razon_social (rut, direccion opcionales)
- Cache-Control header presente
- Orden alfabético por razon_social
- Nuevos proveedores creados aparecen en la siguiente llamada (no cache server-side)
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def test_cache_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/proveedores/cache")
    assert r.status_code == 401


async def test_cache_empty_devuelve_lista_vacia(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Sin proveedores en DB → []."""
    r = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_cache_devuelve_items_minimos(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Crear 2 proveedores y verificar shape de respuesta."""
    payload_a = {
        "razon_social": "ALFA SPA",
        "rut": "11.111.111-1",
        "direccion": "Av. Apoquindo 4500",
    }
    payload_b = {
        "razon_social": "BETA LTDA",
        "rut": "12.345.678-5",
        # sin direccion explícita
    }
    r1 = await test_client_with_db.post(
        "/api/v1/proveedores", json=payload_a, headers=auth_headers
    )
    assert r1.status_code == 201, r1.text
    r2 = await test_client_with_db.post(
        "/api/v1/proveedores", json=payload_b, headers=auth_headers
    )
    assert r2.status_code == 201, r2.text

    r = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=auth_headers
    )
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 2
    # Cada item tiene los 4 campos minimos.
    for it in items:
        assert "proveedor_id" in it
        assert "razon_social" in it
        assert "rut" in it
        assert "direccion" in it  # puede ser None pero la key debe estar
    # Solo esos 4 keys (no leak de campos sensibles).
    assert set(items[0].keys()) == {"proveedor_id", "razon_social", "rut", "direccion"}


async def test_cache_orden_alfabetico(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Items vienen ordenados ASC por razon_social."""
    nombres = ["ZULU LTDA", "ALFA SPA", "MIKE INC"]
    ruts = ["11.111.111-1", "12.345.678-5", "76.456.789-7"]
    for n, r_ in zip(nombres, ruts):
        await test_client_with_db.post(
            "/api/v1/proveedores",
            json={"razon_social": n, "rut": r_},
            headers=auth_headers,
        )
    r = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=auth_headers
    )
    items = r.json()
    nombres_ordenados = [it["razon_social"] for it in items]
    assert nombres_ordenados == sorted(nombres)


async def test_cache_no_devuelve_inactivos(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Proveedor soft-deleted (DELETE) no aparece en cache."""
    r1 = await test_client_with_db.post(
        "/api/v1/proveedores",
        json={"razon_social": "Deletable SpA", "rut": "11.111.111-1"},
        headers=auth_headers,
    )
    pid = r1.json()["proveedor_id"]
    # Soft-delete
    r_del = await test_client_with_db.delete(
        f"/api/v1/proveedores/{pid}", headers=auth_headers
    )
    assert r_del.status_code in (204, 200)
    r = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=auth_headers
    )
    assert r.status_code == 200
    items = r.json()
    assert not any(it["proveedor_id"] == pid for it in items)


async def test_cache_devuelve_cache_control_header(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Round 45 — Cache-Control: private, max-age=300, stale-while-revalidate=60."""
    r = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=auth_headers
    )
    assert r.status_code == 200
    cc = r.headers.get("cache-control", "")
    assert "private" in cc
    assert "max-age=300" in cc
    assert "stale-while-revalidate=60" in cc


async def test_cache_finance_y_viewer_pueden_leer(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    """Round 44 — endpoint solo requiere autenticación, no scope específico."""
    r_fin = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=finance_headers
    )
    assert r_fin.status_code == 200
    r_view = await test_client_with_db.get(
        "/api/v1/proveedores/cache", headers=viewer_headers
    )
    assert r_view.status_code == 200
