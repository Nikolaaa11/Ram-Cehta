"""Unit tests para Legal Document version history (V4 fase 3).

Cubre:

* ``compute_diff(before, after)`` — sólo claves que cambiaron, ignora
  ``updated_at`` que cambia siempre por trigger.
* ``build_change_summary(before, after)``:
    - Creación (``before is None``) → "Documento creado".
    - 0 cambios → "Sin cambios".
    - 1 → "Cambió X: A → B".
    - 2-3 → "Cambió X, Y, Z" (alfabético).
    - 4+ → "Editó N campos".
    - Truncado de valores largos (>40 chars) con ellipsis.
* Repositorio (in-memory fake): version_number sequential, list DESC,
  get_version, restore-style flow (snapshot before + after).
* Schemas: ``LegalDocumentVersionRead`` roundtrip, compare response shape.

No tocamos DB real — repo fake replica el contrato. SQL real va en
integration tests (cuando habilitemos testcontainers).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.schemas.legal_version import (
    LegalDocumentVersionCompareResponse,
    LegalDocumentVersionRead,
)
from app.services.legal_version_service import (
    build_change_summary,
    compute_diff,
)

# =====================================================================
# compute_diff
# =====================================================================


class TestComputeDiff:
    def test_no_change_returns_empty(self) -> None:
        a = {"nombre": "Contrato A", "monto": 1_000_000}
        b = {"nombre": "Contrato A", "monto": 1_000_000}
        assert compute_diff(a, b) == {}

    def test_single_change(self) -> None:
        before = {"nombre": "Contrato A", "monto": 1_000_000}
        after = {"nombre": "Contrato A", "monto": 2_000_000}
        diff = compute_diff(before, after)
        assert diff == {"monto": {"before": 1_000_000, "after": 2_000_000}}

    def test_multiple_changes(self) -> None:
        before = {"nombre": "A", "monto": 100, "estado": "vigente"}
        after = {"nombre": "B", "monto": 200, "estado": "vigente"}
        diff = compute_diff(before, after)
        assert set(diff.keys()) == {"nombre", "monto"}
        assert diff["nombre"] == {"before": "A", "after": "B"}
        assert diff["monto"] == {"before": 100, "after": 200}

    def test_key_only_in_before(self) -> None:
        before = {"nombre": "A", "extra": "value"}
        after = {"nombre": "A"}
        diff = compute_diff(before, after)
        assert diff == {"extra": {"before": "value", "after": None}}

    def test_key_only_in_after(self) -> None:
        before = {"nombre": "A"}
        after = {"nombre": "A", "subcategoria": "cliente"}
        diff = compute_diff(before, after)
        assert diff == {
            "subcategoria": {"before": None, "after": "cliente"}
        }

    def test_ignores_updated_at(self) -> None:
        """`updated_at` cambia siempre por el trigger — no es un cambio
        del usuario, no debe aparecer en el summary."""
        before = {"nombre": "A", "updated_at": "2026-01-01T00:00:00Z"}
        after = {"nombre": "A", "updated_at": "2026-04-29T00:00:00Z"}
        assert compute_diff(before, after) == {}

    def test_ignores_uploaded_at(self) -> None:
        before = {"nombre": "A", "uploaded_at": "2026-01-01T00:00:00Z"}
        after = {"nombre": "A", "uploaded_at": "2026-04-29T00:00:00Z"}
        assert compute_diff(before, after) == {}

    def test_handles_none_inputs(self) -> None:
        assert compute_diff(None, None) == {}
        assert compute_diff(None, {"x": 1}) == {
            "x": {"before": None, "after": 1}
        }
        assert compute_diff({"x": 1}, None) == {
            "x": {"before": 1, "after": None}
        }


# =====================================================================
# build_change_summary
# =====================================================================


class TestBuildChangeSummary:
    def test_creation_when_before_is_none(self) -> None:
        after = {"nombre": "Contrato nuevo"}
        assert build_change_summary(None, after) == "Documento creado"

    def test_no_changes(self) -> None:
        a = {"nombre": "X"}
        b = {"nombre": "X"}
        assert build_change_summary(a, b) == "Sin cambios"

    def test_single_field_summary(self) -> None:
        before = {"monto": 1000000}
        after = {"monto": 2000000}
        assert build_change_summary(before, after) == (
            "Cambió monto: 1000000 → 2000000"
        )

    def test_single_field_with_none_before(self) -> None:
        before: dict[str, Any] = {"contraparte": None}
        after = {"contraparte": "ACME SpA"}
        assert build_change_summary(before, after) == (
            "Cambió contraparte: — → ACME SpA"
        )

    def test_two_fields_lists_them_alphabetic(self) -> None:
        before = {"nombre": "A", "monto": 100}
        after = {"nombre": "B", "monto": 200}
        # Orden alfabético: monto, nombre.
        assert build_change_summary(before, after) == "Cambió monto, nombre"

    def test_three_fields_lists_them_alphabetic(self) -> None:
        before = {"nombre": "A", "monto": 100, "estado": "vigente"}
        after = {"nombre": "B", "monto": 200, "estado": "vencido"}
        assert build_change_summary(before, after) == (
            "Cambió estado, monto, nombre"
        )

    def test_four_or_more_fields_collapsed(self) -> None:
        before = {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}
        after = {"a": 10, "b": 20, "c": 30, "d": 40, "e": 50}
        assert build_change_summary(before, after) == "Editó 5 campos"

    def test_long_value_truncated_with_ellipsis(self) -> None:
        before = {"descripcion": "a" * 200}
        after = {"descripcion": "b" * 200}
        summary = build_change_summary(before, after)
        # Truncado a 40 chars máximo por valor.
        assert "…" in summary
        assert summary.startswith("Cambió descripcion:")


# =====================================================================
# Fake in-memory version repo (replica del contrato del repo real)
# =====================================================================


class _FakeVersion:
    """Minimal stand-in for ``LegalDocumentVersion`` ORM rows."""

    def __init__(
        self,
        *,
        version_id: int,
        documento_id: int,
        version_number: int,
        snapshot: dict[str, Any],
        changed_by: str | None,
        changed_at: datetime,
        change_summary: str | None,
    ) -> None:
        self.version_id = version_id
        self.documento_id = documento_id
        self.version_number = version_number
        self.snapshot = snapshot
        self.changed_by = changed_by
        self.changed_at = changed_at
        self.change_summary = change_summary


class InMemoryLegalVersionRepo:
    """In-memory fake con la misma API pública que ``LegalVersionRepository``.

    Mantiene secuencias por documento y respeta el UNIQUE
    ``(documento_id, version_number)`` por construcción.
    """

    def __init__(self) -> None:
        self._rows: list[_FakeVersion] = []
        self._next_id = 1

    async def list_for_document(self, documento_id: int) -> list[_FakeVersion]:
        rows = [r for r in self._rows if r.documento_id == documento_id]
        rows.sort(key=lambda r: r.version_number, reverse=True)
        return rows

    async def get_version(
        self, documento_id: int, version_number: int
    ) -> _FakeVersion | None:
        for r in self._rows:
            if (
                r.documento_id == documento_id
                and r.version_number == version_number
            ):
                return r
        return None

    async def create_snapshot(
        self,
        *,
        documento_id: int,
        snapshot: dict[str, Any],
        changed_by: str | None,
        change_summary: str | None,
    ) -> _FakeVersion:
        existing = [
            r.version_number for r in self._rows
            if r.documento_id == documento_id
        ]
        next_number = (max(existing) + 1) if existing else 1
        row = _FakeVersion(
            version_id=self._next_id,
            documento_id=documento_id,
            version_number=next_number,
            snapshot=snapshot,
            changed_by=changed_by,
            changed_at=datetime.now(UTC),
            change_summary=change_summary,
        )
        self._next_id += 1
        self._rows.append(row)
        return row


# =====================================================================
# Repository contract tests
# =====================================================================


class TestVersionRepositoryContract:
    @pytest.fixture
    def repo(self) -> InMemoryLegalVersionRepo:
        return InMemoryLegalVersionRepo()

    @pytest.mark.asyncio
    async def test_first_snapshot_is_version_1(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        v = await repo.create_snapshot(
            documento_id=42,
            snapshot={"nombre": "Contrato"},
            changed_by="user-uuid",
            change_summary="Documento creado",
        )
        assert v.version_number == 1

    @pytest.mark.asyncio
    async def test_versions_increment_sequentially(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        for expected in (1, 2, 3, 4, 5):
            v = await repo.create_snapshot(
                documento_id=10,
                snapshot={"step": expected},
                changed_by="u",
                change_summary=f"v{expected}",
            )
            assert v.version_number == expected

    @pytest.mark.asyncio
    async def test_versions_per_document_independent(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        await repo.create_snapshot(
            documento_id=1, snapshot={}, changed_by=None, change_summary=None
        )
        await repo.create_snapshot(
            documento_id=1, snapshot={}, changed_by=None, change_summary=None
        )
        v3 = await repo.create_snapshot(
            documento_id=2, snapshot={}, changed_by=None, change_summary=None
        )
        # Doc 2 arranca en 1, no se mezcla con doc 1.
        assert v3.version_number == 1

    @pytest.mark.asyncio
    async def test_list_returns_desc(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        for i in range(1, 6):
            await repo.create_snapshot(
                documento_id=99,
                snapshot={"i": i},
                changed_by=None,
                change_summary=f"v{i}",
            )
        rows = await repo.list_for_document(99)
        assert [r.version_number for r in rows] == [5, 4, 3, 2, 1]

    @pytest.mark.asyncio
    async def test_get_version_match(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        await repo.create_snapshot(
            documento_id=7,
            snapshot={"nombre": "v1"},
            changed_by=None,
            change_summary=None,
        )
        await repo.create_snapshot(
            documento_id=7,
            snapshot={"nombre": "v2"},
            changed_by=None,
            change_summary=None,
        )
        v = await repo.get_version(7, 2)
        assert v is not None
        assert v.snapshot == {"nombre": "v2"}

    @pytest.mark.asyncio
    async def test_get_version_missing_returns_none(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        v = await repo.get_version(7, 999)
        assert v is None

    @pytest.mark.asyncio
    async def test_idempotent_two_patches_with_changes_creates_two_versions(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        """Cada PATCH con cambios genera una versión nueva — incluso si
        los cambios son los mismos en distintos PATCHs (decisión documentada:
        cada mutación queda registrada para trazabilidad legal).
        """
        # Estado inicial = v1.
        await repo.create_snapshot(
            documento_id=1,
            snapshot={"monto": 100},
            changed_by="u",
            change_summary="Documento creado",
        )
        # Primer PATCH: monto 100 → 200. Snapshot del estado anterior.
        await repo.create_snapshot(
            documento_id=1,
            snapshot={"monto": 100},
            changed_by="u",
            change_summary="Cambió monto: 100 → 200",
        )
        # Segundo PATCH idéntico (200 → 200): el endpoint igual snapshotea
        # el estado anterior. La política es "cada PATCH = 1 fila".
        await repo.create_snapshot(
            documento_id=1,
            snapshot={"monto": 200},
            changed_by="u",
            change_summary="Sin cambios",
        )
        rows = await repo.list_for_document(1)
        assert len(rows) == 3
        # Todas las versiones quedan numeradas 3, 2, 1 (DESC).
        assert [r.version_number for r in rows] == [3, 2, 1]

    @pytest.mark.asyncio
    async def test_restore_creates_new_version_forward_only(
        self, repo: InMemoryLegalVersionRepo
    ) -> None:
        """Restore NO sobreescribe historia. Pre-restore + post-restore = 2
        nuevas versiones que se suman al historial existente.
        """
        # v1: estado inicial.
        await repo.create_snapshot(
            documento_id=5,
            snapshot={"nombre": "Original"},
            changed_by="u",
            change_summary="Documento creado",
        )
        # v2: edit.
        await repo.create_snapshot(
            documento_id=5,
            snapshot={"nombre": "Original"},
            changed_by="u",
            change_summary="Cambió nombre: Original → Edit1",
        )
        # Ahora actual es "Edit1". Restore a v1:
        # Paso 1: snapshot del estado actual (v3).
        await repo.create_snapshot(
            documento_id=5,
            snapshot={"nombre": "Edit1"},
            changed_by="admin",
            change_summary="Pre-restore (volverá a v1)",
        )
        # Paso 2: snapshot del estado restaurado (v4).
        await repo.create_snapshot(
            documento_id=5,
            snapshot={"nombre": "Original"},
            changed_by="admin",
            change_summary="Restaurado desde v1",
        )
        rows = await repo.list_for_document(5)
        # 4 versiones totales — historia preservada, sólo se agregaron 2.
        assert len(rows) == 4
        assert [r.version_number for r in rows] == [4, 3, 2, 1]
        # v1 sigue intacta.
        v1 = await repo.get_version(5, 1)
        assert v1 is not None
        assert v1.snapshot == {"nombre": "Original"}


# =====================================================================
# Schemas
# =====================================================================


class TestSchemas:
    def test_version_read_roundtrip(self) -> None:
        now = datetime.now(UTC)
        row = _FakeVersion(
            version_id=1,
            documento_id=42,
            version_number=2,
            snapshot={"nombre": "X", "monto": 100},
            changed_by="00000000-0000-0000-0000-000000000001",
            changed_at=now,
            change_summary="Cambió monto: 100 → 200",
        )
        out = LegalDocumentVersionRead.model_validate(row)
        assert out.documento_id == 42
        assert out.version_number == 2
        assert out.snapshot == {"nombre": "X", "monto": 100}
        assert out.change_summary == "Cambió monto: 100 → 200"

    def test_compare_response_shape(self) -> None:
        resp = LegalDocumentVersionCompareResponse(
            version_a={"nombre": "A", "monto": 100},
            version_b={"nombre": "B", "monto": 100},
            diff={"nombre": {"before": "A", "after": "B"}},
        )
        assert resp.version_a == {"nombre": "A", "monto": 100}
        assert resp.diff == {"nombre": {"before": "A", "after": "B"}}

    def test_compare_response_empty_diff_when_equal(self) -> None:
        snapshot = {"nombre": "X", "monto": 100}
        resp = LegalDocumentVersionCompareResponse(
            version_a=snapshot,
            version_b=snapshot,
            diff={},
        )
        assert resp.diff == {}
