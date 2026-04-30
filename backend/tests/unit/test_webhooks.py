"""Tests para los helpers puros del webhook dispatcher.

Los endpoints se prueban en integración (necesitan DB real). Acá nos
enfocamos en HMAC signing y la lista de eventos publicables.
"""
from __future__ import annotations

import hashlib
import hmac

from app.schemas.webhook import (
    WEBHOOK_EVENT_TYPES,
    WebhookSubscriptionCreate,
)
from app.services.webhook_dispatcher import generate_secret, sign_payload


# ---------------------------------------------------------------------
# generate_secret / sign_payload
# ---------------------------------------------------------------------
class TestSecretGeneration:
    def test_secret_es_url_safe_y_no_corto(self) -> None:
        s = generate_secret()
        # base64url of 32 bytes ≈ 43 chars
        assert len(s) >= 40
        # No bytes especiales URL-unsafe
        assert "=" not in s or s.endswith("=")
        for ch in s:
            assert ch.isalnum() or ch in "_-"

    def test_secrets_son_unicos(self) -> None:
        s1 = generate_secret()
        s2 = generate_secret()
        assert s1 != s2


class TestSignPayload:
    def test_sign_es_hmac_sha256_hex(self) -> None:
        secret = "test-secret-123"
        body = b'{"event":"oc.paid"}'
        out = sign_payload(secret, body)
        # 64 hex chars = SHA-256
        assert len(out) == 64
        assert all(c in "0123456789abcdef" for c in out)

    def test_sign_idempotente(self) -> None:
        secret = "abc"
        body = b"hello"
        assert sign_payload(secret, body) == sign_payload(secret, body)

    def test_sign_cambia_si_secret_cambia(self) -> None:
        body = b"hello"
        assert sign_payload("a", body) != sign_payload("b", body)

    def test_sign_cambia_si_body_cambia(self) -> None:
        secret = "abc"
        assert sign_payload(secret, b"x") != sign_payload(secret, b"y")

    def test_receiver_puede_verificar(self) -> None:
        """Test de integración mental: el receiver recibe el body + signature
        y debe poder reconstruir el HMAC con su copia del secret.
        """
        secret = "shared-secret-known-to-both"
        body = b'{"event":"test","data":{"x":1}}'
        sent_signature = sign_payload(secret, body)
        # Receiver:
        recomputed = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert hmac.compare_digest(sent_signature, recomputed)


# ---------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------
class TestSubscriptionCreateSchema:
    def test_minimo_aceptado(self) -> None:
        sub = WebhookSubscriptionCreate(
            name="Slack alerts",
            target_url="https://hooks.slack.com/services/T0/B0/abc",  # type: ignore[arg-type]
            events=["oc.paid"],
        )
        assert sub.active is True

    def test_url_invalida_falla(self) -> None:
        from pydantic import ValidationError

        try:
            WebhookSubscriptionCreate(
                name="x",
                target_url="not-a-url",  # type: ignore[arg-type]
                events=["test"],
            )
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError")

    def test_eventos_vacios_falla(self) -> None:
        from pydantic import ValidationError

        try:
            WebhookSubscriptionCreate(
                name="x",
                target_url="https://example.com/hook",  # type: ignore[arg-type]
                events=[],
            )
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError")

    def test_event_invalido_falla(self) -> None:
        from pydantic import ValidationError

        try:
            WebhookSubscriptionCreate(
                name="x",
                target_url="https://example.com/hook",  # type: ignore[arg-type]
                events=["bogus.event"],  # type: ignore[list-item]
            )
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError")

    def test_name_max_120_chars(self) -> None:
        from pydantic import ValidationError

        try:
            WebhookSubscriptionCreate(
                name="x" * 121,
                target_url="https://example.com/hook",  # type: ignore[arg-type]
                events=["test"],
            )
        except ValidationError:
            pass
        else:
            raise AssertionError("Esperado ValidationError")


# ---------------------------------------------------------------------
# WEBHOOK_EVENT_TYPES list invariants
# ---------------------------------------------------------------------
class TestEventTypesList:
    def test_lista_no_vacia(self) -> None:
        assert len(WEBHOOK_EVENT_TYPES) > 5

    def test_test_event_existe(self) -> None:
        # Necesario para que el botón "Test" del frontend funcione
        assert "test" in WEBHOOK_EVENT_TYPES

    def test_eventos_clave_de_negocio(self) -> None:
        for evt in ("oc.paid", "f29.due", "etl.completed"):
            assert evt in WEBHOOK_EVENT_TYPES

    def test_eventos_sin_duplicados(self) -> None:
        assert len(WEBHOOK_EVENT_TYPES) == len(set(WEBHOOK_EVENT_TYPES))

    def test_naming_es_dotted(self) -> None:
        # `entity.action` o nombre simple (test). No espacios. Underscores
        # tolerados dentro del 'action' (audit.high_severity es válido).
        for evt in WEBHOOK_EVENT_TYPES:
            assert " " not in evt
            # Si tiene punto, ambos lados deben ser no-vacíos
            if "." in evt:
                left, right = evt.split(".", 1)
                assert left and right
