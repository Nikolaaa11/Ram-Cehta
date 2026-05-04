"""Integration tests para `/api/v1/lps/{lp_id}/documents` (V5).

Cubre POST/GET/PATCH/DELETE. NO hay UNIQUE constraint en lp_documents,
así que no hay test de 409 por duplicado — un LP puede tener varios
docs del mismo tipo (ej. múltiples recibos de aporte).

Reglas de auth:
- read: cualquier usuario autenticado
- create / update / delete: scope `legal:write`

Pre-requisitos:
- core.lps existe (creada en _v5_schema)
- core.lp_documents existe (creada en _v5_schema)

Si no hay Postgres disponible, todos los tests skipean vía `_engine`.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest_v5 import (  # noqa: F401
    _grant_legal_write,
    _v5_schema,
    lp_id_factory,
)

pytestmark = pytest.mark.integration


def _payload(
    tipo: str = "contrato_suscripcion",
    nombre: str = "Contrato Suscripción 2026",
) -> dict:
    return {
        "tipo": tipo,
        "nombre": nombre,
        "fecha_firma": "2026-03-01",
        "fecha_vigencia_hasta": "2031-03-01",
        "monto_clp": "100000000.00",
        "dropbox_path": "/Cehta/03-LPs/Doe/contrato.pdf",
        "hash_sha256": "deadbeef",
        "estado": "vigente",
        "metadata": {"notario": "1°SCL"},
        "uploaded_by": None,
    }


# ---------- POST ----------
async def test_post_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
    _v5_schema,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Auth", email="lp_auth@test.cl")
    r = await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents", json=_payload()
    )
    assert r.status_code == 401


async def test_post_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
    _v5_schema,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP NoScope", email="ns@test.cl")
    r = await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents",
        json=_payload(),
        headers=viewer_headers,
    )
    assert r.status_code == 403


async def test_post_happy_path_returns_201(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Happy", email="happy@test.cl")
    r = await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents",
        json=_payload(),
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["tipo"] == "contrato_suscripcion"
    assert body["nombre"] == "Contrato Suscripción 2026"
    assert body["estado"] == "vigente"
    assert body["lp_id"] == lp_id
    assert isinstance(body["lp_doc_id"], int)
    assert body["metadata"] == {"notario": "1°SCL"}


async def test_post_lp_id_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/lps/999999999/documents",
        json=_payload(),
        headers=auth_headers,
    )
    assert r.status_code == 404


# ---------- GET list ----------
async def test_list_returns_created_doc(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP List", email="list@test.cl")
    await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents",
        json=_payload(tipo="kyc", nombre="KYC 2026"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents", headers=auth_headers
    )
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert any(d["tipo"] == "kyc" and d["nombre"] == "KYC 2026" for d in items)


async def test_list_filtered_by_tipo(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Filter", email="filter@test.cl")
    await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents",
        json=_payload(tipo="kyc", nombre="KYC"),
        headers=auth_headers,
    )
    await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents",
        json=_payload(tipo="ddq", nombre="DDQ"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents",
        params={"tipo": "kyc"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(d["tipo"] == "kyc" for d in items)
    assert any(d["nombre"] == "KYC" for d in items)


async def test_list_filtered_by_estado(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Estado", email="estado@test.cl")
    p = _payload(tipo="side_letter", nombre="SL")
    p["estado"] = "borrador"
    await test_client_with_db.post(
        f"/api/v1/lps/{lp_id}/documents", json=p, headers=auth_headers
    )
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents",
        params={"estado": "borrador"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(d["estado"] == "borrador" for d in items)


async def test_list_lp_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/lps/999999999/documents", headers=auth_headers
    )
    assert r.status_code == 404


# ---------- GET by id ----------
async def test_get_by_id_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP NF", email="nf@test.cl")
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents/999999999", headers=auth_headers
    )
    assert r.status_code == 404


async def test_get_by_id_wrong_lp_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    """Doc creado bajo lp_a debe 404 si se consulta vía lp_b."""
    lp_a = await lp_id_factory(nombre="LP A", email="a@test.cl")
    lp_b = await lp_id_factory(nombre="LP B", email="b@test.cl")
    created = (
        await test_client_with_db.post(
            f"/api/v1/lps/{lp_a}/documents",
            json=_payload(tipo="kyc", nombre="KYC A"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_b}/documents/{created['lp_doc_id']}",
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_get_by_id_returns_correct_object(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Get", email="get@test.cl")
    created = (
        await test_client_with_db.post(
            f"/api/v1/lps/{lp_id}/documents",
            json=_payload(tipo="recibo_aporte", nombre="Recibo 1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents/{created['lp_doc_id']}",
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lp_doc_id"] == created["lp_doc_id"]
    assert body["nombre"] == "Recibo 1"
    assert body["tipo"] == "recibo_aporte"


# ---------- PATCH ----------
async def test_patch_partial_persists_changes(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Patch", email="patch@test.cl")
    created = (
        await test_client_with_db.post(
            f"/api/v1/lps/{lp_id}/documents",
            json=_payload(tipo="kyc", nombre="KYC v1"),
            headers=auth_headers,
        )
    ).json()
    original_tipo = created["tipo"]
    r = await test_client_with_db.patch(
        f"/api/v1/lps/{lp_id}/documents/{created['lp_doc_id']}",
        json={"nombre": "KYC v2", "estado": "archivado"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["nombre"] == "KYC v2"
    assert body["estado"] == "archivado"
    # Campo no enviado se preserva
    assert body["tipo"] == original_tipo


async def test_patch_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP PNF", email="pnf@test.cl")
    r = await test_client_with_db.patch(
        f"/api/v1/lps/{lp_id}/documents/999999999",
        json={"estado": "archivado"},
        headers=auth_headers,
    )
    assert r.status_code == 404


# ---------- DELETE ----------
async def test_delete_happy_path_returns_204(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP Del", email="del@test.cl")
    created = (
        await test_client_with_db.post(
            f"/api/v1/lps/{lp_id}/documents",
            json=_payload(tipo="kyc", nombre="KYC del"),
            headers=auth_headers,
        )
    ).json()
    doc_id = created["lp_doc_id"]
    r = await test_client_with_db.delete(
        f"/api/v1/lps/{lp_id}/documents/{doc_id}", headers=auth_headers
    )
    assert r.status_code == 204
    # GET subsiguiente devuelve 404
    g = await test_client_with_db.get(
        f"/api/v1/lps/{lp_id}/documents/{doc_id}", headers=auth_headers
    )
    assert g.status_code == 404


async def test_delete_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP DelNF", email="delnf@test.cl")
    r = await test_client_with_db.delete(
        f"/api/v1/lps/{lp_id}/documents/999999999", headers=auth_headers
    )
    assert r.status_code == 404


async def test_delete_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    viewer_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
    lp_id_factory,
) -> None:
    lp_id = await lp_id_factory(nombre="LP DelV", email="delv@test.cl")
    created = (
        await test_client_with_db.post(
            f"/api/v1/lps/{lp_id}/documents",
            json=_payload(tipo="kyc", nombre="KYC v"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/lps/{lp_id}/documents/{created['lp_doc_id']}",
        headers=viewer_headers,
    )
    assert r.status_code == 403
