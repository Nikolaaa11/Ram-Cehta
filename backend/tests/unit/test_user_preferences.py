"""Unit tests para user_preferences (V4 fase 4 — onboarding tour).

Cubre:
  - Schema `UserPreferenceUpdate` valida shapes JSON-serializable
    (dict, str, int, bool, list, float, None).
  - Schema `UserPreferenceRead` roundtrip.
  - Validación de key (longitud, caracteres permitidos).
  - Comportamiento de upsert (insert + update via fake store).
  - Privacy: user A no lee preferencias de user B.
  - GET devuelve "no existe" cuando la key no está seteada (vs `{}` o `null`).

No hay DB real — replicamos el contrato del endpoint con un store
in-memory que aplica las mismas reglas (PK compuesta, ON CONFLICT
update). El SQL real se cubre en integration tests con testcontainers.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.api.v1.me_preferences import _MAX_KEY_LEN, _validate_key
from app.schemas.user_preference import (
    UserPreferenceRead,
    UserPreferenceUpdate,
)

# =====================================================================
# In-memory fake store — replica el contrato del endpoint sin DB.
# =====================================================================


class InMemoryPreferenceStore:
    """Modela `app.user_preferences` con PK compuesta `(user_id, key)`.

    Soporta:
    - get(user_id, key) → value | None (None = "no existe")
    - upsert(user_id, key, value) → idempotente, simula `ON CONFLICT DO UPDATE`.
    """

    def __init__(self) -> None:
        # Map (user_id, key) → value.
        self._rows: dict[tuple[str, str], object] = {}

    def get(self, user_id: str, key: str) -> object | None:
        return self._rows.get((user_id, key))

    def upsert(self, user_id: str, key: str, value: object) -> None:
        self._rows[(user_id, key)] = value

    def has(self, user_id: str, key: str) -> bool:
        return (user_id, key) in self._rows


# =====================================================================
# UserPreferenceUpdate schema — JSONB shape validation
# =====================================================================


class TestUserPreferenceUpdateSchema:
    def test_acepta_dict_shape(self) -> None:
        p = UserPreferenceUpdate(value={"completed": True, "current_step": 3})
        assert p.value == {"completed": True, "current_step": 3}

    def test_acepta_dict_anidado(self) -> None:
        p = UserPreferenceUpdate(
            value={"a": {"b": {"c": [1, 2, 3]}}, "ok": True}
        )
        assert p.value == {"a": {"b": {"c": [1, 2, 3]}}, "ok": True}

    def test_acepta_string(self) -> None:
        p = UserPreferenceUpdate(value="dark")
        assert p.value == "dark"

    def test_acepta_int(self) -> None:
        p = UserPreferenceUpdate(value=42)
        assert p.value == 42

    def test_acepta_float(self) -> None:
        p = UserPreferenceUpdate(value=3.14)
        assert p.value == 3.14

    def test_acepta_bool_true(self) -> None:
        p = UserPreferenceUpdate(value=True)
        assert p.value is True

    def test_acepta_bool_false(self) -> None:
        p = UserPreferenceUpdate(value=False)
        assert p.value is False

    def test_acepta_lista(self) -> None:
        p = UserPreferenceUpdate(value=[1, "two", True, None])
        assert p.value == [1, "two", True, None]

    def test_acepta_dict_vacio(self) -> None:
        p = UserPreferenceUpdate(value={})
        assert p.value == {}

    def test_value_es_required(self) -> None:
        with pytest.raises(ValidationError):
            UserPreferenceUpdate()  # type: ignore[call-arg]

    def test_tour_state_shape_real(self) -> None:
        """Shape canónico que va a usar el frontend para `onboarding_tour`."""
        tour_state = {"completed": False, "current_step": 0}
        p = UserPreferenceUpdate(value=tour_state)
        assert p.value == tour_state
        # Mutación: marcar como completado.
        p2 = UserPreferenceUpdate(value={"completed": True, "current_step": 4})
        assert p2.value["completed"] is True


class TestUserPreferenceReadSchema:
    def test_roundtrip_dict_value(self) -> None:
        r = UserPreferenceRead(
            key="onboarding_tour",
            value={"completed": True, "current_step": 4},
        )
        assert r.key == "onboarding_tour"
        assert r.value == {"completed": True, "current_step": 4}

    def test_roundtrip_scalar_value(self) -> None:
        r = UserPreferenceRead(key="theme", value="dark")
        assert r.key == "theme"
        assert r.value == "dark"


# =====================================================================
# Key validator
# =====================================================================


class TestKeyValidator:
    def test_acepta_alfanumerico(self) -> None:
        _validate_key("onboarding_tour")
        _validate_key("theme")
        _validate_key("digest_v2")

    def test_acepta_caracteres_especiales_permitidos(self) -> None:
        _validate_key("a.b.c")
        _validate_key("foo-bar")
        _validate_key("foo_bar.v2")

    def test_acepta_max_len(self) -> None:
        _validate_key("k" * _MAX_KEY_LEN)

    def test_rechaza_key_vacia(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc:
            _validate_key("")
        assert exc.value.status_code == 400

    def test_rechaza_key_muy_larga(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _validate_key("k" * (_MAX_KEY_LEN + 1))

    def test_rechaza_espacios(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _validate_key("foo bar")

    def test_rechaza_slash(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _validate_key("foo/bar")

    def test_rechaza_caracteres_unicode_raros(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _validate_key("foo;bar")
        with pytest.raises(HTTPException):
            _validate_key("foo$")


# =====================================================================
# Store contract — upsert + get + privacy
# =====================================================================


class TestPreferenceStoreContract:
    def test_get_no_seteada_returns_none(self) -> None:
        """No "vacío" implícito — la key no existe es señal explícita."""
        store = InMemoryPreferenceStore()
        assert store.get("user-1", "onboarding_tour") is None

    def test_upsert_inserta_si_no_existe(self) -> None:
        store = InMemoryPreferenceStore()
        store.upsert("user-1", "onboarding_tour", {"completed": False})
        assert store.get("user-1", "onboarding_tour") == {"completed": False}

    def test_upsert_actualiza_si_ya_existe(self) -> None:
        """ON CONFLICT (user_id, key) DO UPDATE."""
        store = InMemoryPreferenceStore()
        # Insert.
        store.upsert("user-1", "onboarding_tour", {"completed": False, "current_step": 0})
        # Update — misma PK compuesta.
        store.upsert("user-1", "onboarding_tour", {"completed": True, "current_step": 4})
        # El value es el del último write.
        assert store.get("user-1", "onboarding_tour") == {
            "completed": True,
            "current_step": 4,
        }

    def test_upsert_idempotente_mismo_value(self) -> None:
        """Re-PUT con mismo value es no-op observable (más allá de updated_at)."""
        store = InMemoryPreferenceStore()
        value = {"completed": True, "current_step": 4}
        store.upsert("user-1", "onboarding_tour", value)
        store.upsert("user-1", "onboarding_tour", value)
        store.upsert("user-1", "onboarding_tour", value)
        assert store.get("user-1", "onboarding_tour") == value

    def test_upsert_acepta_scalar_y_dict(self) -> None:
        store = InMemoryPreferenceStore()
        store.upsert("user-1", "theme", "dark")
        store.upsert("user-1", "tour_done", True)
        store.upsert("user-1", "feature_flags", {"new_ui": True, "beta": False})
        assert store.get("user-1", "theme") == "dark"
        assert store.get("user-1", "tour_done") is True
        assert store.get("user-1", "feature_flags") == {
            "new_ui": True,
            "beta": False,
        }

    def test_misma_key_distintos_users_son_independientes(self) -> None:
        """PK compuesta: (user_id, key). Cada user tiene su propio espacio."""
        store = InMemoryPreferenceStore()
        store.upsert("user-A", "theme", "dark")
        store.upsert("user-B", "theme", "light")
        assert store.get("user-A", "theme") == "dark"
        assert store.get("user-B", "theme") == "light"


# =====================================================================
# Privacy — user A no lee preferencias de user B
# =====================================================================


class TestPrivacy:
    def test_user_a_no_lee_pref_de_user_b(self) -> None:
        """El filtro `WHERE user_id = :uid` enforza ownership."""
        store = InMemoryPreferenceStore()
        store.upsert("user-A", "onboarding_tour", {"completed": True})
        # User B intenta leer la misma key.
        assert store.get("user-B", "onboarding_tour") is None

    def test_user_b_no_puede_overwrite_via_misma_key(self) -> None:
        """User B escribe su propia row — no afecta la de user A."""
        store = InMemoryPreferenceStore()
        store.upsert("user-A", "onboarding_tour", {"completed": True})
        store.upsert("user-B", "onboarding_tour", {"completed": False})
        # La de A queda intacta.
        assert store.get("user-A", "onboarding_tour") == {"completed": True}
        # La de B existe con su propio valor.
        assert store.get("user-B", "onboarding_tour") == {"completed": False}

    def test_isolation_listing_por_user(self) -> None:
        store = InMemoryPreferenceStore()
        store.upsert("user-A", "tour", {"x": 1})
        store.upsert("user-A", "theme", "dark")
        store.upsert("user-B", "tour", {"x": 999})
        # Cada user solo ve sus 2 / 1 row(s).
        assert store.has("user-A", "tour")
        assert store.has("user-A", "theme")
        assert store.has("user-B", "tour")
        assert not store.has("user-B", "theme")
        assert not store.has("user-A", "no_existe_jamas")
