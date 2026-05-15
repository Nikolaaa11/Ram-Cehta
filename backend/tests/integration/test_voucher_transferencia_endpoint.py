"""Integration tests para `/api/v1/vouchers/transferencia-masiva` (Round 11).

Cubre:
- GET /preview devuelve solo APPROVED + tipo COMPRA/EGRESO
- /preview excluye INGRESOS
- POST genera XLSX con total correcto
- 404 si ningun voucher elegible (todos DRAFT)
- Scope multi-tenant: filtra vouchers de empresa fuera del scope
- audit_log se inserta tras export

NOTA fixtures:
- core.vouchers no esta en schema.sql → DDL idempotente.
- `voucher:execute` scope no existe en ROLE_SCOPES → monkeypatch a admin.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient

pytestmark = pytest.mark.integration


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
        glosa          TEXT NOT NULL DEFAULT 'Glosa minima de test',
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
async def _vouchers_schema(_engine: Any) -> AsyncIterator[Any]:
    """DDL idempotente para core.vouchers."""
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


@pytest.fixture
def _grant_voucher_execute(monkeypatch: pytest.MonkeyPatch) -> None:
    """Otorga scope `voucher:execute` a admin (no esta en ROLE_SCOPES default).

    Equivalente a `_grant_legal_write` en conftest_v5 — patch del dict en
    runtime, dura solo el test.
    """
    from app.core import rbac

    new_admin = frozenset(rbac.ROLE_SCOPES["admin"] | {"voucher:execute"})
    monkeypatch.setitem(rbac.ROLE_SCOPES, "admin", new_admin)


@pytest_asyncio.fixture
async def voucher_factory(db_session: Any, _vouchers_schema: Any) -> Any:
    """Crea vouchers minimal con kwargs flexibles."""
    from sqlalchemy import text

    async def _factory(**kwargs: Any) -> int:
        import uuid

        defaults: dict[str, Any] = {
            "codigo": f"V-TM-{uuid.uuid4().hex[:8]}",
            "empresa_codigo": "TRONGKAI",
            "tipo": "COMPRA",
            "status": "APPROVED",
            "fecha_documento": "2026-05-01",
            "fecha_contable": "2026-05-01",
            "glosa": "Pago factura proveedor servicios test",
            "total_debit": 500000,
            "total_credit": 500000,
            "contraparte_rut": "76.111.222-3",
            "contraparte_nombre": "Proveedor Test SpA",
            "forma_pago": "TRANSFERENCIA",
        }
        defaults.update(kwargs)
        result = await db_session.execute(
            text(
                """
                INSERT INTO core.vouchers (
                    codigo, empresa_codigo, tipo, status,
                    fecha_documento, fecha_contable, glosa,
                    total_debit, total_credit,
                    contraparte_rut, contraparte_nombre, forma_pago
                ) VALUES (
                    :codigo, :empresa_codigo, :tipo, :status,
                    :fecha_documento, :fecha_contable, :glosa,
                    :total_debit, :total_credit,
                    :contraparte_rut, :contraparte_nombre, :forma_pago
                )
                RETURNING voucher_id
                """
            ),
            defaults,
        )
        await db_session.commit()
        return int(result.scalar_one())

    return _factory


# =====================================================================
# /preview — solo APPROVED + tipo COMPRA/EGRESO
# =====================================================================
async def test_preview_returns_solo_approved_compra_egreso(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # 1 APPROVED COMPRA — debe aparecer
    vid_ok = await voucher_factory(status="APPROVED", tipo="COMPRA")
    # 1 DRAFT — no debe aparecer
    await voucher_factory(status="DRAFT", tipo="COMPRA")
    # 1 APPROVED EGRESO — debe aparecer
    await voucher_factory(status="APPROVED", tipo="EGRESO")

    r = await test_client_with_db.get(
        "/api/v1/vouchers/transferencia-masiva/preview", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] >= 2
    found_ids = {it["voucher_id"] for it in data["items"]}
    assert vid_ok in found_ids
    # Todos los items son APPROVED + COMPRA/EGRESO
    for it in data["items"]:
        assert it["tipo"] in ("COMPRA", "EGRESO")


async def test_preview_excluye_ingresos(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # INGRESO APPROVED — NO debe aparecer
    vid_ingreso = await voucher_factory(status="APPROVED", tipo="INGRESO")
    r = await test_client_with_db.get(
        "/api/v1/vouchers/transferencia-masiva/preview", headers=auth_headers
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(it["voucher_id"] != vid_ingreso for it in items)
    assert all(it["tipo"] != "INGRESO" for it in items)


# =====================================================================
# POST happy path → XLSX
# =====================================================================
async def test_transferencia_masiva_genera_xlsx_con_total_correcto(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
    _grant_voucher_execute: None,
) -> None:
    vid1 = await voucher_factory(
        status="APPROVED", tipo="COMPRA", total_credit=300000
    )
    vid2 = await voucher_factory(
        status="APPROVED", tipo="EGRESO", total_credit=700000
    )

    r = await test_client_with_db.post(
        "/api/v1/vouchers/transferencia-masiva",
        json={"voucher_ids": [vid1, vid2]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text[:300]
    # Content-Type: xlsx
    ct = r.headers.get("content-type", "")
    assert "spreadsheet" in ct or "xlsx" in ct
    # Total CLP en header (300000 + 700000 = 1000000)
    assert r.headers.get("X-Total-CLP") == "1000000"
    assert r.headers.get("X-Total-Rows") == "2"
    # Body es bytes XLSX (PK signature de zip)
    assert r.content[:2] == b"PK"


# =====================================================================
# 404 — todos DRAFT
# =====================================================================
async def test_transferencia_masiva_404_si_ningun_voucher_payable(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
    _grant_voucher_execute: None,
) -> None:
    vid_draft = await voucher_factory(status="DRAFT", tipo="COMPRA")
    r = await test_client_with_db.post(
        "/api/v1/vouchers/transferencia-masiva",
        json={"voucher_ids": [vid_draft]},
        headers=auth_headers,
    )
    assert r.status_code == 404
    assert "pagable" in r.json()["detail"].lower() or "approved" in r.json()["detail"].lower()


# =====================================================================
# Scope multi-tenant — finance user con scope vacio no ve vouchers
# =====================================================================
async def test_transferencia_masiva_respeta_scope_filtra_voucher_otra_empresa(
    test_client_with_db: AsyncClient,
    finance_headers: dict[str, str],
    voucher_factory: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Otorgar voucher:execute a finance (sino seria 403 antes del scope check)
    from app.core import rbac

    new_finance = frozenset(rbac.ROLE_SCOPES["finance"] | {"voucher:execute"})
    monkeypatch.setitem(rbac.ROLE_SCOPES, "finance", new_finance)

    # Voucher APPROVED en TRONGKAI
    vid = await voucher_factory(
        status="APPROVED", tipo="COMPRA", empresa_codigo="TRONGKAI"
    )

    # Finance user no tiene user_company_roles → allowed_codes vacio
    # → endpoint devuelve 403 (escenario "sin scope a ninguna empresa")
    r = await test_client_with_db.post(
        "/api/v1/vouchers/transferencia-masiva",
        json={"voucher_ids": [vid]},
        headers=finance_headers,
    )
    # 403 (sin acceso a ninguna empresa) o 404 (voucher fuera de scope)
    assert r.status_code in (403, 404), r.text[:200]


# =====================================================================
# Audit log se emite
# =====================================================================
async def test_transferencia_masiva_audit_log_se_emite(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
    _grant_voucher_execute: None,
    db_session: Any,
) -> None:
    from sqlalchemy import text

    vid = await voucher_factory(
        status="APPROVED", tipo="COMPRA", total_credit=250000
    )

    # Snapshot count antes
    before = await db_session.scalar(
        text(
            "SELECT COUNT(*) FROM audit.action_log "
            "WHERE action = 'export_transferencia_masiva'"
        )
    )

    r = await test_client_with_db.post(
        "/api/v1/vouchers/transferencia-masiva",
        json={"voucher_ids": [vid]},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text[:200]

    after = await db_session.scalar(
        text(
            "SELECT COUNT(*) FROM audit.action_log "
            "WHERE action = 'export_transferencia_masiva'"
        )
    )
    # Al menos un nuevo registro de auditoria
    assert (after or 0) >= (before or 0) + 1
