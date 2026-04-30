"""TotpService — wrapper sobre `pyotp` (V4 fase 2).

Responsabilidades:
1. Generar secrets base32 (RFC 4226).
2. Construir URIs `otpauth://` para que la app autenticadora (Google
   Authenticator, 1Password, Authy, Bitwarden) los consuma vía QR.
3. Verificar códigos TOTP de 6 dígitos con tolerancia de ±1 ventana
   (30s antes/después) para clock skew.
4. Generar y verificar backup codes one-time, guardando solo hashes.

Diseño:
- Stateless: no toca DB, no loggea secrets. La capa router es la que
  decide qué se persiste.
- Backup codes en formato `XXXX-XXXX` (8 chars + dash, 9 total) — fácil
  de tipear, distinguible del TOTP de 6 dígitos numéricos.
- `verify_backup_code` retorna el índice del slot que matchea para que
  el caller lo marque como consumido (slot = "").

NO loggear secrets ni backup codes en claro. La constante de logging es
explícita: si futuras integraciones agregan un `repr()` sobre TwoFactor,
hay que excluir `secret` y `backup_codes` del output.
"""
from __future__ import annotations

import hashlib
import secrets
from urllib.parse import quote

import pyotp


def generate_secret() -> str:
    """Genera un secret base32 random (default 32 chars = 160 bits).

    Compatible con cualquier app TOTP RFC 6238.
    """
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str, issuer: str = "Cehta Capital") -> str:
    """Devuelve URI `otpauth://totp/...` que la app autenticadora consume.

    El formato es estándar — Google Authenticator, 1Password, Authy lo
    parsean idénticamente. El `issuer` aparece en la lista del autenticador
    junto al `email` del usuario.
    """
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def qr_url_for(provisioning: str) -> str:
    """URL pública que renderiza el QR del provisioning URI.

    Usamos `goqr.me` (sin auth, free, simple). Alternativa: generar el SVG
    server-side con `qrcode[pil]`, pero suma 2 dependencias para algo que
    el browser puede consumir directo. Si en el futuro queremos dejar
    de depender del externo, se reemplaza acá sin tocar el frontend.
    """
    encoded = quote(provisioning, safe="")
    return (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=240x240&data={encoded}"
    )


def verify_code(secret: str, code: str) -> bool:
    """Verifica un código TOTP de 6 dígitos.

    `valid_window=1` acepta el código actual + el anterior + el siguiente
    (cada ventana = 30s). Cubre clock skew razonable sin abrir el reloj
    de seguridad demasiado.
    """
    if not code or not code.isdigit() or len(code) != 6:
        return False
    try:
        return pyotp.TOTP(secret).verify(code, valid_window=1)
    except Exception:
        return False


def generate_backup_codes(n: int = 10) -> list[str]:
    """Genera `n` backup codes únicos, formato `XXXX-XXXX` (9 chars).

    Alfabeto: `A-Z + 2-9` (sin 0/1/O/I — confusión visual). 8 chars de
    entropía → ~38 bits, suficiente para uso emergencia (cada código es
    one-time y la cuenta queda lockable si pasa algo raro).
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    out: set[str] = set()
    while len(out) < n:
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        out.add(f"{raw[:4]}-{raw[4:]}")
    return sorted(out)


def hash_backup_code(code: str) -> str:
    """SHA-256 hex del código normalizado (uppercase, sin espacios).

    Determinístico — el mismo input siempre mapea al mismo hash, así que
    podemos comparar sin guardar la versión raw.
    """
    normalized = code.strip().upper().replace(" ", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def verify_backup_code(stored_hashes: list[str], code: str) -> int | None:
    """Si `code` matchea algún hash de la lista (y el slot no está vacío),
    retorna el índice. Si no, None.

    El caller marca el slot como `""` para que el código no se reutilice.
    """
    if not code:
        return None
    target = hash_backup_code(code)
    for idx, stored in enumerate(stored_hashes):
        if stored and stored == target:
            return idx
    return None
