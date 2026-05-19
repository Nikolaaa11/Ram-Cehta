"""Unit tests para credentials_service (Round 115).

Cubre:
  - encrypt + decrypt round trip
  - InvalidToken cuando ciphertext es corrupto
  - CredentialsKeyMissing cuando env var no esta
  - Distinct cipher cada vez (Fernet usa IV aleatorio)
  - Empty plaintext rechazado
"""
from __future__ import annotations

import os

import pytest
from cryptography.fernet import Fernet

from app.services import credentials_service as cs


@pytest.fixture(autouse=True)
def _reset_singleton(monkeypatch):
    """Cada test arranca con un Fernet limpio."""
    monkeypatch.setattr(cs, "_FERNET_INSTANCE", None)


@pytest.fixture
def _with_key(monkeypatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("CREDENTIALS_FERNET_KEY", key)
    return key


def test_round_trip(_with_key):
    cipher = cs.encrypt_credential("MiClaveSII!")
    assert cs.decrypt_credential(cipher) == "MiClaveSII!"


def test_cipher_is_nondeterministic(_with_key):
    """Fernet usa IV aleatorio — mismo plaintext = ciphers distintos."""
    c1 = cs.encrypt_credential("misma_clave")
    c2 = cs.encrypt_credential("misma_clave")
    assert c1 != c2
    assert cs.decrypt_credential(c1) == cs.decrypt_credential(c2) == "misma_clave"


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("CREDENTIALS_FERNET_KEY", raising=False)
    with pytest.raises(cs.CredentialsKeyMissing):
        cs.encrypt_credential("x")


def test_malformed_key_raises(monkeypatch):
    monkeypatch.setenv("CREDENTIALS_FERNET_KEY", "no-es-fernet-valido")
    with pytest.raises(cs.CredentialsKeyMissing):
        cs.encrypt_credential("x")


def test_decrypt_with_wrong_key_raises(monkeypatch, _with_key):
    cipher = cs.encrypt_credential("secret")
    # Rotar la key sin re-cifrar — el decrypt debe fallar limpio.
    monkeypatch.setattr(cs, "_FERNET_INSTANCE", None)
    monkeypatch.setenv("CREDENTIALS_FERNET_KEY", Fernet.generate_key().decode())
    with pytest.raises(cs.CredentialDecryptError):
        cs.decrypt_credential(cipher)


def test_decrypt_corrupted_ciphertext_raises(_with_key):
    with pytest.raises(cs.CredentialDecryptError):
        cs.decrypt_credential("ZZZZZZZ-not-a-valid-token")


def test_empty_plaintext_rejected(_with_key):
    with pytest.raises(ValueError):
        cs.encrypt_credential("")


def test_empty_ciphertext_raises(_with_key):
    with pytest.raises(cs.CredentialDecryptError):
        cs.decrypt_credential("")


def test_health_check_ok(_with_key):
    h = cs.health_check()
    assert h["configured"] is True
    assert h["round_trip_ok"] is True


def test_health_check_no_key(monkeypatch):
    monkeypatch.delenv("CREDENTIALS_FERNET_KEY", raising=False)
    h = cs.health_check()
    assert h["configured"] is False


def test_handles_unicode_and_specials(_with_key):
    """Las claves del Excel tienen caracteres especiales (#, @, !, *, .) y acentos."""
    samples = ["P@ssw0rd!", "Cenergy.2025", "Q12w3e4r.", "Papu1983*", "ñ@cliáve"]
    for s in samples:
        assert cs.decrypt_credential(cs.encrypt_credential(s)) == s
