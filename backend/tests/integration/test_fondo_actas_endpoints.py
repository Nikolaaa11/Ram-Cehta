"""Integration tests para `/api/v1/fondo-actas` (V5).

Cubre POST/GET/PATCH/DELETE.

UNIQUE constraint: (tipo_organo, numero_acta) → 409 al duplicar.

Reglas de auth:
- read: cualquier usuario autenticado
- create / update / delete: scope `legal:write`
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest_v5 import (  # noqa: F401
    _grant_legal_write,
    _v5_schema,
)

pytestmark = pytest.mark.integration


def _payload(
    tipo_organo: str = "directorio_afis",
    numero_acta: int = 1,
) -> dict:
    return {
        "tipo_organo": tipo_organo,
        "numero_acta": numero_acta,
        "fecha_reunion": "2026-04-15",
        "lugar": "Santiago, oficinas Cehta",
        "quorum": 5,
        "quorum_total": 5,
        "presidente": "Guido Rietta",
        "secretario": "Nicolas Rietta",
        "asistentes": ["Guido Rietta", "Nicolas Rietta"],
        "temario": "Aprobación inversión TRONGKAI",
        "acuerdos": [
            {
                "orden_dia": "Aprobación nueva inversión",
                "descripcion": "Aprobar aporte CLP 100M en TRONGKAI",
                "votos_a_favor": 5,
                "votos_en_contra": 0,
                "abstenciones": 0,
                "aprobado": True,
            }
        ],
        "dropbox_path": f"/Cehta/02-Actas/{tipo_organo}_{numero_acta}.pdf",
        "hash_sha256": "feedface",
        "estado": "borrador",
        "metadata": {"observaciones": "primera reunión Q2"},
    }


# ---------- POST ----------
async def test_post_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
    _v5_schema,
) -> None:
    r = await test_client_with_db.post("/api/v1/fondo-actas", json=_payload())
    assert r.status_code == 401


async def test_post_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/fondo-actas", json=_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_post_happy_path_returns_201(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(tipo_organo="comite_inversion", numero_acta=101)
    r = await test_client_with_db.post(
        "/api/v1/fondo-actas", json=p, headers=auth_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["tipo_organo"] == "comite_inversion"
    assert body["numero_acta"] == 101
    assert body["estado"] == "borrador"
    assert body["presidente"] == "Guido Rietta"
    assert isinstance(body["acta_id"], int)
    # Campos JSONB ida-vuelta
    assert isinstance(body["asistentes"], list)
    assert len(body["acuerdos"]) == 1
    assert body["acuerdos"][0]["aprobado"] is True


async def test_post_duplicate_tipo_organo_numero_returns_409(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(tipo_organo="asamblea_lps", numero_acta=200)
    r1 = await test_client_with_db.post(
        "/api/v1/fondo-actas", json=p, headers=auth_headers
    )
    assert r1.status_code == 201
    r2 = await test_client_with_db.post(
        "/api/v1/fondo-actas", json=p, headers=auth_headers
    )
    assert r2.status_code == 409
    assert "200" in r2.json()["detail"]


# ---------- GET list ----------
async def test_list_returns_created_acta(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/fondo-actas",
        json=_payload(tipo_organo="comite_riesgo", numero_acta=10),
        headers=auth_headers,
    )
    r = await test_client_with_db.get("/api/v1/fondo-actas", headers=auth_headers)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert any(
        a["tipo_organo"] == "comite_riesgo" and a["numero_acta"] == 10
        for a in items
    )


async def test_list_filtered_by_tipo_organo(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/fondo-actas",
        json=_payload(tipo_organo="comite_vigilancia", numero_acta=20),
        headers=auth_headers,
    )
    await test_client_with_db.post(
        "/api/v1/fondo-actas",
        json=_payload(tipo_organo="directorio_afis", numero_acta=21),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/fondo-actas",
        params={"tipo_organo": "comite_vigilancia"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(a["tipo_organo"] == "comite_vigilancia" for a in items)


async def test_list_filtered_by_estado(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(tipo_organo="otro", numero_acta=30)
    p["estado"] = "firmada"
    await test_client_with_db.post(
        "/api/v1/fondo-actas", json=p, headers=auth_headers
    )
    r = await test_client_with_db.get(
        "/api/v1/fondo-actas",
        params={"estado": "firmada"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(a["estado"] == "firmada" for a in items)


# ---------- GET by id ----------
async def test_get_by_id_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/fondo-actas/999999999", headers=auth_headers
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
            "/api/v1/fondo-actas",
            json=_payload(tipo_organo="directorio_afis", numero_acta=40),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/fondo-actas/{created['acta_id']}", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["acta_id"] == created["acta_id"]
    assert body["numero_acta"] == 40


# ---------- PATCH ----------
async def test_patch_partial_persists_changes(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/fondo-actas",
            json=_payload(tipo_organo="comite_inversion", numero_acta=50),
            headers=auth_headers,
        )
    ).json()
    original_lugar = created["lugar"]
    r = await test_client_with_db.patch(
        f"/api/v1/fondo-actas/{created['acta_id']}",
        json={"estado": "aprobada"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "aprobada"
    # Campo no enviado se preserva
    assert body["lugar"] == original_lugar
    assert body["numero_acta"] == 50


async def test_patch_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.patch(
        "/api/v1/fondo-actas/999999999",
        json={"estado": "aprobada"},
        headers=auth_headers,
    )
    assert r.status_code == 404


# ---------- DELETE ----------
async def test_delete_happy_path_returns_204(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/fondo-actas",
            json=_payload(tipo_organo="otro", numero_acta=60),
            headers=auth_headers,
        )
    ).json()
    acta_id = created["acta_id"]
    r = await test_client_with_db.delete(
        f"/api/v1/fondo-actas/{acta_id}", headers=auth_headers
    )
    assert r.status_code == 204
    g = await test_client_with_db.get(
        f"/api/v1/fondo-actas/{acta_id}", headers=auth_headers
    )
    assert g.status_code == 404


async def test_delete_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.delete(
        "/api/v1/fondo-actas/999999999", headers=auth_headers
    )
    assert r.status_code == 404


async def test_delete_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    viewer_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/fondo-actas",
            json=_payload(tipo_organo="otro", numero_acta=70),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/fondo-actas/{created['acta_id']}", headers=viewer_headers
    )
    assert r.status_code == 403
