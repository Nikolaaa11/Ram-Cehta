"""Fixtures de integración para tests con Postgres real.

Estrategia (decisión documentada):

1. **No usamos testcontainers en este proyecto.** Falla en Windows local sin
   Docker Desktop y agrega ~10s por sesión incluso en CI. En su lugar:

2. **Tests requieren Postgres "ya disponible".** En CI lo provee el `services:
   postgres` del workflow `backend-ci.yml` (DATABASE_URL ya seteado). En local
   un dev puede levantarlo manualmente y exportar `TEST_DATABASE_URL`.

3. **Si no hay DB disponible**, los tests de DB se skipean en runtime con
   mensaje claro — NO fallan. Los tests de auth/validate (que no usan DB) se
   siguen ejecutando.

4. **Una sesión** carga schema.sql + views.sql una sola vez (`session` scope).

5. **Aislamiento** vía SAVEPOINT por test (nested transaction): cada test
   recibe una `AsyncSession` ligada a una conexión con transacción exterior;
   al terminar se hace ROLLBACK. Tests no dependen del orden de ejecución.

6. **Override de `db_session`** del API: inyectamos la sesión transaccional
   del test, así los endpoints leen/escriben en la misma transacción que
   luego se rollbackea.
"""
from __future__ import annotations

import os
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from jose import jwt

SECRET = "test-secret"
ISSUER = "https://example.supabase.co/auth/v1"


# ---------------------------------------------------------------------------
# JWT helpers (sin DB)
# ---------------------------------------------------------------------------
def make_token(sub: str = "test-uid", role: str = "admin", secret: str = SECRET) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "email": f"{sub}@test.cl",
        "app_role": role,
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": now + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub='admin-uid', role='admin')}"}


@pytest.fixture
def finance_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub='finance-uid', role='finance')}"}


@pytest.fixture
def viewer_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(sub='viewer-uid', role='viewer')}"}


# ---------------------------------------------------------------------------
# Cliente HTTP (sin DB) — usado por tests que no tocan Postgres
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def test_client() -> AsyncIterator[AsyncClient]:
    """Cliente sin override de DB. Útil para auth/validate."""
    from app.main import app

    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ---------------------------------------------------------------------------
# DB fixtures (con detección + skip)
# ---------------------------------------------------------------------------
def _resolve_test_db_url() -> str | None:
    """Resuelve la URL de Postgres para tests.

    Prioridad:
    1. `TEST_DATABASE_URL` explícito (preferido — separación de prod).
    2. `DATABASE_URL` (lo provee el CI; en local apunta a Supabase prod, NO
       queremos correr tests destructivos contra eso, así que requerimos
       además flag `ALLOW_DB_TESTS_ON_DEFAULT=1`).
    3. None → skip.
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url

    url = os.environ.get("DATABASE_URL")
    if url and os.environ.get("ALLOW_DB_TESTS_ON_DEFAULT") == "1":
        return url

    # En CI, DATABASE_URL apunta a un Postgres efímero del workflow — seguro
    # de usar. Detectamos CI por env var GITHUB_ACTIONS.
    if url and os.environ.get("GITHUB_ACTIONS") == "true":
        return url

    return None


_DB_URL = _resolve_test_db_url()


def _skip_if_no_db() -> None:
    if _DB_URL is None:
        pytest.skip(
            "No hay Postgres para tests de integración. "
            "Setear TEST_DATABASE_URL=postgresql+asyncpg://user:pass@host/db "
            "(o ALLOW_DB_TESTS_ON_DEFAULT=1 si querés usar DATABASE_URL). "
            "En CI esto se setea automáticamente en .github/workflows/backend-ci.yml.",
            allow_module_level=False,
        )


def _normalize_async_url(url: str) -> str:
    """Asegura el driver asyncpg en la URL."""
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


SCHEMA_SQL = Path(__file__).resolve().parents[2] / "db" / "schema.sql"
VIEWS_SQL = Path(__file__).resolve().parents[2] / "db" / "views.sql"


def _split_sql(sql: str) -> list[str]:
    """Split naive por ';' respetando bloques DO $$ ... $$.

    No es un parser SQL completo; alcanza para nuestro schema.sql que tiene
    un solo bloque DO $$ ... $$ (el de los triggers).
    """
    out: list[str] = []
    buf: list[str] = []
    in_dollar = False
    for line in sql.splitlines():
        stripped = line.strip()
        # detect $$ delimiters
        if "$$" in stripped:
            # toggle por cada $$ en la línea
            count = stripped.count("$$")
            for _ in range(count):
                in_dollar = not in_dollar
        buf.append(line)
        if not in_dollar and stripped.endswith(";"):
            stmt = "\n".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
    if buf:
        rest = "\n".join(buf).strip()
        if rest:
            out.append(rest)
    return out


@pytest_asyncio.fixture(scope="session")
async def _engine() -> AsyncIterator[Any]:
    """Crea el engine de Postgres y carga el schema una vez por sesión."""
    _skip_if_no_db()
    assert _DB_URL is not None  # narrowing para mypy

    from sqlalchemy.ext.asyncio import create_async_engine

    url = _normalize_async_url(_DB_URL)
    engine = create_async_engine(
        url,
        echo=False,
        pool_pre_ping=True,
        # Necesario con pgbouncer transaction-mode (Supabase).
        connect_args={"statement_cache_size": 0},
    )

    # Carga schema + views (idempotente: usa CREATE ... IF NOT EXISTS).
    schema_sql = SCHEMA_SQL.read_text(encoding="utf-8")
    views_sql = VIEWS_SQL.read_text(encoding="utf-8")
    statements = _split_sql(schema_sql) + _split_sql(views_sql)

    from sqlalchemy import text

    async with engine.begin() as conn:
        for stmt in statements:
            # Skip empty / commentary-only chunks
            cleaned = "\n".join(
                line for line in stmt.splitlines() if not line.strip().startswith("--")
            ).strip()
            if not cleaned:
                continue
            try:
                await conn.execute(text(stmt))
            except Exception as exc:  # noqa: BLE001
                # Algunas sentencias pueden fallar si el catálogo ya existe
                # con conflictos (p.ej. INSERT seed con nuevos rows). Las
                # ignoramos para idempotencia.
                msg = str(exc).lower()
                if any(t in msg for t in ("already exists", "duplicate", "conflict")):
                    continue
                raise

    # Catálogos mínimos para FK de movimientos
    async with engine.begin() as conn:
        await conn.execute(
            text(
                """
                INSERT INTO core.concepto_general (concepto_general)
                VALUES ('Operacion'), ('Inversion'), ('Sin clasificar')
                ON CONFLICT DO NOTHING;
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO core.proyecto (proyecto)
                VALUES ('General'), ('PTEC')
                ON CONFLICT DO NOTHING;
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO core.banco (banco)
                VALUES ('BCI'), ('Santander')
                ON CONFLICT DO NOTHING;
                """
            )
        )

    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(_engine: Any) -> AsyncIterator[Any]:
    """Sesión con transacción exterior + SAVEPOINT por test.

    Usa `join_transaction_mode="create_savepoint"` (SQLAlchemy 2.0+):
    cuando el endpoint hace `await db.commit()`, sólo se cierra el
    SAVEPOINT — la transacción exterior permanece abierta. Al final del
    test, hacemos ROLLBACK de la exterior y la DB queda limpia.
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    connection = await _engine.connect()
    transaction = await connection.begin()
    session = AsyncSession(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    try:
        yield session
    finally:
        await session.close()
        if transaction.is_active:
            await transaction.rollback()
        await connection.close()


@pytest_asyncio.fixture
async def test_client_with_db(db_session: Any) -> AsyncIterator[AsyncClient]:
    """Cliente con override del dependency `db_session` apuntando a la
    sesión transaccional del test. Garantiza que cualquier write vía API
    es rolled-back al cerrar el test.
    """
    from app.api.deps import db_session as db_session_dep
    from app.main import app

    async def _override():  # noqa: ANN202
        yield db_session

    app.dependency_overrides[db_session_dep] = _override
    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()
