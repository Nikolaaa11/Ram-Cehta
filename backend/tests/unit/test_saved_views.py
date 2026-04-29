"""Unit tests para SavedViews (V3 fase 11).

Cubre:
  - Repositorio: list, list filtrado por page, ordering (pinned + nombre),
    create, update (rename / filtros / pin), delete, toggle_pin idempotencia.
  - Ownership: update / delete / toggle_pin retornan None / False si la
    vista no es del usuario (no leak de IDs).
  - Schemas: validación de page enum, name max 80, filters JSON roundtrip,
    SavedViewUpdate parcial.

No usamos DB real — replicamos el contrato del repo con un fake
in-memory. SQL real queda cubierto en integration tests con
testcontainers (cuando los habilitamos).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from app.models.saved_view import SavedView
from app.schemas.saved_view import (
    SavedViewCreate,
    SavedViewRead,
    SavedViewUpdate,
)

# =====================================================================
# In-memory fake repo — replica los contratos públicos sin DB.
# =====================================================================


class InMemorySavedViewRepo:
    def __init__(self) -> None:
        self.views: list[SavedView] = []
        self._id = 0

    def _new_id(self) -> str:
        self._id += 1
        return f"00000000-0000-0000-0000-{self._id:012d}"

    async def list_for_user(
        self, user_id: str, *, page: str | None = None
    ) -> list[SavedView]:
        owned = [v for v in self.views if v.user_id == user_id]
        if page is not None:
            owned = [v for v in owned if v.page == page]
        # Pinned primero (DESC), luego nombre ASC.
        owned.sort(key=lambda v: (not v.is_pinned, v.name.lower()))
        return owned

    async def get_for_user(
        self, view_id: str, user_id: str
    ) -> SavedView | None:
        for v in self.views:
            if v.id == view_id and v.user_id == user_id:
                return v
        return None

    async def create(
        self,
        *,
        user_id: str,
        page: str,
        name: str,
        filters: dict[str, Any] | None = None,
    ) -> SavedView:
        now = datetime.now(UTC)
        view = SavedView(
            id=self._new_id(),
            user_id=user_id,
            page=page,
            name=name,
            filters=filters or {},
            is_pinned=False,
            created_at=now,
            updated_at=now,
        )
        self.views.append(view)
        return view

    async def update(
        self,
        view_id: str,
        user_id: str,
        *,
        name: str | None = None,
        filters: dict[str, Any] | None = None,
        is_pinned: bool | None = None,
    ) -> SavedView | None:
        view = await self.get_for_user(view_id, user_id)
        if view is None:
            return None
        if name is not None:
            view.name = name
        if filters is not None:
            view.filters = filters
        if is_pinned is not None:
            view.is_pinned = is_pinned
        view.updated_at = datetime.now(UTC)
        return view

    async def delete(self, view_id: str, user_id: str) -> bool:
        for v in list(self.views):
            if v.id == view_id and v.user_id == user_id:
                self.views.remove(v)
                return True
        return False

    async def toggle_pin(
        self, view_id: str, user_id: str
    ) -> SavedView | None:
        view = await self.get_for_user(view_id, user_id)
        if view is None:
            return None
        view.is_pinned = not view.is_pinned
        view.updated_at = datetime.now(UTC)
        return view


# =====================================================================
# Repository contract tests
# =====================================================================


class TestSavedViewRepositoryContract:
    @pytest.fixture
    def repo(self) -> InMemorySavedViewRepo:
        return InMemorySavedViewRepo()

    @pytest.mark.asyncio
    async def test_create_with_valid_page(self, repo: InMemorySavedViewRepo) -> None:
        view = await repo.create(
            user_id="u1",
            page="oc",
            name="OCs CENERGY pendientes",
            filters={"empresa_codigo": "CENERGY", "estado": "pendiente"},
        )
        assert view.id != ""
        assert view.user_id == "u1"
        assert view.page == "oc"
        assert view.name == "OCs CENERGY pendientes"
        assert view.filters == {
            "empresa_codigo": "CENERGY",
            "estado": "pendiente",
        }
        assert view.is_pinned is False

    @pytest.mark.asyncio
    async def test_list_for_user_isolates_users(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        await repo.create(user_id="u1", page="oc", name="A")
        await repo.create(user_id="u1", page="f29", name="B")
        await repo.create(user_id="u2", page="oc", name="Otra")

        u1_views = await repo.list_for_user("u1")
        u2_views = await repo.list_for_user("u2")
        u3_views = await repo.list_for_user("u3")

        assert len(u1_views) == 2
        assert len(u2_views) == 1
        assert u3_views == []

    @pytest.mark.asyncio
    async def test_list_filters_by_page(self, repo: InMemorySavedViewRepo) -> None:
        await repo.create(user_id="u1", page="oc", name="OC1")
        await repo.create(user_id="u1", page="oc", name="OC2")
        await repo.create(user_id="u1", page="f29", name="F29 vencidas")
        await repo.create(user_id="u1", page="legal", name="Contratos")

        oc_only = await repo.list_for_user("u1", page="oc")
        f29_only = await repo.list_for_user("u1", page="f29")
        all_views = await repo.list_for_user("u1")

        assert len(oc_only) == 2
        assert {v.name for v in oc_only} == {"OC1", "OC2"}
        assert len(f29_only) == 1
        assert f29_only[0].name == "F29 vencidas"
        assert len(all_views) == 4

    @pytest.mark.asyncio
    async def test_list_orders_pinned_first_then_name_asc(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        v_zeta = await repo.create(user_id="u1", page="oc", name="zeta")
        v_alpha = await repo.create(user_id="u1", page="oc", name="alpha")
        v_pinned_y = await repo.create(user_id="u1", page="oc", name="ypinned")
        v_pinned_y.is_pinned = True
        # Pin "zeta" too para chequear orden alfabético dentro de pinned.
        v_zeta.is_pinned = True

        items = await repo.list_for_user("u1", page="oc")
        # Esperado: pinned "ypinned", "zeta" (orden alfabético dentro de
        # pinned), luego no-pinned "alpha".
        names_in_order = [v.name for v in items]
        assert names_in_order == ["ypinned", "zeta", "alpha"]
        # Sanity: alpha es el último.
        assert items[-1].id == v_alpha.id

    @pytest.mark.asyncio
    async def test_update_only_own(self, repo: InMemorySavedViewRepo) -> None:
        view = await repo.create(user_id="u1", page="oc", name="orig")
        # Otro user no puede.
        result_other = await repo.update(view.id, "u_attacker", name="hacked")
        assert result_other is None
        assert view.name == "orig"
        # Owner sí.
        result_own = await repo.update(view.id, "u1", name="renamed")
        assert result_own is not None
        assert result_own.name == "renamed"

    @pytest.mark.asyncio
    async def test_update_partial_fields(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        view = await repo.create(
            user_id="u1",
            page="f29",
            name="orig",
            filters={"a": 1},
        )
        # Update solo filters → name no cambia.
        await repo.update(view.id, "u1", filters={"b": 2})
        assert view.name == "orig"
        assert view.filters == {"b": 2}
        # Update solo is_pinned.
        await repo.update(view.id, "u1", is_pinned=True)
        assert view.is_pinned is True
        assert view.name == "orig"
        assert view.filters == {"b": 2}

    @pytest.mark.asyncio
    async def test_update_returns_none_for_missing(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        result = await repo.update(
            "00000000-0000-0000-0000-999999999999", "u1", name="x"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_only_own(self, repo: InMemorySavedViewRepo) -> None:
        view = await repo.create(user_id="u1", page="oc", name="A")
        # Otro user no borra.
        deleted_other = await repo.delete(view.id, "u_attacker")
        assert deleted_other is False
        assert len(repo.views) == 1
        # Owner sí.
        deleted_own = await repo.delete(view.id, "u1")
        assert deleted_own is True
        assert repo.views == []

    @pytest.mark.asyncio
    async def test_delete_returns_false_for_missing(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        deleted = await repo.delete(
            "00000000-0000-0000-0000-999999999999", "u1"
        )
        assert deleted is False

    @pytest.mark.asyncio
    async def test_toggle_pin_idempotent_two_calls(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        view = await repo.create(user_id="u1", page="oc", name="A")
        assert view.is_pinned is False
        v1 = await repo.toggle_pin(view.id, "u1")
        assert v1 is not None and v1.is_pinned is True
        v2 = await repo.toggle_pin(view.id, "u1")
        assert v2 is not None and v2.is_pinned is False
        # Estado final = inicial (idempotente vía par de toggles).
        assert view.is_pinned is False

    @pytest.mark.asyncio
    async def test_toggle_pin_blocks_other_users(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        view = await repo.create(user_id="u1", page="oc", name="A")
        result = await repo.toggle_pin(view.id, "u_attacker")
        assert result is None
        assert view.is_pinned is False  # no afectado

    @pytest.mark.asyncio
    async def test_filters_json_roundtrip(
        self, repo: InMemorySavedViewRepo
    ) -> None:
        """Filters preserva nested dicts, listas y tipos primitivos."""
        complex_filters = {
            "empresa_codigo": "CENERGY",
            "estado": "pendiente",
            "categorias": ["contrato", "acta"],
            "rango": {"desde": "2025-01-01", "hasta": "2025-12-31"},
            "amount_min": 1000000,
            "active": True,
        }
        view = await repo.create(
            user_id="u1",
            page="legal",
            name="vista compleja",
            filters=complex_filters,
        )
        assert view.filters == complex_filters
        # Roundtrip via SavedViewRead schema.
        read = SavedViewRead.model_validate(view)
        assert read.filters == complex_filters


# =====================================================================
# Schema validation tests
# =====================================================================


class TestSchemas:
    def test_create_with_valid_page_enum(self) -> None:
        payload = SavedViewCreate(
            page="oc", name="OCs pendientes", filters={"estado": "pendiente"}
        )
        assert payload.page == "oc"
        assert payload.name == "OCs pendientes"

    def test_create_rejects_invalid_page(self) -> None:
        with pytest.raises(ValidationError):
            SavedViewCreate(  # type: ignore[arg-type]
                page="not_a_page",
                name="x",
                filters={},
            )

    def test_create_accepts_all_six_pages(self) -> None:
        for page in (
            "oc",
            "f29",
            "trabajadores",
            "proveedores",
            "legal",
            "fondos",
        ):
            payload = SavedViewCreate(page=page, name="x", filters={})  # type: ignore[arg-type]
            assert payload.page == page

    def test_create_rejects_name_over_80_chars(self) -> None:
        with pytest.raises(ValidationError):
            SavedViewCreate(page="oc", name="x" * 81, filters={})

    def test_create_accepts_name_exactly_80_chars(self) -> None:
        payload = SavedViewCreate(page="oc", name="x" * 80, filters={})
        assert len(payload.name) == 80

    def test_create_rejects_empty_name(self) -> None:
        with pytest.raises(ValidationError):
            SavedViewCreate(page="oc", name="", filters={})

    def test_create_default_filters_is_empty_dict(self) -> None:
        payload = SavedViewCreate(page="oc", name="A")
        assert payload.filters == {}

    def test_update_all_fields_optional(self) -> None:
        # Todos None es válido (no-op).
        payload = SavedViewUpdate()
        assert payload.name is None
        assert payload.filters is None
        assert payload.is_pinned is None

    def test_update_partial_fields(self) -> None:
        payload = SavedViewUpdate(is_pinned=True)
        assert payload.is_pinned is True
        assert payload.name is None
        assert payload.filters is None

    def test_update_rejects_name_over_80_chars(self) -> None:
        with pytest.raises(ValidationError):
            SavedViewUpdate(name="y" * 81)

    def test_read_from_attributes(self) -> None:
        now = datetime.now(UTC)
        view = SavedView(
            id="00000000-0000-0000-0000-000000000001",
            user_id="u1",
            page="oc",
            name="hola",
            filters={"empresa_codigo": "CENERGY"},
            is_pinned=False,
            created_at=now,
            updated_at=now,
        )
        out = SavedViewRead.model_validate(view)
        assert out.name == "hola"
        assert out.page == "oc"
        assert out.filters == {"empresa_codigo": "CENERGY"}
        assert out.is_pinned is False
