"""Integration tests para `/api/v1/audit` (admin only)."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.integration


@pytest_asyncio.fixture
async def seed_run(db_session: AsyncSession) -> str:
    """Inserta una corrida ETL + 2 rejected rows. Devuelve run_id."""
    run_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            """
            INSERT INTO audit.etl_runs (
                run_id, source_file, status,
                rows_extracted, rows_loaded, rows_rejected, finished_at
            )
            VALUES (:rid, 'fixture.xlsx', 'success', 100, 98, 2, now())
            """
        ),
        {"rid": run_id},
    )
    await db_session.execute(
        text(
            """
            INSERT INTO audit.rejected_rows (run_id, source_sheet, source_row_num, reason, raw_data)
            VALUES (:rid, 'Resumen', 5, 'fecha vacía', '{}'::jsonb),
                   (:rid, 'Resumen', 9, 'monto inválido', '{}'::jsonb)
            """
        ),
        {"rid": run_id},
    )
    return run_id


# ---------- GET /etl-runs ----------
async def test_list_etl_runs_with_admin_returns_200(
    test_client_with_db: AsyncClient,
    seed_run: str,
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get("/api/v1/audit/etl-runs", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    found = next((it for it in body["items"] if it["run_id"] == seed_run), None)
    assert found is not None
    # duration_seconds debería estar computed (finished_at fue seteado)
    assert found["duration_seconds"] is not None


async def test_list_etl_runs_with_finance_returns_403(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/audit/etl-runs", headers=finance_headers
    )
    assert r.status_code == 403


async def test_list_etl_runs_with_viewer_returns_403(
    test_client_with_db: AsyncClient,
    viewer_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/audit/etl-runs", headers=viewer_headers
    )
    assert r.status_code == 403


async def test_list_etl_runs_filter_by_status(
    test_client_with_db: AsyncClient,
    seed_run: str,
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/audit/etl-runs",
        params={"status": "success"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert all(it["status"] == "success" for it in body["items"])


# ---------- GET /etl-runs/{id} ----------
async def test_get_etl_run_by_id(
    test_client_with_db: AsyncClient,
    seed_run: str,
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        f"/api/v1/audit/etl-runs/{seed_run}", headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json()["run_id"] == seed_run


async def test_get_etl_run_not_found(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    fake = str(uuid.uuid4())
    r = await test_client_with_db.get(
        f"/api/v1/audit/etl-runs/{fake}", headers=auth_headers
    )
    assert r.status_code == 404


# ---------- GET /etl-runs/{id}/rejected-rows ----------
async def test_list_rejected_rows(
    test_client_with_db: AsyncClient,
    seed_run: str,
    auth_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        f"/api/v1/audit/etl-runs/{seed_run}/rejected-rows", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2


async def test_list_rejected_rows_with_finance_returns_403(
    test_client_with_db: AsyncClient,
    seed_run: str,
    finance_headers: dict[str, str],
) -> None:
    r = await test_client_with_db.get(
        f"/api/v1/audit/etl-runs/{seed_run}/rejected-rows",
        headers=finance_headers,
    )
    assert r.status_code == 403


# ---------- GET /data-quality ----------
async def test_data_quality_report_with_admin(
    test_client_with_db: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/audit/data-quality", headers=auth_headers
    )
    assert r.status_code == 200
    body = r.json()
    assert "issues" in body
    assert "generated_at" in body
    assert isinstance(body["issues"], list)
    assert "total_issues" in body
    assert "critical_count" in body


async def test_data_quality_with_viewer_returns_403(
    test_client_with_db: AsyncClient, viewer_headers: dict[str, str]
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/audit/data-quality", headers=viewer_headers
    )
    assert r.status_code == 403


async def test_audit_endpoints_unauthenticated(
    test_client_with_db: AsyncClient,
) -> None:
    r = await test_client_with_db.get("/api/v1/audit/etl-runs")
    assert r.status_code == 401
