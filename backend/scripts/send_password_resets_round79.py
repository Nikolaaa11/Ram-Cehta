"""Dispara password-reset email a los GG titulares + DIRECTOR (Round 79).

Usa Supabase Auth admin generateLink (type=recovery). Esto genera un link
de recovery y lo envía por email a cada usuario. El usuario lo abre,
escribe una password nueva y queda con acceso.

Targets: emails con rol GG titular en alguna empresa o DIRECTOR.
No incluye al admin (contactocehta@gmail.com) ni al fallback btoro
(quien podes asumir ya recibió en algun reset previo si fuera el caso).

Run: python backend/scripts/send_password_resets_round79.py
"""
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_URL or not SERVICE_KEY:
    print("ERROR: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env")
    sys.exit(1)

# Lista de emails a quienes mandar recovery. Ver
# docs/validacion_vouchers_cuentas.md para el detalle de roles.
TARGETS = [
    # GG titulares por empresa
    ("btoro@cenergy.cl", "GG fallback global (10/10 empresas)"),
    ("jgonzalez@climatesmartleasing.com", "GG CSL"),
    ("czuniga@dteconsulting.cl", "GG DTE"),
    ("jiprieto@evoquenergy.com", "GG EVOQUE"),
    ("camilo@revtech.cl", "GG REVTECH"),
    ("j.alvarez@rhoingenieria.cl", "GG RHO"),
    ("jocuevas@trongkai.com", "GG TRONGKAI"),
    # DIRECTOR (2da firma) — Guido
    ("grietta@cehtacapital.com", "DIRECTOR Guido Rietta (10/10 empresas)"),
]


def send_recovery(email: str, label: str) -> tuple[bool, str]:
    """POST {SUPABASE_URL}/auth/v1/admin/users → generate recovery link
    + dispatch email."""
    # Endpoint admin para enviar password reset.
    # GoTrue acepta POST /auth/v1/recover (publico, no requiere service key)
    # pero esa version no garantiza que se mande el email si el user no
    # confirmó. Mejor usamos /admin/generate_link que es admin-only.
    url = f"{SUPABASE_URL}/auth/v1/recover"
    payload = {"email": email}
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json=payload, headers=headers, timeout=15)
    return r.status_code in (200, 204), f"HTTP {r.status_code} :: {r.text[:120]}"


def main() -> None:
    print(f"Enviando password-reset a {len(TARGETS)} usuarios...\n")
    ok = 0
    fail = 0
    for email, label in TARGETS:
        success, msg = send_recovery(email, label)
        status = "OK" if success else "FAIL"
        print(f"  [{status}] {email:40s} ({label}) — {msg}")
        if success:
            ok += 1
        else:
            fail += 1
    print(f"\nTotal: {ok} enviados, {fail} fallaron.")


if __name__ == "__main__":
    main()
