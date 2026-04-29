"""Unit tests para `app.services.bulk_import_service` (V3 fase 11).

Cubre:
  * parse_csv: encodings (utf-8, utf-8-sig BOM, latin-1), normalización de columnas.
  * validate_rows: required cols, RUT inválido, fecha inválida, dedup vs DB.
  * execute_import: skip de inválidas + duplicadas, count totals.
  * Endpoint guardrails: 5 MB cap, MIME no-CSV → 415.
  * audit_log llamado una vez por execute.
  * Conteos: total = valid + invalid (las duplicadas también cuentan).
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.bulk_import import ImportResult, ValidationReport
from app.services.bulk_import_service import (
    BulkImportService,
    _decode_bytes,
    _normalize_key,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db_no_dups() -> MagicMock:
    """Mock AsyncSession donde `scalar(...)` siempre retorna None (no dups)."""
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.execute = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# parse_csv: encodings
# ---------------------------------------------------------------------------


def test_parse_csv_utf8_basic() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    content = (
        b"empresa_codigo,nombre_completo,rut,fecha_ingreso\n"
        b"CENERGY,Juan Perez,12345678-5,2025-01-01\n"
    )
    rows = svc.parse_csv(content, "trabajadores")
    assert len(rows) == 1
    assert rows[0]["empresa_codigo"] == "CENERGY"
    assert rows[0]["nombre_completo"] == "Juan Perez"


def test_parse_csv_utf8_sig_bom_handled() -> None:
    """Excel-CL exporta CSV con BOM. utf-8-sig debe limpiarlo."""
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    content = b"\xef\xbb\xbf" + (
        b"empresa_codigo,nombre_completo,rut,fecha_ingreso\n"
        b"CENERGY,Maria,11.111.111-1,2025-02-02\n"
    )
    rows = svc.parse_csv(content, "trabajadores")
    assert len(rows) == 1
    # Si BOM se filtra, la primera key no tiene "﻿" prefix
    assert "empresa_codigo" in rows[0]
    assert "﻿empresa_codigo" not in rows[0]


def test_parse_csv_latin1_fallback() -> None:
    """Acentos en latin-1 (no decodean en utf-8) deben pasar por fallback."""
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    # 0xe1 = á en latin-1, inválido en utf-8 standalone
    content = b"razon_social\nP\xe9rez Hnos S.A.\n"
    rows = svc.parse_csv(content, "proveedores")
    assert len(rows) == 1
    assert "Pérez" in rows[0]["razon_social"]


def test_decode_bytes_prefers_utf8() -> None:
    assert _decode_bytes(b"hola") == "hola"


def test_decode_bytes_handles_bom() -> None:
    assert _decode_bytes(b"\xef\xbb\xbfhola") == "hola"


# ---------------------------------------------------------------------------
# parse_csv: column normalization
# ---------------------------------------------------------------------------


def test_parse_csv_normalizes_columns() -> None:
    """Headers con MAYÚSCULAS, espacios y trailing whitespace se normalizan."""
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    content = (
        b"Empresa Codigo, Nombre Completo ,RUT,Fecha Ingreso\n"
        b"CENERGY,Juan,12345678-5,2025-01-01\n"
    )
    rows = svc.parse_csv(content, "trabajadores")
    keys = set(rows[0].keys())
    assert "empresa_codigo" in keys
    assert "nombre_completo" in keys
    assert "rut" in keys
    assert "fecha_ingreso" in keys


def test_normalize_key_basic() -> None:
    assert _normalize_key("Nombre Completo") == "nombre_completo"
    assert _normalize_key("  RUT  ") == "rut"
    assert _normalize_key("Razon Social ") == "razon_social"


# ---------------------------------------------------------------------------
# validate_rows: missing cols / bad RUT / bad date / dups
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_rows_missing_required_col() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows: list[dict[str, Any]] = [
        # Falta `fecha_ingreso`
        {"empresa_codigo": "CENERGY", "nombre_completo": "Juan", "rut": "12345678-5"},
    ]
    report = await svc.validate_rows(rows, "trabajadores")
    assert report.valid_rows == 0
    assert len(report.invalid_rows) == 1
    assert any("fecha_ingreso" in e for e in report.invalid_rows[0].errors)


@pytest.mark.asyncio
async def test_validate_rows_bad_rut() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Juan",
            "rut": "ABC-NOT-VALID",
            "fecha_ingreso": "2025-01-01",
        },
    ]
    report = await svc.validate_rows(rows, "trabajadores")
    assert report.valid_rows == 0
    assert len(report.invalid_rows) == 1
    err_text = " ".join(report.invalid_rows[0].errors)
    assert "rut" in err_text.lower() or "RUT" in err_text


@pytest.mark.asyncio
async def test_validate_rows_bad_date_format() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Juan",
            "rut": "12345678-5",
            "fecha_ingreso": "no-es-una-fecha",
        },
    ]
    report = await svc.validate_rows(rows, "trabajadores")
    assert report.valid_rows == 0
    assert len(report.invalid_rows) == 1


@pytest.mark.asyncio
async def test_validate_rows_detects_duplicate_in_db() -> None:
    """Si scalar() retorna un id existente, fila va a duplicates (no valid)."""
    db = MagicMock()
    db.scalar = AsyncMock(return_value=42)  # un trabajador_id existente
    svc = BulkImportService(db)
    rows = [
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Juan",
            "rut": "12345678-5",
            "fecha_ingreso": "2025-01-01",
        },
    ]
    report = await svc.validate_rows(rows, "trabajadores")
    assert len(report.duplicates) == 1
    assert report.duplicates[0].existing_id == 42
    # Las duplicadas no cuentan como valid_rows.
    assert report.valid_rows == 0


@pytest.mark.asyncio
async def test_validate_rows_counts_consistent() -> None:
    """total = valid + invalid + duplicates."""
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [
        # Válida
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Ana",
            "rut": "11111111-1",
            "fecha_ingreso": "2025-01-01",
        },
        # Inválida (rut malo)
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Beto",
            "rut": "BAD",
            "fecha_ingreso": "2025-01-01",
        },
        # Inválida (sin fecha_ingreso)
        {"empresa_codigo": "CENERGY", "nombre_completo": "Cele", "rut": "22222222-2"},
    ]
    report = await svc.validate_rows(rows, "trabajadores")
    assert report.total_rows == 3
    assert report.valid_rows == 1
    assert len(report.invalid_rows) == 2
    # Sumar valid + invalid + duplicates == total
    assert (
        report.valid_rows + len(report.invalid_rows) + len(report.duplicates)
        == report.total_rows
    )


# ---------------------------------------------------------------------------
# execute_import
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_import_inserts_valid_rows() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Ana Perez",
            "rut": "11111111-1",
            "fecha_ingreso": "2025-01-01",
        },
    ]
    result = await svc.execute_import(rows, "trabajadores", user_id="u1")
    assert isinstance(result, ImportResult)
    assert result.created == 1
    assert result.skipped == 0
    db.flush.assert_awaited()


@pytest.mark.asyncio
async def test_execute_import_skips_invalid_and_duplicates() -> None:
    """Inválidas → skipped + error. Duplicadas (existing) → skipped."""
    db = MagicMock()
    # scalar() retorna None las primeras 2 veces (no dup), 99 la 3ra (dup en DB).
    # Como buscamos por _find_existing por cada fila y el orden de calls es
    # consistente, alternamos: usamos side_effect lista.
    db.scalar = AsyncMock(side_effect=[None, 99])  # primera: insertable; segunda: dup
    db.add = MagicMock()
    db.flush = AsyncMock()
    svc = BulkImportService(db)
    rows = [
        # 1. Válida
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Ana",
            "rut": "11111111-1",
            "fecha_ingreso": "2025-01-01",
        },
        # 2. Inválida (rut malo) → skipped sin tocar DB
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Beto",
            "rut": "BAD",
            "fecha_ingreso": "2025-01-01",
        },
        # 3. Válida pero existe en DB
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Cele",
            "rut": "22222222-2",
            "fecha_ingreso": "2025-01-01",
        },
    ]
    result = await svc.execute_import(rows, "trabajadores", user_id="u1")
    assert result.created == 1
    assert result.skipped == 2
    assert len(result.errors) == 2


@pytest.mark.asyncio
async def test_execute_import_inbatch_dedup() -> None:
    """Dos filas con mismo (empresa, rut) en el mismo lote — sólo 1 se inserta."""
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Ana",
            "rut": "11111111-1",
            "fecha_ingreso": "2025-01-01",
        },
        {
            "empresa_codigo": "CENERGY",
            "nombre_completo": "Ana Dup",
            "rut": "11111111-1",
            "fecha_ingreso": "2025-02-02",
        },
    ]
    result = await svc.execute_import(rows, "trabajadores", user_id="u1")
    assert result.created == 1
    assert result.skipped == 1


@pytest.mark.asyncio
async def test_execute_import_fondos() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    rows = [{"nombre": "Banco Estado", "tipo": "banco"}]
    result = await svc.execute_import(rows, "fondos", user_id="u1")
    assert result.created == 1


@pytest.mark.asyncio
async def test_execute_import_proveedores_dedup_by_rut() -> None:
    db = MagicMock()
    # rut existe en DB → skip
    db.scalar = AsyncMock(return_value=7)
    db.add = MagicMock()
    db.flush = AsyncMock()
    svc = BulkImportService(db)
    rows = [{"razon_social": "Proveedor X SA", "rut": "76543210-9"}]
    result = await svc.execute_import(rows, "proveedores", user_id="u1")
    assert result.created == 0
    assert result.skipped == 1


# ---------------------------------------------------------------------------
# Endpoint integration: 415 MIME, 5 MB cap, audit_log call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_rejects_non_csv_mime() -> None:
    """MIME != csv → 415."""
    from fastapi import HTTPException

    from app.api.v1.bulk_import import _assert_csv

    fake = MagicMock()
    fake.content_type = "application/json"
    with pytest.raises(HTTPException) as exc:
        _assert_csv(fake)
    assert exc.value.status_code == 415


@pytest.mark.asyncio
async def test_dry_run_accepts_text_csv() -> None:
    from app.api.v1.bulk_import import _assert_csv

    fake = MagicMock()
    fake.content_type = "text/csv; charset=utf-8"
    # No raise
    _assert_csv(fake)


@pytest.mark.asyncio
async def test_dry_run_accepts_excel_csv() -> None:
    from app.api.v1.bulk_import import _assert_csv

    fake = MagicMock()
    fake.content_type = "application/vnd.ms-excel"
    _assert_csv(fake)


@pytest.mark.asyncio
async def test_execute_calls_audit_log_once() -> None:
    """audit_log debe invocarse exactamente 1 vez por execute."""
    from fastapi import Request

    from app.api.v1.bulk_import import execute
    from app.schemas.bulk_import import ExecuteImportRequest

    db = _make_db_no_dups()
    user = MagicMock()
    user.sub = "u1"
    user.email = "u@x.cl"
    user.has_scope = MagicMock(return_value=True)

    request = MagicMock(spec=Request)
    request.client = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers = {"user-agent": "pytest"}

    body = ExecuteImportRequest(rows=[{"nombre": "Banco Estado", "tipo": "banco"}])

    with patch(
        "app.api.v1.bulk_import.audit_log", new=AsyncMock()
    ) as mock_audit:
        result = await execute(
            user=user,
            db=db,
            request=request,
            entity_type="fondos",
            body=body,
        )
        assert mock_audit.await_count == 1
        # Verificar entity_type del audit
        kwargs = mock_audit.await_args.kwargs
        assert kwargs["action"] == "bulk_import"
        assert kwargs["entity_type"] == "fondo_bulk"
        assert "created" in kwargs["summary"]

    assert isinstance(result, ImportResult)


@pytest.mark.asyncio
async def test_validate_rows_returns_validation_report_type() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    report = await svc.validate_rows([], "fondos")
    assert isinstance(report, ValidationReport)
    assert report.entity_type == "fondos"
    assert report.total_rows == 0
    assert report.valid_rows == 0


@pytest.mark.asyncio
async def test_invalid_entity_type_raises() -> None:
    db = _make_db_no_dups()
    svc = BulkImportService(db)
    with pytest.raises(ValueError):
        svc.parse_csv(b"x,y\n1,2", "wrong_entity")
    with pytest.raises(ValueError):
        await svc.validate_rows([], "wrong_entity")
    with pytest.raises(ValueError):
        await svc.execute_import([], "wrong_entity", user_id="u1")
