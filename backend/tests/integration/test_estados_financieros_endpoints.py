"""Integration tests para `/api/v1/estados-financieros` (V5).

Cubre POST/GET/PATCH/DELETE.

UNIQUE constraint: (empresa_codigo, tipo_ef, periodo) → 409 al duplicar.
FK: empresa_codigo → core.empresas. Si la empresa no existe → 404.

Reglas de auth:
- read: cualquier usuario autenticado
- create / update / delete: scope `legal:write`

Las empresas TRONGKAI / REVTECH / ... están preseedeadas en `db/schema.sql`,
así que no hace falta crearlas en los tests.
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
    empresa_codigo: str = "TRONGKAI",
    tipo_ef: str = "balance",
    periodo: str = "2025-Q4",
    fecha_corte: str = "2025-12-31",
) -> dict:
    return {
        "empresa_codigo": empresa_codigo,
        "tipo_ef": tipo_ef,
        "periodo_tipo": "trimestral",
        "periodo": periodo,
        "fecha_corte": fecha_corte,
        "auditado": False,
        "auditor": None,
        "aprobado_directorio": False,
        "fecha_aprobacion": None,
        "dropbox_path": (
            f"/Cehta/01-Empresas/{empresa_codigo}/04-Financiero/{tipo_ef}_{periodo}.pdf"
        ),
        "hash_sha256": "cafebabe",
        "metadata": {"ingresos_clp": 50000000, "ebitda_clp": 12000000},
    }


# ---------- POST ----------
async def test_post_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
    _v5_schema,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/estados-financieros", json=_payload()
    )
    assert r.status_code == 401


async def test_post_without_legal_write_scope_returns_403(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/estados-financieros",
        json=_payload(),
        headers=viewer_headers,
    )
    assert r.status_code == 403


async def test_post_happy_path_returns_201(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(empresa_codigo="TRONGKAI", tipo_ef="balance", periodo="2025-Q4-A")
    r = await test_client_with_db.post(
        "/api/v1/estados-financieros", json=p, headers=auth_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["empresa_codigo"] == "TRONGKAI"
    assert body["tipo_ef"] == "balance"
    assert body["periodo"] == "2025-Q4-A"
    assert body["auditado"] is False
    assert isinstance(body["ef_id"], int)
    assert body["metadata"] == {"ingresos_clp": 50000000, "ebitda_clp": 12000000}


async def test_post_unknown_empresa_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(empresa_codigo="NONEXISTENT_EMPRESA_X")
    r = await test_client_with_db.post(
        "/api/v1/estados-financieros", json=p, headers=auth_headers
    )
    assert r.status_code == 404
    assert "NONEXISTENT_EMPRESA_X" in r.json()["detail"]


async def test_post_duplicate_empresa_tipo_periodo_returns_409(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(empresa_codigo="REVTECH", tipo_ef="estado_resultados", periodo="2025-DUP")
    r1 = await test_client_with_db.post(
        "/api/v1/estados-financieros", json=p, headers=auth_headers
    )
    assert r1.status_code == 201
    r2 = await test_client_with_db.post(
        "/api/v1/estados-financieros", json=p, headers=auth_headers
    )
    assert r2.status_code == 409
    assert "2025-DUP" in r2.json()["detail"]


# ---------- GET list ----------
async def test_list_returns_created_ef(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/estados-financieros",
        json=_payload(periodo="2025-LST-A"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/estados-financieros", headers=auth_headers
    )
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert any(e["periodo"] == "2025-LST-A" for e in items)


async def test_list_filtered_by_empresa_codigo(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/estados-financieros",
        json=_payload(empresa_codigo="TRONGKAI", periodo="2025-FILT-T"),
        headers=auth_headers,
    )
    await test_client_with_db.post(
        "/api/v1/estados-financieros",
        json=_payload(empresa_codigo="REVTECH", periodo="2025-FILT-R"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/estados-financieros",
        params={"empresa_codigo": "TRONGKAI"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(e["empresa_codigo"] == "TRONGKAI" for e in items)
    assert any(e["periodo"] == "2025-FILT-T" for e in items)


async def test_list_filtered_by_tipo_ef(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    await test_client_with_db.post(
        "/api/v1/estados-financieros",
        json=_payload(tipo_ef="flujo_caja", periodo="2025-FC"),
        headers=auth_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/estados-financieros",
        params={"tipo_ef": "flujo_caja"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(e["tipo_ef"] == "flujo_caja" for e in items)


async def test_list_filtered_by_auditado(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    p = _payload(periodo="2025-AUD-Y")
    p["auditado"] = True
    p["auditor"] = "Deloitte"
    await test_client_with_db.post(
        "/api/v1/estados-financieros", json=p, headers=auth_headers
    )
    r = await test_client_with_db.get(
        "/api/v1/estados-financieros",
        params={"auditado": True},
        headers=auth_headers,
    )
    assert r.status_code == 200
    items = r.json()
    assert all(e["auditado"] is True for e in items)


# ---------- GET by id ----------
async def test_get_by_id_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/estados-financieros/999999999", headers=auth_headers
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
            "/api/v1/estados-financieros",
            json=_payload(periodo="2025-G-1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/estados-financieros/{created['ef_id']}", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ef_id"] == created["ef_id"]
    assert body["periodo"] == "2025-G-1"


# ---------- PATCH ----------
async def test_patch_partial_persists_changes(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/estados-financieros",
            json=_payload(periodo="2025-P-1"),
            headers=auth_headers,
        )
    ).json()
    original_periodo = created["periodo"]
    r = await test_client_with_db.patch(
        f"/api/v1/estados-financieros/{created['ef_id']}",
        json={"auditado": True, "auditor": "PwC"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auditado"] is True
    assert body["auditor"] == "PwC"
    # Campo no enviado se preserva
    assert body["periodo"] == original_periodo


async def test_patch_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.patch(
        "/api/v1/estados-financieros/999999999",
        json={"auditado": True},
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
            "/api/v1/estados-financieros",
            json=_payload(periodo="2025-D-1"),
            headers=auth_headers,
        )
    ).json()
    ef_id = created["ef_id"]
    r = await test_client_with_db.delete(
        f"/api/v1/estados-financieros/{ef_id}", headers=auth_headers
    )
    assert r.status_code == 204
    g = await test_client_with_db.get(
        f"/api/v1/estados-financieros/{ef_id}", headers=auth_headers
    )
    assert g.status_code == 404


async def test_delete_not_found_returns_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _v5_schema,
    _grant_legal_write,
) -> None:
    r = await test_client_with_db.delete(
        "/api/v1/estados-financieros/999999999", headers=auth_headers
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
            "/api/v1/estados-financieros",
            json=_payload(periodo="2025-DV-1"),
            headers=auth_headers,
        )
    ).json()
    r = await test_client_with_db.delete(
        f"/api/v1/estados-financieros/{created['ef_id']}",
        headers=viewer_headers,
    )
    assert r.status_code == 403
