"""Integration tests para POST /vouchers/bulk-delete-drafts (Etapa K).

Cubre:
- Happy path: 2 DRAFT borrados correctamente
- Failure: voucher_id inexistente → en failures (no rompe lote)
- Failure: status != DRAFT (PENDING) → en failures
- Validación Pydantic: voucher_ids vacío → 422
- Validación Pydantic: > 200 IDs → 422
- Mix exitoso + fallo en mismo request

Sigue el mismo patrón que test_voucher_comments_endpoints.py: crea
DDL idempotente de core.vouchers, factory para crear vouchers en la
transacción del test.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.integration.conftest import make_token

pytestmark = pytest.mark.integration


# Mismo DDL minimal que voucher_comments tests — sin triggers ni FK pesadas.
_VOUCHERS_DDL: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS core.vouchers (
        voucher_id     BIGSERIAL PRIMARY KEY,
        codigo         TEXT UNIQUE NOT NULL,
        empresa_codigo TEXT NOT NULL REFERENCES core.empresas(codigo),
        tipo           TEXT NOT NULL DEFAULT 'COMPRA',
        status         TEXT NOT NULL DEFAULT 'DRAFT',
        fecha_documento DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_contable DATE NOT NULL DEFAULT CURRENT_DATE,
        glosa          TEXT NOT NULL DEFAULT 'Glosa minima',
        total_debit    NUMERIC(18, 2) NOT NULL DEFAULT 0,
        total_credit   NUMERIC(18, 2) NOT NULL DEFAULT 0,
        moneda         TEXT NOT NULL DEFAULT 'CLP',
        contraparte_rut    TEXT,
        contraparte_nombre TEXT,
        doc_tributario_tipo  TEXT,
        doc_tributario_folio TEXT,
        forma_pago     TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
]


@pytest_asyncio.fixture(scope="session")
async def _vouchers_schema_bulk(_engine: Any) -> AsyncIterator[Any]:
    """Crea tabla core.vouchers idempotente (compatible con otros tests)."""
    from sqlalchemy import text

    async with _engine.begin() as conn:
        for stmt in _VOUCHERS_DDL:
            try:
                await conn.execute(text(stmt))
            except Exception as exc:  # noqa: BLE001
                msg = str(exc).lower()
                if any(t in msg for t in ("already exists", "duplicate")):
                    continue
                raise
    yield _engine


_ADMIN_UID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def admin_headers() -> dict[str, str]:
    """Admin global con scope legal:write."""
    return {"Authorization": f"Bearer {make_token(sub=_ADMIN_UID, role='admin')}"}


@pytest_asyncio.fixture
async def voucher_factory(db_session: Any, _vouchers_schema_bulk: Any) -> Any:
    """Crea voucher con status configurable."""
    from sqlalchemy import text

    async def _factory(
        empresa_codigo: str = "TRONGKAI",
        status: str = "DRAFT",
        codigo: str | None = None,
    ) -> int:
        import uuid

        c = codigo or f"V-BULK-{uuid.uuid4().hex[:8]}"
        result = await db_session.execute(
            text(
                """
                INSERT INTO core.vouchers (codigo, empresa_codigo, status, glosa)
                VALUES (:c, :emp, :st, 'Glosa test bulk delete')
                RETURNING voucher_id
                """
            ),
            {"c": c, "emp": empresa_codigo, "st": status},
        )
        await db_session.commit()
        return int(result.scalar_one())

    return _factory


# =====================================================================
# Happy path — 2 DRAFT borrados OK
# =====================================================================
async def test_bulk_delete_drafts_happy_path_dos_drafts(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    v1 = await voucher_factory(status="DRAFT")
    v2 = await voucher_factory(status="DRAFT")

    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": [v1, v2]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["succeeded"] == 2
    assert body["failed"] == 0
    assert len(body["deleted_codes"]) == 2
    assert body["failures"] == []


# =====================================================================
# Failure: ID inexistente → entra a failures, NO rompe el lote
# =====================================================================
async def test_bulk_delete_drafts_id_inexistente_va_a_failures(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    v_ok = await voucher_factory(status="DRAFT")
    fake_id = 999_999_999

    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": [v_ok, fake_id]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["succeeded"] == 1
    assert body["failed"] == 1
    assert any(f["voucher_id"] == fake_id for f in body["failures"])
    reason_fake = next(
        f["reason"] for f in body["failures"] if f["voucher_id"] == fake_id
    )
    assert "no encontrado" in reason_fake.lower()


# =====================================================================
# Failure: status != DRAFT — solo DRAFT puede borrarse
# =====================================================================
async def test_bulk_delete_drafts_voucher_pending_no_borra(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    v_pending = await voucher_factory(status="PENDING")

    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": [v_pending]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["succeeded"] == 0
    assert body["failed"] == 1
    failure = body["failures"][0]
    assert failure["voucher_id"] == v_pending
    assert "PENDING" in failure["reason"]
    assert "DRAFT" in failure["reason"]


# =====================================================================
# Validacion Pydantic: voucher_ids vacio → 422
# =====================================================================
async def test_bulk_delete_drafts_ids_vacio_rechazado_422(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    _vouchers_schema_bulk: Any,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": []},
        headers=admin_headers,
    )
    assert r.status_code == 422


# =====================================================================
# Validacion Pydantic: > 200 IDs → 422
# =====================================================================
async def test_bulk_delete_drafts_mas_de_200_ids_rechazado_422(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    _vouchers_schema_bulk: Any,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": list(range(1, 202))},
        headers=admin_headers,
    )
    assert r.status_code == 422


# =====================================================================
# Mix: DRAFT + PENDING + inexistente en mismo request
# =====================================================================
async def test_bulk_delete_drafts_mix_exitoso_y_fallos(
    test_client_with_db: AsyncClient,
    admin_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    v_ok = await voucher_factory(status="DRAFT")
    v_pending = await voucher_factory(status="PENDING")
    v_fake = 999_999_998

    r = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-delete-drafts",
        json={"voucher_ids": [v_ok, v_pending, v_fake]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["succeeded"] == 1
    assert body["failed"] == 2
    # cada fallo trae voucher_id + reason
    fail_ids = {f["voucher_id"] for f in body["failures"]}
    assert v_pending in fail_ids
    assert v_fake in fail_ids
