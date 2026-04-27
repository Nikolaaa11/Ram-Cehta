"""Integration tests para `/api/v1/proveedores` (CRUD + RBAC + filtros).

Cubre:
- Listado vacío y paginado.
- Creación con admin / 403 con viewer / 422 RUT inválido / 409 duplicado.
- GET por id (exists / 404 / soft-deleted = 404).
- PATCH admin / 403 viewer.
- DELETE admin / 403 finance (sólo admin).
- Filtros: search por razón social.
- 401 sin token.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

# RUT válido (verifier mod-11) — empresa real ya descartada del seed.
VALID_RUT = "11.111.111-1"
ANOTHER_VALID_RUT = "12.345.678-5"
INVALID_RUT = "12.345.678-0"

pytestmark = pytest.mark.integration


def _proveedor_payload(rut: str | None = VALID_RUT, razon: str = "Proveedor de Prueba SpA") -> dict:
    return {
        "razon_social": razon,
        "rut": rut,
        "giro": "Servicios",
        "ciudad": "Santiago",
        "email": "test@proveedor.cl",
    }


# ---------- list (empty + paginación) ----------
async def test_list_proveedores_empty(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/proveedores", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["total"] == 0
    assert body["page"] == 1
    assert body["pages"] == 0


async def test_list_proveedores_unauthenticated(test_client_with_db: AsyncClient) -> None:
    r = await test_client_with_db.get("/api/v1/proveedores")
    assert r.status_code == 401


# ---------- create ----------
async def test_create_proveedor_as_admin_returns_201(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["razon_social"] == "Proveedor de Prueba SpA"
    assert data["rut"] == VALID_RUT
    assert data["activo"] is True
    assert "proveedor_id" in data


async def test_create_proveedor_as_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/proveedores", json=_proveedor_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_create_proveedor_as_finance_succeeds(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    # finance tiene proveedor:create
    r = await test_client_with_db.post(
        "/api/v1/proveedores",
        json=_proveedor_payload(rut=ANOTHER_VALID_RUT, razon="Otro Prov SpA"),
        headers=finance_headers,
    )
    assert r.status_code == 201, r.text


async def test_create_proveedor_invalid_rut_returns_422(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/proveedores",
        json=_proveedor_payload(rut=INVALID_RUT),
        headers=auth_headers,
    )
    assert r.status_code == 422
    body = r.json()
    assert "detail" in body


async def test_create_proveedor_duplicate_rut_returns_409(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # crear el primero
    r1 = await test_client_with_db.post(
        "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
    )
    assert r1.status_code == 201
    # segundo con mismo RUT
    r2 = await test_client_with_db.post(
        "/api/v1/proveedores",
        json=_proveedor_payload(razon="Otro nombre SpA"),
        headers=auth_headers,
    )
    assert r2.status_code == 409
    assert "ya existe" in r2.json()["detail"]


# ---------- get by id ----------
async def test_get_proveedor_existing(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    pid = created["proveedor_id"]

    r = await test_client_with_db.get(f"/api/v1/proveedores/{pid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["proveedor_id"] == pid


async def test_get_proveedor_not_found(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/proveedores/999999", headers=auth_headers)
    assert r.status_code == 404


async def test_get_proveedor_soft_deleted_returns_404(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    pid = created["proveedor_id"]
    # soft delete
    rd = await test_client_with_db.delete(
        f"/api/v1/proveedores/{pid}", headers=auth_headers
    )
    assert rd.status_code == 204
    # subsequent GET → 404
    r = await test_client_with_db.get(f"/api/v1/proveedores/{pid}", headers=auth_headers)
    assert r.status_code == 404


# ---------- patch ----------
async def test_patch_proveedor_as_admin_updates(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    pid = created["proveedor_id"]

    r = await test_client_with_db.patch(
        f"/api/v1/proveedores/{pid}",
        json={"giro": "Consultoría", "ciudad": "Concepción"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["giro"] == "Consultoría"
    assert body["ciudad"] == "Concepción"


async def test_patch_proveedor_as_viewer_returns_403(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/proveedores/{created['proveedor_id']}",
        json={"giro": "Hack"},
        headers=viewer_headers,
    )
    assert r.status_code == 403


# ---------- delete ----------
async def test_delete_proveedor_as_admin_returns_204(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/proveedores/{created['proveedor_id']}", headers=auth_headers
    )
    assert r.status_code == 204
    assert r.text == ""


async def test_delete_proveedor_as_finance_returns_403(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    finance_headers: dict[str, str],
) -> None:
    # Sólo admin puede borrar (proveedor:delete no está en finance).
    created = (
        await test_client_with_db.post(
            "/api/v1/proveedores", json=_proveedor_payload(), headers=auth_headers
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/proveedores/{created['proveedor_id']}", headers=finance_headers
    )
    assert r.status_code == 403


# ---------- search + paginación ----------
async def test_list_proveedores_filter_by_search(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await test_client_with_db.post(
        "/api/v1/proveedores",
        json=_proveedor_payload(rut=VALID_RUT, razon="Acme Logistics SpA"),
        headers=auth_headers,
    )
    await test_client_with_db.post(
        "/api/v1/proveedores",
        json=_proveedor_payload(rut=ANOTHER_VALID_RUT, razon="Beta Servicios SpA"),
        headers=auth_headers,
    )

    r = await test_client_with_db.get(
        "/api/v1/proveedores", params={"search": "Acme"}, headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["razon_social"] == "Acme Logistics SpA"


async def test_list_proveedores_pagination(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # crea 3 proveedores con RUTs distintos válidos
    ruts = ["11.111.111-1", "12.345.678-5", "22.222.222-2"]
    for i, rut in enumerate(ruts):
        await test_client_with_db.post(
            "/api/v1/proveedores",
            json=_proveedor_payload(rut=rut, razon=f"Prov {i}"),
            headers=auth_headers,
        )
    r1 = await test_client_with_db.get(
        "/api/v1/proveedores", params={"page": 1, "size": 2}, headers=auth_headers
    )
    assert r1.status_code == 200
    body = r1.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2
    assert body["pages"] == 2

    r2 = await test_client_with_db.get(
        "/api/v1/proveedores", params={"page": 2, "size": 2}, headers=auth_headers
    )
    assert r2.status_code == 200
    body = r2.json()
    assert len(body["items"]) == 1
    assert body["page"] == 2
