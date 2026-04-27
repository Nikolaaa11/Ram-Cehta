"""Integration tests para `/api/v1/ordenes-compra`.

Cubre:
- POST: cálculo IVA 19%, total = neto + iva.
- POST viewer → 403.
- POST con numero_oc duplicado por empresa → 409.
- POST mismo numero_oc en distinta empresa → 201.
- GET list con filtro empresa_codigo + estado.
- GET /{id}: allowed_actions según rol.
- PATCH /{id}/estado:
    emitida → pagada con finance OK.
    emitida → anulada con finance 403 (sólo admin).
    pagada → emitida bloqueado (transición no permitida).
    OC inexistente → 404.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


def _oc_payload(
    numero: str = "OC-TEST-001",
    empresa: str = "TRONGKAI",
    neto: int = 1_000_000,
) -> dict:
    return {
        "numero_oc": numero,
        "empresa_codigo": empresa,
        "fecha_emision": "2026-04-01",
        "moneda": "CLP",
        "neto": neto,
        "items": [
            {
                "item": 1,
                "descripcion": "Servicio profesional",
                "precio_unitario": neto,
                "cantidad": 1,
            }
        ],
    }


# ---------- POST ----------
async def test_create_oc_calculates_iva_19_pct(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/ordenes-compra", json=_oc_payload(neto=1_000_000), headers=finance_headers
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert Decimal(body["neto"]) == Decimal("1000000")
    assert Decimal(body["iva"]) == Decimal("190000")
    assert Decimal(body["total"]) == Decimal("1190000")
    assert body["estado"] == "emitida"


async def test_create_oc_as_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/ordenes-compra", json=_oc_payload(), headers=viewer_headers
    )
    assert r.status_code == 403


async def test_create_oc_duplicate_numero_same_empresa_returns_409(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-DUP-001", empresa="TRONGKAI"),
        headers=finance_headers,
    )
    r = await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-DUP-001", empresa="TRONGKAI"),
        headers=finance_headers,
    )
    assert r.status_code == 409
    assert "ya existe" in r.json()["detail"]


async def test_create_oc_duplicate_numero_distinct_empresa_returns_201(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r1 = await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-CROSS-001", empresa="TRONGKAI"),
        headers=finance_headers,
    )
    assert r1.status_code == 201
    r2 = await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-CROSS-001", empresa="REVTECH"),
        headers=finance_headers,
    )
    # UNIQUE (empresa_codigo, numero_oc) — debería permitir
    assert r2.status_code == 201


# ---------- GET list + filtros ----------
async def test_list_ocs_filter_by_empresa(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-T-001", empresa="TRONGKAI"),
        headers=finance_headers,
    )
    await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-R-001", empresa="REVTECH"),
        headers=finance_headers,
    )

    r = await test_client_with_db.get(
        "/api/v1/ordenes-compra",
        params={"empresa_codigo": "TRONGKAI"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    codigos = {oc["empresa_codigo"] for oc in body["items"]}
    assert codigos == {"TRONGKAI"}


async def test_list_ocs_filter_by_estado(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    await test_client_with_db.post(
        "/api/v1/ordenes-compra",
        json=_oc_payload(numero="OC-EST-001", empresa="TRONGKAI"),
        headers=finance_headers,
    )
    r = await test_client_with_db.get(
        "/api/v1/ordenes-compra",
        params={"estado": "emitida"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert all(oc["estado"] == "emitida" for oc in body["items"])
    assert body["total"] >= 1


# ---------- GET /{id} con allowed_actions ----------
async def test_get_oc_admin_includes_cancel_action(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-AA-001"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/ordenes-compra/{created['oc_id']}", headers=auth_headers
    )
    assert r.status_code == 200
    actions = r.json()["allowed_actions"]
    # admin con OC emitida: puede aprobar(?), cancel y mark_paid.
    assert "cancel" in actions
    assert "mark_paid" in actions
    assert "download_pdf" in actions


async def test_get_oc_viewer_only_download(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-VIEW-001"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.get(
        f"/api/v1/ordenes-compra/{created['oc_id']}", headers=viewer_headers
    )
    assert r.status_code == 200
    actions = r.json()["allowed_actions"]
    assert actions == ["download_pdf"]


async def test_get_oc_not_found(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/ordenes-compra/9999999", headers=auth_headers)
    assert r.status_code == 404


# ---------- PATCH /{id}/estado ----------
async def test_patch_estado_emitida_to_pagada_with_finance(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-PAY-001"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "pagada"},
        headers=finance_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "pagada"
    # Una vez pagada, no debería poder volver a mark_paid o cancel para finance.
    assert "mark_paid" not in body["allowed_actions"]


async def test_patch_estado_to_anulada_with_finance_returns_403(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-ANUL-001"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "anulada"},
        headers=finance_headers,
    )
    # Sólo admin tiene oc:cancel.
    assert r.status_code == 403


async def test_patch_estado_to_anulada_with_admin_succeeds(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    auth_headers: dict[str, str],
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-ANUL-002"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "anulada"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["estado"] == "anulada"


async def test_patch_estado_pagada_to_emitida_blocked(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-REV-001"),
            headers=finance_headers,
        )
    ).json()
    # marca como pagada
    await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "pagada"},
        headers=finance_headers,
    )
    # intenta volver a emitida → no hay action permitida para esa transición
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "emitida"},
        headers=finance_headers,
    )
    # 'emitida' no está en _ESTADO_ACTION → 403 (acción no encontrada)
    # o 422 si pydantic rechaza el literal — esquema acepta 'emitida' así que debe ser 403.
    assert r.status_code == 403


async def test_patch_estado_oc_not_found(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.patch(
        "/api/v1/ordenes-compra/9999999/estado",
        json={"estado": "pagada"},
        headers=finance_headers,
    )
    assert r.status_code == 404


async def test_create_oc_unauthenticated_returns_401(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.post("/api/v1/ordenes-compra", json=_oc_payload())
    assert r.status_code == 401


# ---------- PATCH /{id} (V2 — edición de campos no-críticos) ----------
async def test_patch_oc_fields_with_finance_returns_200(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-EDIT-001"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}",
        json={
            "observaciones": "Editada por integration test",
            "forma_pago": "Transferencia",
            "validez_dias": 60,
        },
        headers=finance_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["observaciones"] == "Editada por integration test"
    assert body["forma_pago"] == "Transferencia"
    assert body["validez_dias"] == 60


async def test_patch_oc_ignores_critical_fields(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    """Aunque el cliente mande total/numero_oc/estado, el server no los modifica."""
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-EDIT-002"),
            headers=finance_headers,
        )
    ).json()
    original_numero = created["numero_oc"]
    original_total = created["total"]

    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}",
        json={
            "observaciones": "X",
            "numero_oc": "OC-HACK-999",
            "total": 99999999,
            "estado": "pagada",
        },
        headers=finance_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["numero_oc"] == original_numero
    assert body["total"] == original_total
    assert body["estado"] == "emitida"


async def test_patch_oc_on_pagada_returns_403(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    """OC pagada → no editable."""
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-EDIT-003"),
            headers=finance_headers,
        )
    ).json()
    # marcar como pagada
    await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}/estado",
        json={"estado": "pagada"},
        headers=finance_headers,
    )

    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}",
        json={"observaciones": "ya tarde"},
        headers=finance_headers,
    )
    assert r.status_code == 403
    assert "editables" in r.json()["detail"]


async def test_patch_oc_with_viewer_returns_403(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    viewer_headers: dict[str, str],
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-EDIT-004"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}",
        json={"observaciones": "intent"},
        headers=viewer_headers,
    )
    assert r.status_code == 403


async def test_patch_oc_validez_dias_zero_returns_422(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    created = (
        await test_client_with_db.post(
            "/api/v1/ordenes-compra",
            json=_oc_payload(numero="OC-EDIT-005"),
            headers=finance_headers,
        )
    ).json()
    r = await test_client_with_db.patch(
        f"/api/v1/ordenes-compra/{created['oc_id']}",
        json={"validez_dias": 0},
        headers=finance_headers,
    )
    assert r.status_code == 422


async def test_patch_oc_not_found(
    test_client_with_db: AsyncClient, finance_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.patch(
        "/api/v1/ordenes-compra/9999999",
        json={"observaciones": "x"},
        headers=finance_headers,
    )
    assert r.status_code == 404
