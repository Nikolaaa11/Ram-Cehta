"""Integration tests para `/api/v1/vouchers/{id}/anomaly-check` y
`/api/v1/vouchers/anomaly-radar` (Etapa H).

Cubre:
- 404 voucher inexistente
- Voucher limpio → score bajo
- Folio duplicado → severity HIGH (score >= 30)
- Glosa corta (<15 chars) → severity LOW
- Fecha sabado/domingo → severity LOW
- Radar con min_score filtra
- Radar respeta scope multi-tenant

NOTA fixtures: core.vouchers no esta en `db/schema.sql` (vive en
alembic 0035). Lo creamos con DDL idempotente acá.
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
        glosa          TEXT NOT NULL DEFAULT 'Glosa minima de test xyz',
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


@pytest_asyncio.fixture
async def voucher_factory(db_session: Any, _vouchers_schema: Any) -> Any:
    """Factory de vouchers minimal con kwargs flexibles."""
    from sqlalchemy import text

    counter = {"n": 0}

    async def _factory(**kwargs: Any) -> int:
        counter["n"] += 1
        import uuid

        defaults: dict[str, Any] = {
            "codigo": f"V-ANO-{uuid.uuid4().hex[:8]}",
            "empresa_codigo": "TRONGKAI",
            "tipo": "COMPRA",
            "status": "APPROVED",
            "fecha_documento": "2026-05-04",  # lunes 2026-05-04
            "fecha_contable": "2026-05-04",
            "glosa": "Glosa de test integ anomaly suficientemente larga",
            "total_debit": 100000,
            "total_credit": 100000,
            "contraparte_rut": None,
            "contraparte_nombre": None,
            "doc_tributario_tipo": None,
            "doc_tributario_folio": None,
        }
        defaults.update(kwargs)

        sql = text(
            """
            INSERT INTO core.vouchers (
                codigo, empresa_codigo, tipo, status,
                fecha_documento, fecha_contable, glosa,
                total_debit, total_credit,
                contraparte_rut, contraparte_nombre,
                doc_tributario_tipo, doc_tributario_folio
            ) VALUES (
                :codigo, :empresa_codigo, :tipo, :status,
                :fecha_documento, :fecha_contable, :glosa,
                :total_debit, :total_credit,
                :contraparte_rut, :contraparte_nombre,
                :doc_tributario_tipo, :doc_tributario_folio
            )
            RETURNING voucher_id
            """
        )
        result = await db_session.execute(sql, defaults)
        await db_session.commit()
        return int(result.scalar_one())

    return _factory


# =====================================================================
# 404
# =====================================================================
async def test_anomaly_check_voucher_inexistente_devuelve_404(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    _vouchers_schema: Any,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/vouchers/999999999/anomaly-check", headers=auth_headers
    )
    assert r.status_code == 404


# =====================================================================
# Voucher limpio → score bajo (sin warnings HIGH)
# =====================================================================
async def test_anomaly_check_voucher_normal_score_bajo(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # lunes, glosa larga, sin folio, sin contraparte_rut → no warnings
    vid = await voucher_factory(
        fecha_documento="2026-05-04",  # lunes
        glosa="Glosa larga y descriptiva, mas de 15 caracteres",
        contraparte_rut=None,
    )
    r = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid}/anomaly-check", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["voucher_id"] == vid
    assert body["score"] < 30  # ningun HIGH


# =====================================================================
# Folio duplicado → severity HIGH (score >= 30)
# =====================================================================
async def test_anomaly_check_detecta_folio_duplicado(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # Crear 2 vouchers con mismo folio + proveedor + tipo_doc
    common = dict(
        contraparte_rut="76.123.456-7",
        contraparte_nombre="Proveedor X",
        doc_tributario_tipo="FACTURA",
        doc_tributario_folio="12345",
        status="APPROVED",
        empresa_codigo="TRONGKAI",
    )
    _vid1 = await voucher_factory(**common)
    vid2 = await voucher_factory(**common)

    r = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid2}/anomaly-check", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    codes = [w["code"] for w in body["warnings"]]
    assert "FOLIO_DUPLICADO" in codes
    assert body["score"] >= 30  # HIGH weight


# =====================================================================
# Glosa corta → LOW
# =====================================================================
async def test_anomaly_check_glosa_corta_LOW_severity(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory(glosa="pago corto")  # 10 chars
    r = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid}/anomaly-check", headers=auth_headers
    )
    assert r.status_code == 200
    warnings = r.json()["warnings"]
    glosa_w = [w for w in warnings if w["code"] == "GLOSA_CORTA"]
    assert len(glosa_w) == 1
    assert glosa_w[0]["severity"] == "LOW"


# =====================================================================
# Fecha sabado → LOW
# =====================================================================
async def test_anomaly_check_fecha_sabado_LOW_severity(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # 2026-05-02 = sabado
    vid = await voucher_factory(
        fecha_documento="2026-05-02",
        glosa="Glosa con largo suficiente para no flaggear corta",
    )
    r = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid}/anomaly-check", headers=auth_headers
    )
    assert r.status_code == 200
    warnings = r.json()["warnings"]
    dia_w = [w for w in warnings if w["code"] == "DIA_INUSUAL"]
    assert len(dia_w) == 1
    assert dia_w[0]["severity"] == "LOW"


# =====================================================================
# Radar: con min_score=30 solo devuelve HIGH
# =====================================================================
async def test_anomaly_radar_returns_only_high_score(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # 1 voucher "limpio" (score bajo)
    await voucher_factory(
        glosa="Glosa larga y descriptiva sin problemas",
        status="APPROVED",
    )
    # 2 vouchers con folio duplicado → score HIGH
    dup_kwargs = dict(
        contraparte_rut="77.555.111-2",
        contraparte_nombre="Proveedor Dup",
        doc_tributario_tipo="FACTURA",
        doc_tributario_folio="99999",
        status="APPROVED",
        empresa_codigo="REVTECH",
        glosa="Glosa larga ok para evitar low extra",
    )
    await voucher_factory(**dup_kwargs)
    await voucher_factory(**dup_kwargs)

    r = await test_client_with_db.get(
        "/api/v1/vouchers/anomaly-radar?min_score=30",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["threshold_score"] == 30
    # Todos los items devueltos tienen score >= 30
    for it in data["items"]:
        assert it["score"] >= 30
    # Y debe haber al menos uno (los dup)
    assert data["count"] >= 1


# =====================================================================
# Radar respeta scope (admin global vs user con scope vacio)
# =====================================================================
async def test_anomaly_radar_respeta_scope(
    test_client_with_db: AsyncClient,
    auth_headers: dict[str, str],
    finance_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    # Crear un voucher en REVTECH con score HIGH (folio duplicado)
    dup_kwargs = dict(
        contraparte_rut="77.777.222-3",
        contraparte_nombre="Prov Scope Test",
        doc_tributario_tipo="FACTURA",
        doc_tributario_folio="88888",
        status="APPROVED",
        empresa_codigo="REVTECH",
        glosa="Glosa larga ok evitar low",
    )
    await voucher_factory(**dup_kwargs)
    await voucher_factory(**dup_kwargs)

    # Admin (global scope) ve los items
    r_admin = await test_client_with_db.get(
        "/api/v1/vouchers/anomaly-radar?min_score=30",
        headers=auth_headers,
    )
    assert r_admin.status_code == 200
    admin_count = r_admin.json()["count"]
    assert admin_count >= 1

    # finance_headers tiene role='finance', no es admin → scope.allowed_codes
    # se evalua via user_company_roles; finance user no tiene roles asignados
    # → allowed_codes vacio → radar devuelve lista vacia
    r_scoped = await test_client_with_db.get(
        "/api/v1/vouchers/anomaly-radar?min_score=30",
        headers=finance_headers,
    )
    assert r_scoped.status_code == 200
    assert r_scoped.json()["count"] == 0
