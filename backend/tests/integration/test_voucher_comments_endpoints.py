"""Integration tests para `/api/v1/vouchers/{id}/comments` (Etapa M).

Cubre:
- POST + GET happy path con can_edit=True para autor
- 404 cuando voucher no existe (GET y POST)
- Validacion body (min_length=1, max_length=2000) → 422
- PATCH resolved por no-autor con scope (admin global)
- PATCH body por no-autor → 403
- DELETE solo por autor

NOTA fixtures: como `db/schema.sql` no contiene `core.vouchers` ni
`core.voucher_comments` (ambas viven en alembic migrations 0035 y 0059),
acá creamos las tablas con DDL idempotente — mismo patron que
`conftest_v5._v5_schema`.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from jose import jwt

from tests.integration.conftest import ISSUER, SECRET, make_token

pytestmark = pytest.mark.integration


# DDL minima para vouchers + voucher_comments. Sin triggers ni CHECKs
# pesados (no son necesarios para los tests de comments).
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
    """
    CREATE TABLE IF NOT EXISTS core.voucher_comments (
        comment_id   BIGSERIAL PRIMARY KEY,
        voucher_id   BIGINT NOT NULL
                     REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
        user_id      UUID NOT NULL,
        user_email   TEXT NOT NULL,
        body         TEXT NOT NULL CHECK (length(trim(body)) >= 1),
        resolved     BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
]


@pytest_asyncio.fixture(scope="session")
async def _vouchers_schema(_engine: Any) -> AsyncIterator[Any]:
    """Crea tablas core.vouchers + core.voucher_comments (idempotente)."""
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


# UUIDs estables para los dos users del test — coinciden con los `sub`
# usados en los headers (deben ser UUIDs válidos para el cast UUID).
_AUTHOR_UID = "11111111-1111-4111-8111-111111111111"
_OTHER_UID = "22222222-2222-4222-8222-222222222222"


@pytest.fixture
def author_headers() -> dict[str, str]:
    """User autor del comment — admin para scope global."""
    return {"Authorization": f"Bearer {make_token(sub=_AUTHOR_UID, role='admin')}"}


@pytest.fixture
def other_headers() -> dict[str, str]:
    """Otro user admin distinto — para tests de no-autor."""
    return {"Authorization": f"Bearer {make_token(sub=_OTHER_UID, role='admin')}"}


@pytest_asyncio.fixture
async def voucher_factory(db_session: Any, _vouchers_schema: Any) -> Any:
    """Crea un voucher minimal en la transaccion del test."""
    from sqlalchemy import text

    async def _factory(
        empresa_codigo: str = "TRONGKAI",
        codigo: str | None = None,
    ) -> int:
        import uuid

        c = codigo or f"V-COMM-{uuid.uuid4().hex[:8]}"
        result = await db_session.execute(
            text(
                """
                INSERT INTO core.vouchers (codigo, empresa_codigo, glosa)
                VALUES (:c, :emp, 'Glosa de test integ comments')
                RETURNING voucher_id
                """
            ),
            {"c": c, "emp": empresa_codigo},
        )
        await db_session.commit()
        return int(result.scalar_one())

    return _factory


# =====================================================================
# Happy path: POST + GET
# =====================================================================
async def test_post_comment_y_get_devuelve_can_edit_true_para_autor(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()

    r_post = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": "Falta confirmar RUT del proveedor"},
        headers=author_headers,
    )
    assert r_post.status_code == 201, r_post.text
    body = r_post.json()
    assert body["body"] == "Falta confirmar RUT del proveedor"
    assert body["resolved"] is False
    assert body["can_edit"] is True

    r_get = await test_client_with_db.get(
        f"/api/v1/vouchers/{vid}/comments", headers=author_headers
    )
    assert r_get.status_code == 200
    items = r_get.json()
    assert len(items) == 1
    assert items[0]["can_edit"] is True


# =====================================================================
# 404 — voucher no existe
# =====================================================================
async def test_404_si_voucher_inexistente_get_comments(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    _vouchers_schema: Any,
) -> None:
    r = await test_client_with_db.get(
        "/api/v1/vouchers/999999999/comments", headers=author_headers
    )
    assert r.status_code == 404


async def test_404_si_voucher_inexistente_post_comment(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    _vouchers_schema: Any,
) -> None:
    r = await test_client_with_db.post(
        "/api/v1/vouchers/999999999/comments",
        json={"body": "test"},
        headers=author_headers,
    )
    assert r.status_code == 404


# =====================================================================
# Validacion body — Pydantic min_length=1 / max_length=2000
# =====================================================================
async def test_post_comment_body_vacio_rechazado(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()
    r = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": ""},
        headers=author_headers,
    )
    assert r.status_code == 422


async def test_post_comment_body_demasiado_largo(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()
    r = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": "x" * 2001},
        headers=author_headers,
    )
    assert r.status_code == 422


# =====================================================================
# Mark resolved — cualquier user con scope (autor + otro)
# =====================================================================
async def test_mark_resolved_cualquier_user_con_scope(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    other_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()

    # Autor crea
    r_post = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": "Pregunta operativa"},
        headers=author_headers,
    )
    assert r_post.status_code == 201
    cid = r_post.json()["comment_id"]

    # Otro user (no autor, pero admin con scope) marca resolved=True
    r_patch = await test_client_with_db.patch(
        f"/api/v1/vouchers/{vid}/comments/{cid}",
        json={"resolved": True},
        headers=other_headers,
    )
    assert r_patch.status_code == 200, r_patch.text
    assert r_patch.json()["resolved"] is True

    # Autor marca resolved=False de vuelta (tambien permitido)
    r_patch2 = await test_client_with_db.patch(
        f"/api/v1/vouchers/{vid}/comments/{cid}",
        json={"resolved": False},
        headers=author_headers,
    )
    assert r_patch2.status_code == 200
    assert r_patch2.json()["resolved"] is False


# =====================================================================
# PATCH body por no-autor → 403
# =====================================================================
async def test_patch_body_no_autor_devuelve_403(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    other_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()
    r_post = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": "Texto original del autor"},
        headers=author_headers,
    )
    cid = r_post.json()["comment_id"]

    # Otro user intenta editar el body (no es autor)
    r = await test_client_with_db.patch(
        f"/api/v1/vouchers/{vid}/comments/{cid}",
        json={"body": "Texto editado por intruso"},
        headers=other_headers,
    )
    assert r.status_code == 403


# =====================================================================
# DELETE solo por autor
# =====================================================================
async def test_delete_comment_solo_autor(
    test_client_with_db: AsyncClient,
    author_headers: dict[str, str],
    other_headers: dict[str, str],
    voucher_factory: Any,
) -> None:
    vid = await voucher_factory()
    r_post = await test_client_with_db.post(
        f"/api/v1/vouchers/{vid}/comments",
        json={"body": "Comment a borrar"},
        headers=author_headers,
    )
    cid = r_post.json()["comment_id"]

    # No-autor intenta borrar → 403
    r_other = await test_client_with_db.delete(
        f"/api/v1/vouchers/{vid}/comments/{cid}",
        headers=other_headers,
    )
    assert r_other.status_code == 403

    # Autor borra → 204
    r_author = await test_client_with_db.delete(
        f"/api/v1/vouchers/{vid}/comments/{cid}",
        headers=author_headers,
    )
    assert r_author.status_code == 204
