"""Integration tests para `/api/v1/policies-fondo` (V5).

Cubre POST/GET/PATCH (NO hay DELETE intencional — políticas se derogan
vía `estado='derogada'`, no se borran).

Reglas de auth:
- read: cualquier usuario autenticado
- create / update: scope `legal:write`

Pre-requisito: la tabla `core.policies_fondo` se crea en
`_v5_schema` (importado vía conftest_v5).

Si no hay Postgres disponible (`TEST_DATABASE_URL` o equivalente), TODO
este módulo skipea silenciosamente vía el `_engine` fixture base.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

# Importamos los fixtures V5 — pytest los registra al importarlos acá.
from tests.integration.conftest_v5 import (  # noqa: F401
    _grant_legal_write,
    _v5_schema,
)

pytestmark = pytest.mark.integration


def _payload(
    tipo: str = "reglamento_interno",
    version: str = "v1.0",
    nombre: str = "Reglamento Interno FIP CEHTA",
) -> dict:
    return {
        "tipo": tipo,
        "nombre": nombre,
        "version": version,
        "fecha_aprobacion": "2026-01-15",
        "fecha_vigencia_desde": "2026-02-01",
        "fecha_proxima_revision": "2027-01-15",
        "aprobado_por": "Directorio AFIS - Acta N°15",
        "dropbox_path": "/Cehta/02-Politicas/reglamento_interno_v1.0.pdf",
        "hash_sha256": "abc123",
        "estado": "vigente",
        "metadata": {"firmantes": ["Guido Rietta"]},
    }


# ---------- POST ----------
async def test_post_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
    _v5_schema,
) -> None:
    r = await test_client_with_db.post("/api/v1/policies-fondo", json=_payload())
    assert r.status_code == 401


async def test_post_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
    _v5_schema,
) -> None:
    """`viewer` no tiene `legal:write` ni siquiera con el monkeypatch
    (que solo agrega a admin/finance) → 403.
    """
    r = await test_client_with_db.post(
        "/api/v1/policies-fondo", json=_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_post_happy_path_returns_201_with_persisted_fields(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/policies-fondo", json=_payload(), headers=auth_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["tipo"] == "reglamento_interno"
    assert body["version"] == "v1.0"
    assert body["nombre"] == "Reglamento Interno FIP CEHTA"
    assert body["estado"] == "vigente"
    assert body["metadata"] == {"firmantes": ["Guido Rietta"]}
    # Server-assigned fields
    assert isinstance(body["policy_id"], int)
    assert "created_at" in body
    assert "updated_at" in body


async def test_post_duplicate_tipo_version_returns_409(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(tipo="manual_uaf", version="v2.0")
    r1 = await test_client_with_db.post(
        "/api/v1/policies-fondo", json=p, headers=auth_headers
    )
    assert r1.status_code == 201
    r2 = await test_client_with_db.post(
        "/api/v1/policies-fondo", json=p, headers=auth_headers
    )
    assert r2.status_code == 409
    assert "v2.0" in r2.json()["detail"]


# ---------- GET list ----------
async def test_list_returns_created_policy(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/policies-fondo",
        json=_payload(tipo="codigo_etica", version="v3.0"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get("/api/v1/policies-fondo", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    versions = {p["version"] for p in items if p["tipo"] == "codigo_etica"}
    assert "v3.0" in versions


async def test_list_filtered_by_tipo(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/policies-fondo",
        json=_payload(tipo="manual_uaf", version="vF-1"),
        headers=auth_headers,
    )
    await test_client_with_db.post(
        "/api/v1/policies-fondo",
        json=_payload(tipo="reglamento_interno", version="vF-2"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/policies-fondo",
        params={"tipo": "manual_uaf"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(p["tipo"] == "manual_uaf" for p in items)
    assert any(p["version"] == "vF-1" for p in items)


async def test_list_filtered_by_estado(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(tipo="politica_pep", version="vE-1")
    p["estado"] = "borrador"
    await test_client_with_db.post(
        "/api/v1/policies-fondo", json=p, headers=auth_headers
    )
    r = await test_client_with_db.get(
        "/api/v1/policies-fondo",
        params={"estado": "borrador"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(p["estado"] == "borrador" for p in items)


# ---------- GET by id ----------
async def test_get_by_id_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/policies-fondo/999999999", headers=auth_headers
    )
    assert r.status_code == 404


async def test_get_by_id_returns_correct_object(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/policies-fondo",
            json=_payload(tipo="politica_inversion", version="vG-1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/policies-fondo/{created['policy_id']}", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["policy_id"] == created["policy_id"]
    assert body["tipo"] == "politica_inversion"
    assert body["version"] == "vG-1"


# ---------- PATCH ----------
async def test_patch_partial_persists_changes(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/policies-fondo",
            json=_payload(tipo="politica_riesgo", version="vH-1"),
            headers=auth_headers,
        )
    ).json()
    original_nombre = created["nombre"]
    r = await test_client_with_db.patch(
        f"/api/v1/policies-fondo/{created['policy_id']}",
        json={"estado": "derogada"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "derogada"
    # Campos no enviados se preservan
    assert body["nombre"] == original_nombre
    assert body["version"] == "vH-1"


async def test_patch_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.patch(
        "/api/v1/policies-fondo/999999999",
        json={"estado": "derogada"},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_patch_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    viewer_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/policies-fondo",
            json=_payload(tipo="manual_compliance", version="vI-1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/policies-fondo/{created['policy_id']}",
        json={"estado": "derogada"},
        headers=viewer_headers,
    )
    assert r.status_code == 403


# ---------- DELETE — explícitamente NO existe ----------
async def test_delete_endpoint_does_not_exist(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    """Las políticas no se borran — se derogan via PATCH. El endpoint
    DELETE no está registrado y debe devolver 405 Method Not Allowed."""
    created = (
        await test_client_with_db.post(
            "/api/v1/policies-fondo",
            json=_payload(tipo="otro", version="vJ-1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/policies-fondo/{created['policy_id']}", headers=auth_headers
    )
    assert r.status_code == 405
