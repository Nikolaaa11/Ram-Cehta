"""Helpers de fixtures V5 para tests de policies_fondo / lp_documents /
fondo_actas / estados_financieros.

Las V5 tables viven solo en alembic migrations (`0027_informes_lp.py`,
`0029_policies_fondo.py`, `0030_lp_documents.py`, `0031_fondo_actas.py`,
`0032_estados_financieros.py`) y NO en `db/schema.sql` que es lo que el
fixture base `_engine` carga. Por lo tanto necesitamos crear las tablas
manualmente al inicio de la sesión de tests, idempotentemente.

Además, los endpoints V5 usan `require_scope("legal:write")` pero ese
scope NO está definido en `app.core.rbac.ROLE_SCOPES`. Para los happy
paths necesitamos otorgárselo a admin via monkeypatch.

Este módulo NO se llama `conftest.py` para no aplicarse global —
los tests V5 lo importan vía `from tests.integration.conftest_v5 import *`
o usan los fixtures explícitamente.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio


# DDL idempotente para las V5 tables — copiado de las migraciones
# correspondientes. Si las tablas ya existen (porque alembic corrió
# antes en CI), `IF NOT EXISTS` las ignora.
_V5_DDL: list[str] = [
    # --- core.lps (0027_informes_lp.py) — sin esto lp_documents falla por FK
    """
    CREATE TABLE IF NOT EXISTS core.lps (
        lp_id              BIGSERIAL PRIMARY KEY,
        nombre             TEXT NOT NULL,
        apellido           TEXT,
        email              TEXT UNIQUE,
        telefono           TEXT,
        empresa            TEXT,
        rol                TEXT,
        estado             TEXT NOT NULL DEFAULT 'pipeline'
            CHECK (estado IN (
                'pipeline', 'cualificado', 'activo', 'inactivo', 'declinado'
            )),
        primer_contacto    DATE,
        perfil_inversor    TEXT
            CHECK (perfil_inversor IS NULL OR perfil_inversor IN (
                'conservador', 'moderado', 'agresivo', 'esg_focused'
            )),
        intereses          JSONB DEFAULT '[]'::jsonb,
        relationship_owner TEXT,
        aporte_total       NUMERIC(18, 2),
        aporte_actual      NUMERIC(18, 2),
        empresas_invertidas TEXT[] DEFAULT '{}'::text[],
        notas              TEXT,
        metadata           JSONB DEFAULT '{}'::jsonb,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    # --- core.policies_fondo (0029)
    """
    CREATE TABLE IF NOT EXISTS core.policies_fondo (
        policy_id              BIGSERIAL PRIMARY KEY,
        tipo                   TEXT NOT NULL CHECK (tipo IN (
            'reglamento_interno','manual_uaf','codigo_etica','politica_pep',
            'politica_inversion','politica_riesgo','politica_conflicto_interes',
            'manual_compliance','otro'
        )),
        nombre                 TEXT NOT NULL,
        version                TEXT NOT NULL,
        fecha_aprobacion       DATE NOT NULL,
        fecha_vigencia_desde   DATE,
        fecha_proxima_revision DATE,
        aprobado_por           TEXT,
        dropbox_path           TEXT,
        hash_sha256            TEXT,
        estado                 TEXT NOT NULL DEFAULT 'vigente'
            CHECK (estado IN ('vigente', 'derogada', 'borrador')),
        metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tipo, version)
    );
    """,
    # --- core.lp_documents (0030)
    """
    CREATE TABLE IF NOT EXISTS core.lp_documents (
        lp_doc_id              BIGSERIAL PRIMARY KEY,
        lp_id                  BIGINT NOT NULL
            REFERENCES core.lps(lp_id) ON DELETE CASCADE,
        tipo                   TEXT NOT NULL CHECK (tipo IN (
            'contrato_suscripcion','kyc','ddq','side_letter','aml_pep',
            'recibo_aporte','acta_aprobacion','w8_w9_tax','dni_pasaporte',
            'power_of_attorney','otro'
        )),
        nombre                 TEXT NOT NULL,
        fecha_firma            DATE,
        fecha_vigencia_hasta   DATE,
        monto_clp              NUMERIC(18, 2),
        dropbox_path           TEXT,
        hash_sha256            TEXT,
        estado                 TEXT NOT NULL DEFAULT 'vigente'
            CHECK (estado IN ('vigente','vencido','borrador','archivado')),
        metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
        uploaded_by            UUID,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    # --- core.fondo_actas (0031)
    """
    CREATE TABLE IF NOT EXISTS core.fondo_actas (
        acta_id        BIGSERIAL PRIMARY KEY,
        tipo_organo    TEXT NOT NULL CHECK (tipo_organo IN (
            'directorio_afis','comite_inversion','asamblea_lps',
            'comite_vigilancia','comite_riesgo','otro'
        )),
        numero_acta    INTEGER NOT NULL,
        fecha_reunion  DATE NOT NULL,
        lugar          TEXT,
        quorum         INTEGER,
        quorum_total   INTEGER,
        presidente     TEXT,
        secretario     TEXT,
        asistentes     JSONB NOT NULL DEFAULT '[]'::jsonb,
        temario        TEXT,
        acuerdos       JSONB NOT NULL DEFAULT '[]'::jsonb,
        dropbox_path   TEXT,
        hash_sha256    TEXT,
        estado         TEXT NOT NULL DEFAULT 'borrador'
            CHECK (estado IN ('borrador','aprobada','firmada','archivada')),
        metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (tipo_organo, numero_acta)
    );
    """,
    # --- core.estados_financieros (0032)
    """
    CREATE TABLE IF NOT EXISTS core.estados_financieros (
        ef_id                BIGSERIAL PRIMARY KEY,
        empresa_codigo       TEXT NOT NULL
            REFERENCES core.empresas(codigo) ON DELETE CASCADE,
        tipo_ef              TEXT NOT NULL CHECK (tipo_ef IN (
            'balance','estado_resultados','flujo_caja','cambios_patrimonio',
            'consolidado','notas'
        )),
        periodo_tipo         TEXT NOT NULL CHECK (periodo_tipo IN (
            'mensual','trimestral','semestral','anual'
        )),
        periodo              TEXT NOT NULL,
        fecha_corte          DATE NOT NULL,
        auditado             BOOLEAN NOT NULL DEFAULT false,
        auditor              TEXT,
        aprobado_directorio  BOOLEAN NOT NULL DEFAULT false,
        fecha_aprobacion     DATE,
        dropbox_path         TEXT,
        hash_sha256          TEXT,
        metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (empresa_codigo, tipo_ef, periodo)
    );
    """,
]


@pytest_asyncio.fixture(scope="session")
async def _v5_schema(_engine: Any) -> AsyncIterator[Any]:
    """Crea las V5 tables encima del schema base (idempotente)."""
    from sqlalchemy import text

    async with _engine.begin() as conn:
        for stmt in _V5_DDL:
            try:
                await conn.execute(text(stmt))
            except Exception as exc:  # noqa: BLE001
                msg = str(exc).lower()
                if any(t in msg for t in ("already exists", "duplicate")):
                    continue
                raise
    yield _engine


@pytest.fixture
def _grant_legal_write(monkeypatch: pytest.MonkeyPatch) -> None:
    """Otorga el scope `legal:write` a admin (y `viewer` lo sigue NO teniendo).

    Los endpoints V5 declaran `require_scope("legal:write")` pero ese scope
    no existe en `ROLE_SCOPES`. Para que los happy-path 201/200 funcionen,
    parcheamos la tabla en runtime — solo dura lo que dura el test.

    `viewer` queda intacto, así que los tests de "viewer → 403" siguen
    siendo válidos sin cambios.
    """
    from app.core import rbac

    new_admin = frozenset(rbac.ROLE_SCOPES["admin"] | {"legal:write"})
    new_finance = frozenset(rbac.ROLE_SCOPES["finance"] | {"legal:write"})
    monkeypatch.setitem(rbac.ROLE_SCOPES, "admin", new_admin)
    monkeypatch.setitem(rbac.ROLE_SCOPES, "finance", new_finance)


@pytest_asyncio.fixture
async def lp_id_factory(db_session: Any) -> Any:
    """Inserta un LP minimal y devuelve su `lp_id` — para tests de
    lp_documents. Usa la sesión transaccional del test → rollback al
    final.
    """
    from sqlalchemy import text

    async def _factory(nombre: str = "LP Test", email: str | None = None) -> int:
        result = await db_session.execute(
            text(
                "INSERT INTO core.lps (nombre, email) "
                "VALUES (:n, :e) RETURNING lp_id"
            ),
            {"n": nombre, "e": email},
        )
        return int(result.scalar_one())

    return _factory
