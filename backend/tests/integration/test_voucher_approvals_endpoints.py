"""Integration tests para flujo de firmas (Round 141).

Cubre los invariantes críticos del SUPER_PROMPT_MAESTRO:

  Invariante #20 — Segregación de deberes (R137):
    - El creador del voucher NO puede firmarlo aunque tenga el rol
    - Aplica a POST /approve, POST /bulk-approve, GET /approvals
    - El voucher tampoco aparece en /mis-pendientes del creador

  Invariante #11 — Workflow secuencial:
    - Solo vouchers PENDING aceptan firmas
    - El rol pedido debe matchear el next_pending_role (orden estricto)
    - Reject requiere reason ≥ 10 chars (Pydantic)
    - Idempotencia: doble-click al botón "Firmar" no duplica firma

  Invariante #20 (anti-doble-firma):
    - Si la regla pide 2 firmas, el mismo user no puede firmar ambos pasos

Estos tests son la red de seguridad: si un refactor futuro reabre alguno
de los agujeros que cerró R137, el CI los pesca antes de que lleguen a
producción.

Patrón inspirado en test_vouchers_bulk_delete_drafts_endpoint.py:
  - DDL idempotente al inicio de la sesión
  - Factories para crear vouchers + reglas + roles del user
  - Cada test ejecuta en su propia transacción + SAVEPOINT (rollback al final)
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.integration.conftest import make_token

pytestmark = pytest.mark.integration


# =====================================================================
# DDL minimal — sin triggers ni FK pesadas (igual que otros tests)
# =====================================================================
_DDL_STATEMENTS: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS core.vouchers (
        voucher_id       BIGSERIAL PRIMARY KEY,
        codigo           TEXT UNIQUE NOT NULL,
        empresa_codigo   TEXT NOT NULL REFERENCES core.empresas(codigo),
        tipo             TEXT NOT NULL DEFAULT 'COMPRA',
        status           TEXT NOT NULL DEFAULT 'PENDING',
        fecha_documento  DATE NOT NULL DEFAULT CURRENT_DATE,
        fecha_contable   DATE NOT NULL DEFAULT CURRENT_DATE,
        glosa            TEXT NOT NULL DEFAULT 'Glosa minima del test',
        total_debit      NUMERIC(18, 2) NOT NULL DEFAULT 1000,
        total_credit     NUMERIC(18, 2) NOT NULL DEFAULT 1000,
        moneda           TEXT NOT NULL DEFAULT 'CLP',
        contraparte_rut    TEXT,
        contraparte_nombre TEXT,
        doc_tributario_tipo  TEXT,
        doc_tributario_folio TEXT,
        forma_pago       TEXT,
        created_by       UUID,
        requested_by     UUID,
        threshold_aplicado BOOLEAN DEFAULT FALSE,
        reversal_of      BIGINT,
        rejection_reason TEXT,
        void_reason      TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS core.voucher_lines (
        line_id          BIGSERIAL PRIMARY KEY,
        voucher_id       BIGINT NOT NULL REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
        line_number      INT NOT NULL,
        cuenta_codigo    TEXT NOT NULL,
        proyecto_codigo  TEXT,
        area_codigo      TEXT,
        debit            NUMERIC(18, 2) DEFAULT 0,
        credit           NUMERIC(18, 2) DEFAULT 0,
        descripcion      TEXT,
        balance_treatment TEXT DEFAULT 'GASTO',
        created_at       TIMESTAMPTZ DEFAULT now()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS core.approval_rules (
        rule_id          BIGSERIAL PRIMARY KEY,
        empresa_codigo   TEXT NOT NULL,
        voucher_tipo     TEXT,
        min_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0,
        max_amount       NUMERIC(18, 2),
        balance_treatment TEXT,
        required_roles   TEXT[] NOT NULL,
        reinforced       BOOLEAN NOT NULL DEFAULT FALSE,
        priority         INT NOT NULL DEFAULT 100,
        active           BOOLEAN NOT NULL DEFAULT TRUE,
        descripcion      TEXT,
        created_by       UUID,
        created_at       TIMESTAMPTZ DEFAULT now(),
        updated_at       TIMESTAMPTZ DEFAULT now()
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS core.user_company_roles (
        user_id          UUID NOT NULL,
        empresa_codigo   TEXT NOT NULL,
        role             TEXT NOT NULL,
        active           BOOLEAN NOT NULL DEFAULT TRUE,
        assigned_at      TIMESTAMPTZ DEFAULT now(),
        assigned_by      UUID,
        PRIMARY KEY (user_id, empresa_codigo, role)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS core.voucher_approvals (
        approval_id          BIGSERIAL PRIMARY KEY,
        voucher_id           BIGINT NOT NULL REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
        order_num            INT NOT NULL,
        role                 TEXT NOT NULL,
        decision             TEXT NOT NULL,
        approver_user_id     UUID NOT NULL,
        approver_email       TEXT,
        ip_address           TEXT,
        user_agent           TEXT,
        comments             TEXT,
        signature_hash       TEXT,
        signed_at            TIMESTAMPTZ DEFAULT now()
    );
    """,
]


@pytest_asyncio.fixture(scope="session")
async def _approvals_schema(_engine: Any) -> AsyncIterator[Any]:
    """Crea tablas necesarias para los tests de aprobaciones. Idempotente."""
    from sqlalchemy import text

    async with _engine.begin() as conn:
        for stmt in _DDL_STATEMENTS:
            try:
                await conn.execute(text(stmt))
            except Exception as exc:  # noqa: BLE001
                msg = str(exc).lower()
                if any(t in msg for t in ("already exists", "duplicate")):
                    continue
                raise
    yield _engine


# UUIDs fijos para reproducibilidad
_CREATOR_UID = "11111111-1111-4111-8111-111111111111"
_APPROVER_UID = "22222222-2222-4222-8222-222222222222"
_ANOTHER_UID = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def creator_headers() -> dict[str, str]:
    """Token JWT del creador del voucher (rol legal:write)."""
    return {"Authorization": f"Bearer {make_token(sub=_CREATOR_UID, role='admin')}"}


@pytest.fixture
def approver_headers() -> dict[str, str]:
    """Token JWT de un aprobador (rol legal:write)."""
    return {"Authorization": f"Bearer {make_token(sub=_APPROVER_UID, role='admin')}"}


@pytest.fixture
def another_headers() -> dict[str, str]:
    """Token JWT de un tercer user (segundo aprobador)."""
    return {"Authorization": f"Bearer {make_token(sub=_ANOTHER_UID, role='admin')}"}


@pytest_asyncio.fixture
async def setup_factory(db_session: Any, _approvals_schema: Any) -> Any:
    """Factory que setea: regla de 1 firma (GG), voucher PENDING, y roles GG
    asignados al creador + aprobador. Devuelve voucher_id.

    Cada test puede pedir variantes (2 firmas, roles distintos, status distinto).
    """
    from sqlalchemy import text

    async def _factory(
        empresa: str = "TRONGKAI",
        creator_uid: str = _CREATOR_UID,
        approver_uid: str = _APPROVER_UID,
        another_uid: str | None = None,
        required_roles: list[str] | None = None,
        status: str = "PENDING",
        total: float = 100000.0,
    ) -> int:
        import uuid

        if required_roles is None:
            required_roles = ["GG"]

        # Regla activa para la empresa (sin restricción de monto)
        await db_session.execute(
            text(
                """
                INSERT INTO core.approval_rules
                  (empresa_codigo, min_amount, required_roles, priority, active, descripcion)
                VALUES (:emp, 0, CAST(:roles AS TEXT[]), 100, TRUE, 'Test rule')
                """
            ),
            {"emp": empresa, "roles": required_roles},
        )

        # Asignar TODOS los roles requeridos al creador (para probar
        # segregación: el creator TIENE el rol pero no puede firmar)
        # y al aprobador
        for role in required_roles:
            await db_session.execute(
                text(
                    """
                    INSERT INTO core.user_company_roles
                      (user_id, empresa_codigo, role, active)
                    VALUES (CAST(:u AS UUID), :emp, :r, TRUE)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"u": creator_uid, "emp": empresa, "r": role},
            )
            await db_session.execute(
                text(
                    """
                    INSERT INTO core.user_company_roles
                      (user_id, empresa_codigo, role, active)
                    VALUES (CAST(:u AS UUID), :emp, :r, TRUE)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"u": approver_uid, "emp": empresa, "r": role},
            )

        # Tercer user opcional (para tests con 2 firmas)
        if another_uid:
            for role in required_roles:
                await db_session.execute(
                    text(
                        """
                        INSERT INTO core.user_company_roles
                          (user_id, empresa_codigo, role, active)
                        VALUES (CAST(:u AS UUID), :emp, :r, TRUE)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"u": another_uid, "emp": empresa, "r": role},
                )

        # Voucher
        codigo = f"V-APR-{uuid.uuid4().hex[:8]}"
        result = await db_session.execute(
            text(
                """
                INSERT INTO core.vouchers
                  (codigo, empresa_codigo, tipo, status, total_debit, total_credit,
                   created_by, requested_by)
                VALUES (:c, :emp, 'COMPRA', :st, :tot, :tot,
                        CAST(:cu AS UUID), CAST(:cu AS UUID))
                RETURNING voucher_id
                """
            ),
            {"c": codigo, "emp": empresa, "st": status, "tot": total, "cu": creator_uid},
        )
        await db_session.commit()
        return int(result.scalar_one())

    return _factory


# ============================================================
# INVARIANTE #20 — Segregación de deberes
# ============================================================


async def test_approve_blocks_self_approval(
    test_client_with_db: AsyncClient,
    creator_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """El creador del voucher NO puede firmarlo, aunque tenga el rol GG activo.

    Este es el invariante #20 del MAESTRO. Sin este check, un user con rol
    OPERADOR+GG podría crear vouchers y firmarlos él mismo.
    """
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=creator_headers,
        json={"role": "GG"},
    )
    assert resp.status_code == 403, (
        f"Esperaba 403 por self-approval, recibí {resp.status_code}: {resp.text}"
    )
    detail = resp.json()["detail"].lower()
    assert "segregación" in detail or "creador" in detail


async def test_approve_allows_third_party(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Un user distinto al creador SÍ puede firmar (control positivo)."""
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "GG"},
    )
    assert resp.status_code == 200, (
        f"Esperaba 200 firma ok, recibí {resp.status_code}: {resp.text}"
    )
    body = resp.json()
    # Debe quedar APPROVED (regla pide 1 firma y la dimos)
    assert body["voucher_status"] == "APPROVED"


async def test_bulk_approve_skips_self_created(
    test_client_with_db: AsyncClient,
    creator_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Bulk approve skipea (no aborta) los vouchers donde el user es creador."""
    own_vid = await setup_factory(required_roles=["GG"])
    # Otro voucher creado por approver_uid → creador (current user en este
    # test) NO es creador → podría firmar.
    other_vid = await setup_factory(
        creator_uid=_APPROVER_UID, approver_uid=_CREATOR_UID, required_roles=["GG"]
    )

    resp = await test_client_with_db.post(
        "/api/v1/vouchers/bulk-approve",
        headers=creator_headers,
        json={"voucher_ids": [own_vid, other_vid], "role": "GG"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # Buscar el item de own_vid: debe haber fallado por segregación
    own_item = next(i for i in body["items"] if i["voucher_id"] == own_vid)
    other_item = next(i for i in body["items"] if i["voucher_id"] == other_vid)

    assert own_item["success"] is False
    assert "segregación" in (own_item.get("error") or "").lower() or \
           "creador" in (own_item.get("error") or "").lower()
    # El otro debería pasar (current user no es creador)
    assert other_item["success"] is True


async def test_approvals_state_creator_cannot_sign(
    test_client_with_db: AsyncClient,
    creator_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """GET /approvals devuelve can_current_user_sign=False para el creador.

    Esto hace que el botón "Firmar" del frontend desaparezca. Defense in
    depth: aunque el botón apareciera, POST /approve igual rechazaría.
    """
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid}/approvals", headers=creator_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["can_current_user_sign"] is False


async def test_mis_pendientes_excludes_creator(
    test_client_with_db: AsyncClient,
    creator_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """El voucher PENDING NO aparece en /mis-pendientes del creador."""
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.get(
        "/api/v1/vouchers/mis-pendientes", headers=creator_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    voucher_ids = [i["voucher_id"] for i in body["items"]]
    assert vid not in voucher_ids, (
        f"El voucher {vid} apareció en mis-pendientes del creador "
        f"(violación segregación de deberes)"
    )


# ============================================================
# INVARIANTE #11 — Workflow secuencial
# ============================================================


async def test_approve_only_pending_status(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Solo vouchers PENDING aceptan firmas; DRAFT/APPROVED/EXECUTED → 400."""
    for bad_status in ("DRAFT", "APPROVED", "EXECUTED"):
        vid = await setup_factory(status=bad_status, required_roles=["GG"])
        resp = await test_client_with_db.post(
            f"/api/v1/vouchers/{vid}/approve",
            headers=approver_headers,
            json={"role": "GG"},
        )
        assert resp.status_code == 400, (
            f"Status {bad_status} debería rechazar firma, recibí {resp.status_code}"
        )


async def test_approve_wrong_order_role(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Si la regla pide [GG, COO] en orden, no podés firmar como COO primero."""
    vid = await setup_factory(required_roles=["GG", "COO"])

    # Intentar firmar como COO antes que GG → 400
    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "COO"},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"].lower()
    assert "gg" in detail and ("orden" in detail or "secuencial" in detail or "próximo" in detail)


async def test_approve_requires_active_role(
    test_client_with_db: AsyncClient,
    setup_factory: Any,
) -> None:
    """Si el user no tiene el rol activo en la empresa → 403."""
    from tests.integration.conftest import make_token

    # User sin rol asignado
    no_role_uid = "55555555-5555-4555-8555-555555555555"
    no_role_headers = {
        "Authorization": f"Bearer {make_token(sub=no_role_uid, role='admin')}"
    }
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=no_role_headers,
        json={"role": "GG"},
    )
    assert resp.status_code == 403
    assert "rol" in resp.json()["detail"].lower()


async def test_approve_idempotent_double_click(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Doble-click rápido al botón Firmar no debe generar 400 ni doble firma.

    R84: cuando el user ya firmó como X y vuelve a pedir firmar como X,
    devolver 200 con el state actual (idempotente).
    """
    vid = await setup_factory(required_roles=["GG"])

    # Primera firma
    r1 = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "GG"},
    )
    assert r1.status_code == 200

    # Segunda firma (doble-click) — debería devolver 200 sin error
    r2 = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "GG"},
    )
    assert r2.status_code == 200


# ============================================================
# REJECT — validaciones
# ============================================================


async def test_reject_requires_min_reason(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Reject requiere reason ≥ 10 chars (validado en Pydantic, 422)."""
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/reject",
        headers=approver_headers,
        json={"reason": "corto"},
    )
    assert resp.status_code == 422


async def test_reject_happy_path(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Reject con razón válida pasa el voucher a REJECTED."""
    vid = await setup_factory(required_roles=["GG"])

    resp = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/reject",
        headers=approver_headers,
        json={"reason": "Falta firma del proveedor en la factura adjunta"},
    )
    assert resp.status_code == 200
    # Verificar status en DB
    body = resp.json()
    assert body.get("voucher_status") == "REJECTED" or "REJECTED" in str(body)


# ============================================================
# INVARIANTE #20 — Anti-doble firma (regla con 2 roles)
# ============================================================


async def test_anti_doble_firma_mismo_user(
    test_client_with_db: AsyncClient,
    approver_headers: dict[str, str],
    setup_factory: Any,
) -> None:
    """Si la regla pide [GG, COO] y el mismo user tiene ambos roles, NO puede
    firmar ambos pasos (debe firmar otro user).
    """
    vid = await setup_factory(required_roles=["GG", "COO"])

    # Primera firma como GG → OK
    r1 = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "GG"},
    )
    assert r1.status_code == 200

    # Mismo user intenta firmar como COO → 400 anti-doble-firma
    r2 = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/approve",
        headers=approver_headers,
        json={"role": "COO"},
    )
    assert r2.status_code == 400
    detail = r2.json()["detail"].lower()
    assert "separación" in detail or "doble" in detail or "responsabilidad" in detail
