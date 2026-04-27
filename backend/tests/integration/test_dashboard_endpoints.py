"""Integration tests para `/api/v1/dashboard/*`.

DB vacía (transacción aislada por test) — los endpoints deben devolver
estructuras válidas con valores cero / arrays vacíos, sin crashear.

Cubre:
- /kpis: estructura completa, montos en 0, etl_status='never' o 'stale'.
- /cashflow: CashflowResponse con points=[].
- /saldos-por-empresa: array (3 empresas seed).
- /proyectos-ranking?limit=5: <=5 items.
- /movimientos-recientes?limit=10: array vacío con DB sin movs.
- /egresos-por-concepto: array.
- /iva-trend: array.
- viewer puede leer todos.
- 401 sin token en todos.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

ENDPOINTS_GET = [
    "/api/v1/dashboard/kpis",
    "/api/v1/dashboard/cashflow",
    "/api/v1/dashboard/saldos-por-empresa",
    "/api/v1/dashboard/proyectos-ranking",
    "/api/v1/dashboard/movimientos-recientes",
    "/api/v1/dashboard/egresos-por-concepto",
    "/api/v1/dashboard/iva-trend",
]


# ---------- KPIs ----------
async def test_kpis_admin_returns_full_payload(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/dashboard/kpis", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    expected_keys = {
        "saldo_total_consolidado",
        "saldo_total_cehta",
        "saldo_total_corfo",
        "egreso_mes_actual",
        "egreso_mes_anterior",
        "egreso_delta_pct",
        "abono_mes_actual",
        "abono_mes_anterior",
        "abono_delta_pct",
        "flujo_neto_mes",
        "iva_a_pagar_mes",
        "oc_emitidas_pendientes",
        "monto_oc_pendiente",
        "f29_proximas_30d",
        "f29_vencidas",
        "ultimo_etl_run",
        "etl_status",
    }
    assert expected_keys.issubset(body.keys())


async def test_kpis_empty_db_returns_zeros(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/dashboard/kpis", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    # Sin movimientos / OCs / F29 → todos los montos en 0
    assert Decimal(body["saldo_total_consolidado"]) == Decimal("0")
    assert Decimal(body["egreso_mes_actual"]) == Decimal("0")
    assert Decimal(body["abono_mes_actual"]) == Decimal("0")
    assert Decimal(body["iva_a_pagar_mes"]) == Decimal("0")
    assert body["oc_emitidas_pendientes"] == 0
    assert body["f29_proximas_30d"] == 0
    assert body["f29_vencidas"] == 0
    # Sin ETL runs → 'never' y ultimo_etl_run None
    assert body["ultimo_etl_run"] is None
    assert body["etl_status"] in {"never", "stale", "failed"}


# ---------- cashflow ----------
async def test_cashflow_empty_db(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get("/api/v1/dashboard/cashflow", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["points"] == []
    # empresa_codigo None cuando es consolidado
    assert body.get("empresa_codigo") is None


async def test_cashflow_with_filter(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/cashflow",
        params={"empresa_codigo": "TRONGKAI", "meses": 6},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["empresa_codigo"] == "TRONGKAI"
    assert body["points"] == []


# ---------- saldos-por-empresa ----------
async def test_saldos_por_empresa_returns_seed_empresas(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/saldos-por-empresa", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    # Schema seed inserta varias empresas (TRONGKAI, REVTECH, FIP_CEHTA, ...).
    assert isinstance(body, list)
    codigos = {row["empresa_codigo"] for row in body}
    assert {"TRONGKAI", "REVTECH", "FIP_CEHTA"}.issubset(codigos)
    # delta_30d debe ser numérico (puede ser 0 con DB vacía)
    for row in body:
        assert "delta_30d" in row


# ---------- proyectos-ranking ----------
async def test_proyectos_ranking_respects_limit(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/proyectos-ranking",
        params={"limit": 5},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list)
    assert len(body) <= 5


async def test_proyectos_ranking_limit_validation(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/proyectos-ranking",
        params={"limit": 999},
        headers=auth_headers,
    )
    # ge=1 le=50 — debería ser 422
    assert r.status_code == 422


# ---------- movimientos-recientes ----------
async def test_movimientos_recientes_empty(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/movimientos-recientes",
        params={"limit": 10},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body == []


# ---------- egresos-por-concepto ----------
async def test_egresos_por_concepto_returns_array(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/egresos-por-concepto", headers=auth_headers
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


async def test_egresos_por_concepto_invalid_periodo_returns_empty(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/egresos-por-concepto",
        params={"periodo": "13_99"},  # mes inválido
        headers=auth_headers,
    )
    # El endpoint maneja el ValueError devolviendo []
    assert r.status_code == 200
    assert r.json() == []


# ---------- iva-trend ----------
async def test_iva_trend_returns_array(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/dashboard/iva-trend", params={"meses": 6}, headers=auth_headers
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------- RBAC: viewer puede leer todo ----------
@pytest.mark.parametrize("endpoint", ENDPOINTS_GET)
async def test_dashboard_endpoints_viewer_can_read(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
    endpoint: str,
) -> None:
    r = await test_client_with_db.get(endpoint, headers=viewer_headers)
    assert r.status_code == 200, f"viewer no puede leer {endpoint}: {r.text}"


@pytest.mark.parametrize("endpoint", ENDPOINTS_GET)
async def test_dashboard_endpoints_unauthenticated_returns_401(
    test_client_with_db: AsyncClient, endpoint: str
) -> None:
    r = await test_client_with_db.get(endpoint)
    assert r.status_code == 401, f"{endpoint} no devuelve 401 sin token (devolvió {r.status_code})"
