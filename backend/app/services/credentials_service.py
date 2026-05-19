"""Round 115 — Cifrado simétrico de credenciales sensibles.

Las claves SII y Previred del Excel quedan cifradas en
`core.empresa_credenciales.password_encrypted`. Solo este módulo puede
descifrarlas. La clave maestra vive en la env var
`CREDENTIALS_FERNET_KEY` (Fly secret).

USO:
    from app.services.credentials_service import encrypt_credential, decrypt_credential

    ciphered = encrypt_credential("MiClaveSII123!")
    plain = decrypt_credential(ciphered)

SEGURIDAD:
  * La key se inyecta SOLO via env. Si no está, encrypt/decrypt fallan
    explícitamente — no hay fallback "vacío" que silenciosamente
    deje credentials en claro.
  * `decrypt_credential` no loguea el plaintext bajo ninguna circunstancia.
  * Los handlers que la consumen (cliente SII, Previred) la usan
    inmediatamente y la descartan — nunca la guardan en variables
    de larga vida.

ROTACIÓN DE KEY:
  Si la key se compromete:
    1. Generar nueva: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
    2. Descifrar TODAS las rows con la key vieja (script one-off).
    3. Re-cifrar con la nueva.
    4. `fly secrets set CREDENTIALS_FERNET_KEY=<nueva>` y deploy.
  Para evitar el script one-off en el futuro, se podría implementar
  multi-key rotation con prefijos `k1:` / `k2:` en el ciphertext.
"""
from __future__ import annotations

import logging
import os

from cryptography.fernet import Fernet, InvalidToken

log = logging.getLogger(__name__)

_FERNET_INSTANCE: Fernet | None = None


class CredentialsKeyMissing(RuntimeError):
    """La env var CREDENTIALS_FERNET_KEY no está configurada."""


class CredentialDecryptError(RuntimeError):
    """No se pudo descifrar — key incorrecta o ciphertext corrupto."""


def _get_fernet() -> Fernet:
    """Singleton lazy del Fernet. Falla loud si no hay key configurada."""
    global _FERNET_INSTANCE
    if _FERNET_INSTANCE is not None:
        return _FERNET_INSTANCE

    raw = os.environ.get("CREDENTIALS_FERNET_KEY")
    if not raw:
        raise CredentialsKeyMissing(
            "CREDENTIALS_FERNET_KEY no configurada en el entorno. "
            "Generala con: "
            "python -c 'from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())' "
            "y setéala como Fly secret: "
            "fly secrets set CREDENTIALS_FERNET_KEY=<valor> -a cehta-backend"
        )

    try:
        # Fernet espera bytes url-safe base64 de exactamente 32 bytes decoded.
        _FERNET_INSTANCE = Fernet(raw.encode())
    except Exception as exc:
        raise CredentialsKeyMissing(
            f"CREDENTIALS_FERNET_KEY tiene formato inválido. Debe ser una "
            f"key Fernet (44 chars url-safe base64). Error: {exc}"
        ) from exc

    return _FERNET_INSTANCE


def encrypt_credential(plaintext: str) -> str:
    """Cifra una credencial y devuelve el ciphertext como string url-safe.

    El resultado es directamente storable en una columna TEXT.
    """
    if not plaintext:
        raise ValueError("encrypt_credential: plaintext vacío")
    fernet = _get_fernet()
    return fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_credential(ciphertext: str) -> str:
    """Descifra el ciphertext devuelto por `encrypt_credential`.

    Raise CredentialDecryptError si falla — nunca devuelve string vacío
    o None silenciosamente.
    """
    if not ciphertext:
        raise CredentialDecryptError("ciphertext vacío")
    fernet = _get_fernet()
    try:
        return fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        # SECURITY: NO loguear el ciphertext (podría tener metadata).
        log.warning("credential_decrypt_failed: invalid token")
        raise CredentialDecryptError(
            "No se pudo descifrar la credencial — key incorrecta o "
            "ciphertext corrupto."
        ) from exc


def health_check() -> dict[str, bool | str]:
    """Verifica que la key está configurada y funciona. Útil para health endpoint.

    NO devuelve el valor de la key — solo si funciona.
    """
    try:
        fernet = _get_fernet()
        # Round-trip de prueba.
        test = "credentials_service_health_check"
        ciphered = fernet.encrypt(test.encode()).decode()
        recovered = fernet.decrypt(ciphered.encode()).decode()
        return {
            "configured": True,
            "round_trip_ok": recovered == test,
        }
    except CredentialsKeyMissing:
        return {"configured": False, "round_trip_ok": False}
    except Exception as exc:
        return {"configured": True, "round_trip_ok": False, "error": str(exc)[:120]}


__all__ = [
    "CredentialDecryptError",
    "CredentialsKeyMissing",
    "decrypt_credential",
    "encrypt_credential",
    "health_check",
]
