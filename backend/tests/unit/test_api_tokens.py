"""Tests para los helpers puros del API token service.

Los endpoints/DB lookups se prueban en integración. Acá: generación,
hashing, formato del hint, prefix invariants.
"""
from __future__ import annotations

from app.schemas.api_token import ApiTokenCreate
from app.services.api_token_service import (
    TOKEN_PREFIX,
    generate_token,
    hash_token,
    token_hint,
)


# ---------------------------------------------------------------------
# generate_token
# ---------------------------------------------------------------------
class TestGenerateToken:
    def test_token_tiene_prefix(self) -> None:
        t = generate_token()
        assert t.startswith("cak_")
        assert TOKEN_PREFIX == "cak_"

    def test_token_es_url_safe(self) -> None:
        t = generate_token()
        # Quitamos prefix para verificar la parte random
        body = t[len(TOKEN_PREFIX):]
        for ch in body:
            assert ch.isalnum() or ch in "_-"

    def test_token_largo_consistente(self) -> None:
        # base64url de 32 bytes ≈ 43 chars + 4 chars de prefix
        t = generate_token()
        assert len(t) >= 40

    def test_tokens_son_unicos(self) -> None:
        tokens = {generate_token() for _ in range(50)}
        # Probabilidad de colisión con 32 bytes de entropía es astronómicamente baja
        assert len(tokens) == 50


# ---------------------------------------------------------------------
# hash_token
# ---------------------------------------------------------------------
class TestHashToken:
    def test_es_sha256_hex(self) -> None:
        h = hash_token("cak_test")
        # 64 hex chars = SHA-256
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_es_deterministic(self) -> None:
        assert hash_token("cak_abc") == hash_token("cak_abc")

    def test_distintos_tokens_distintos_hashes(self) -> None:
        assert hash_token("cak_a") != hash_token("cak_b")

    def test_es_one_way(self) -> None:
        # No es trivial recuperar el plaintext del hash. Esto es semántica;
        # confiamos en SHA-256.
        h = hash_token("cak_my_secret_xyz")
        assert "cak_my_secret_xyz" not in h


# ---------------------------------------------------------------------
# token_hint
# ---------------------------------------------------------------------
class TestTokenHint:
    def test_muestra_primeros_12_chars(self) -> None:
        hint = token_hint("cak_AbCdEfGhIjKlMnOpQrStUv")
        assert hint.startswith("cak_AbCdEfGh")
        assert hint.endswith("…")

    def test_no_expone_full_token(self) -> None:
        full = "cak_super_secret_token_xyz_12345"
        hint = token_hint(full)
        assert hint != full
        assert "secret" not in hint
        assert "12345" not in hint

    def test_token_corto_se_corta_correcto(self) -> None:
        hint = token_hint("cak_short")
        # Aunque sea más corto que 12, no rompe — Python slice tolera
        assert hint.startswith("cak_short")


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------
class TestApiTokenCreate:
    def test_minimo_aceptado(self) -> None:
        c = ApiTokenCreate(name="Power BI integration")
        assert c.expires_at is None
        assert c.description is None

    def test_name_max_120(self) -> None:
        from pydantic import ValidationError

        try:
            ApiTokenCreate(name="x" * 121)
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError por name > 120")

    def test_name_vacio_falla(self) -> None:
        from pydantic import ValidationError

        try:
            ApiTokenCreate(name="")
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError por name vacío")

    def test_description_max_500(self) -> None:
        from pydantic import ValidationError

        try:
            ApiTokenCreate(name="ok", description="x" * 501)
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError por description > 500")

    def test_description_500_chars_aceptado(self) -> None:
        c = ApiTokenCreate(name="ok", description="x" * 500)
        assert c.description is not None and len(c.description) == 500


# ---------------------------------------------------------------------
# Hash + prefix integration mental check
# ---------------------------------------------------------------------
class TestEndToEnd:
    def test_typical_flow(self) -> None:
        """Simula el flow completo: generate → hash → almacenar → verificar.

        Como acá no tenemos DB, simulamos el almacenamiento con un dict.
        """
        token = generate_token()
        h = hash_token(token)
        # "Storage"
        store = {h: {"id": "uuid-1", "name": "test"}}

        # Verificación: re-hash el token entrante, lookup
        incoming = token  # client envía el plaintext
        assert hash_token(incoming) == h
        assert store[hash_token(incoming)]["id"] == "uuid-1"

    def test_distinto_token_no_matchea(self) -> None:
        legit = generate_token()
        attacker = generate_token()  # otro token random
        store = {hash_token(legit): "user-1"}
        assert hash_token(attacker) not in store
