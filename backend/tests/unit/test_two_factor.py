"""Unit tests para 2FA TOTP service y schemas (V4 fase 2).

Cubre:
  - generate_secret / provisioning_uri / qr_url_for (formato).
  - verify_code (current, past, future, invalid format).
  - generate_backup_codes (cantidad, unicidad, formato XXXX-XXXX).
  - hash_backup_code (determinístico, normaliza case y espacios).
  - verify_backup_code (match index, miss, slot vacío).
  - Schemas: VerifyRequest valida 6-9 chars, EnrollResponse roundtrip.

No tocamos DB — el router usa SQL inline y se cubre en integration tests
con testcontainers (cuando los habilitemos). Acá nos quedamos en el
service + schemas.
"""
from __future__ import annotations

import time

import pyotp
import pytest
from pydantic import ValidationError

from app.schemas.two_factor import (
    BackupCodesResponse,
    DisableRequest,
    EnrollResponse,
    StatusResponse,
    VerifyRequest,
)
from app.services import totp_service

# =====================================================================
# generate_secret / provisioning_uri / qr_url_for
# =====================================================================


class TestSecretGeneration:
    def test_secret_es_base32(self) -> None:
        secret = totp_service.generate_secret()
        # Base32 alphabet de pyotp: A-Z + 2-7. No tiene 0, 1, 8, 9.
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in secret)

    def test_secret_len_default_es_32_chars(self) -> None:
        secret = totp_service.generate_secret()
        assert len(secret) == 32

    def test_secrets_son_unicos(self) -> None:
        # Si 100 secrets random colisionan, algo está muy mal.
        secrets_set = {totp_service.generate_secret() for _ in range(100)}
        assert len(secrets_set) == 100


class TestProvisioningUri:
    def test_uri_format_es_otpauth_totp(self) -> None:
        secret = "JBSWY3DPEHPK3PXP"  # noqa: S105 — test fixture, no es secret real
        uri = totp_service.provisioning_uri(secret, email="user@cehta.cl")
        assert uri.startswith("otpauth://totp/")
        assert "secret=" in uri
        # El issuer "Cehta Capital" se url-encodea.
        assert "Cehta%20Capital" in uri or "Cehta+Capital" in uri
        assert "user@cehta.cl" in uri or "user%40cehta.cl" in uri

    def test_uri_acepta_issuer_custom(self) -> None:
        secret = "JBSWY3DPEHPK3PXP"  # noqa: S105 — test fixture
        uri = totp_service.provisioning_uri(secret, email="x@y.com", issuer="ACME")
        assert "ACME" in uri

    def test_qr_url_apunta_a_servicio_qr(self) -> None:
        uri = "otpauth://totp/test?secret=ABC"
        qr = totp_service.qr_url_for(uri)
        assert qr.startswith("https://")
        assert "qr-code" in qr.lower() or "qrserver" in qr.lower()


# =====================================================================
# verify_code (TOTP 6 dígitos con tolerancia de ±30s)
# =====================================================================


class TestVerifyCode:
    def test_acepta_codigo_actual(self) -> None:
        secret = pyotp.random_base32()
        code = pyotp.TOTP(secret).now()
        assert totp_service.verify_code(secret, code) is True

    def test_rechaza_codigo_invalido(self) -> None:
        secret = pyotp.random_base32()
        # Codigo de 6 dígitos pero arbitrario — tiene chance ~1/1M de
        # accidentalmente matchear; "000000" es razonablemente seguro.
        # Para evitar flakiness, comparamos contra el current y elegimos
        # otro.
        current = pyotp.TOTP(secret).now()
        candidate = "000000" if current != "000000" else "111111"
        assert totp_service.verify_code(secret, candidate) is False

    def test_acepta_codigo_de_30s_atras_clock_skew(self) -> None:
        """Tolerancia ±1 ventana — código de 30s atrás debe pasar."""
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        past_code = totp.at(time.time() - 30)
        assert totp_service.verify_code(secret, past_code) is True

    def test_rechaza_codigo_muy_lejano_en_pasado(self) -> None:
        """Más de 1 ventana de skew (>30s) → reject."""
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        very_old = totp.at(time.time() - 120)
        assert totp_service.verify_code(secret, very_old) is False

    def test_rechaza_formato_invalido_no_numerico(self) -> None:
        secret = pyotp.random_base32()
        assert totp_service.verify_code(secret, "abcdef") is False

    def test_rechaza_formato_invalido_long(self) -> None:
        secret = pyotp.random_base32()
        assert totp_service.verify_code(secret, "12345") is False
        assert totp_service.verify_code(secret, "1234567") is False

    def test_rechaza_string_vacio(self) -> None:
        secret = pyotp.random_base32()
        assert totp_service.verify_code(secret, "") is False


# =====================================================================
# generate_backup_codes / hash_backup_code / verify_backup_code
# =====================================================================


class TestBackupCodes:
    def test_default_genera_10_codes(self) -> None:
        codes = totp_service.generate_backup_codes()
        assert len(codes) == 10

    def test_n_custom_respetado(self) -> None:
        codes = totp_service.generate_backup_codes(n=5)
        assert len(codes) == 5

    def test_codes_son_unicos(self) -> None:
        codes = totp_service.generate_backup_codes(10)
        assert len(set(codes)) == 10

    def test_format_xxxx_dash_xxxx(self) -> None:
        codes = totp_service.generate_backup_codes(10)
        for c in codes:
            assert len(c) == 9, f"código {c} no es 9 chars"
            assert c[4] == "-", f"código {c} no tiene dash en posición 4"
            # Sin chars confusos: 0/1/O/I excluidos.
            for ch in c.replace("-", ""):
                assert ch not in "01OI", f"{c} contiene char confuso"

    def test_hash_es_deterministico(self) -> None:
        h1 = totp_service.hash_backup_code("ABCD-1234")
        h2 = totp_service.hash_backup_code("ABCD-1234")
        assert h1 == h2

    def test_hash_normaliza_case(self) -> None:
        h_upper = totp_service.hash_backup_code("ABCD-WXYZ")
        h_lower = totp_service.hash_backup_code("abcd-wxyz")
        h_mixed = totp_service.hash_backup_code("AbCd-WxYz")
        assert h_upper == h_lower == h_mixed

    def test_hash_normaliza_espacios(self) -> None:
        h_clean = totp_service.hash_backup_code("ABCD-WXYZ")
        h_spaced = totp_service.hash_backup_code("  ABCD-WXYZ  ")
        assert h_clean == h_spaced

    def test_hash_es_sha256_hex_64_chars(self) -> None:
        h = totp_service.hash_backup_code("X")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_verify_backup_code_match_returns_index(self) -> None:
        codes = totp_service.generate_backup_codes(10)
        hashed = [totp_service.hash_backup_code(c) for c in codes]
        # Match el de índice 3.
        idx = totp_service.verify_backup_code(hashed, codes[3])
        assert idx == 3

    def test_verify_backup_code_match_primera_posicion(self) -> None:
        codes = totp_service.generate_backup_codes(10)
        hashed = [totp_service.hash_backup_code(c) for c in codes]
        idx = totp_service.verify_backup_code(hashed, codes[0])
        assert idx == 0

    def test_verify_backup_code_returns_none_si_no_existe(self) -> None:
        codes = totp_service.generate_backup_codes(10)
        hashed = [totp_service.hash_backup_code(c) for c in codes]
        assert totp_service.verify_backup_code(hashed, "ZZZZ-ZZZZ") is None

    def test_verify_backup_code_skip_slots_vacios(self) -> None:
        """Si el slot está consumido (string vacío), no debe matchear."""
        codes = totp_service.generate_backup_codes(3)
        hashed = [totp_service.hash_backup_code(c) for c in codes]
        # Consumimos el slot 1 (lo blanqueamos).
        hashed[1] = ""
        # El code original ya no debe matchear porque su slot está vacío.
        assert totp_service.verify_backup_code(hashed, codes[1]) is None
        # Los otros sí.
        assert totp_service.verify_backup_code(hashed, codes[0]) == 0
        assert totp_service.verify_backup_code(hashed, codes[2]) == 2

    def test_verify_backup_code_acepta_input_lowercase(self) -> None:
        codes = totp_service.generate_backup_codes(5)
        hashed = [totp_service.hash_backup_code(c) for c in codes]
        # Hashear normaliza, así que el verify acepta lowercase.
        idx = totp_service.verify_backup_code(hashed, codes[2].lower())
        assert idx == 2

    def test_verify_backup_code_rechaza_string_vacio(self) -> None:
        hashed = ["dummy_hash"]
        assert totp_service.verify_backup_code(hashed, "") is None


# =====================================================================
# Schemas
# =====================================================================


class TestSchemas:
    def test_verify_request_acepta_6_digitos(self) -> None:
        req = VerifyRequest(code="123456")
        assert req.code == "123456"

    def test_verify_request_acepta_backup_code_9_chars(self) -> None:
        req = VerifyRequest(code="ABCD-1234")
        assert req.code == "ABCD-1234"

    def test_verify_request_rechaza_5_chars(self) -> None:
        with pytest.raises(ValidationError):
            VerifyRequest(code="12345")

    def test_verify_request_rechaza_10_chars(self) -> None:
        with pytest.raises(ValidationError):
            VerifyRequest(code="ABCD-12345")

    def test_disable_request_mismo_shape(self) -> None:
        req = DisableRequest(code="123456")
        assert req.code == "123456"

    def test_status_response_default_disabled(self) -> None:
        resp = StatusResponse(enabled=False)
        assert resp.enabled is False
        assert resp.enabled_at is None
        assert resp.backup_codes_remaining == 0

    def test_enroll_response_roundtrip(self) -> None:
        resp = EnrollResponse(
            secret="JBSWY3DPEHPK3PXP",
            provisioning_uri="otpauth://totp/Cehta%20Capital:user@cehta.cl?secret=JBSW",
            qr_url="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=x",
            backup_codes=["ABCD-1234", "WXYZ-5678"],
        )
        assert resp.secret == "JBSWY3DPEHPK3PXP"  # noqa: S105 — test fixture
        assert len(resp.backup_codes) == 2

    def test_backup_codes_response(self) -> None:
        resp = BackupCodesResponse(
            backup_codes=["A" * 4 + "-" + "B" * 4 for _ in range(10)]
        )
        assert len(resp.backup_codes) == 10
