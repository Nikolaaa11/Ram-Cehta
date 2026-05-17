"""Setea contrasenas temporales para los 8 GG titulares + DIRECTOR.

Round 79 — usa Supabase Auth admin update_user para setear password.
Esto NO envia email (a diferencia de /recover). Util cuando el admin
necesita habilitar acceso rapido para testing.

Las passwords son temporales, faciles de tipear, y los users DEBERIAN
cambiarlas en su primer login (o el admin las rota despues del test).

Run: python backend/scripts/set_temp_passwords_round79.py
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


# (email, role_label, temp_password)
TARGETS = [
    ("btoro@cenergy.cl", "GG global fallback", "Btoro-Cehta-26!"),
    ("jgonzalez@climatesmartleasing.com", "GG CSL", "Jgonzalez-Cehta-26!"),
    ("czuniga@dteconsulting.cl", "GG DTE", "Czuniga-Cehta-26!"),
    ("jiprieto@evoquenergy.com", "GG EVOQUE", "Jiprieto-Cehta-26!"),
    ("camilo@revtech.cl", "GG REVTECH", "Camilo-Cehta-26!"),
    ("j.alvarez@rhoingenieria.cl", "GG RHO", "Jalvarez-Cehta-26!"),
    ("jocuevas@trongkai.com", "GG TRONGKAI", "Jocuevas-Cehta-26!"),
    ("grietta@cehtacapital.com", "DIRECTOR Guido (10/10 empresas)", "Grietta-Cehta-26!"),
]


def get_user_id(email: str) -> str | None:
    """Busca el id del user por email via admin API."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
    }
    # GoTrue admin /users acepta ?email= como filtro
    r = requests.get(url, headers=headers, params={"email": email}, timeout=15)
    if r.status_code != 200:
        return None
    data = r.json()
    users = data.get("users", []) if isinstance(data, dict) else data
    for u in users:
        if u.get("email", "").lower() == email.lower():
            return u.get("id")
    return None


def set_password(user_id: str, new_password: str) -> tuple[bool, str]:
    """admin/users/{id} PUT con {"password": "..."}."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    r = requests.put(
        url, json={"password": new_password}, headers=headers, timeout=15
    )
    return r.status_code in (200, 204), f"HTTP {r.status_code} :: {r.text[:120]}"


def main() -> None:
    print(f"Seteando passwords temporales para {len(TARGETS)} usuarios...\n")
    ok = 0
    fail = 0
    for email, label, pwd in TARGETS:
        uid = get_user_id(email)
        if not uid:
            print(f"  [FAIL] {email:40s} ({label}) — no encontrado en auth.users")
            fail += 1
            continue
        success, msg = set_password(uid, pwd)
        status = "OK" if success else "FAIL"
        print(f"  [{status}] {email:40s} ({label})")
        if success:
            ok += 1
        else:
            print(f"         {msg}")
            fail += 1
    print(f"\nTotal: {ok} OK, {fail} fallidos.")
    print("\nIMPORTANTE: estas passwords son TEMPORALES. Rotalas tras testear.")


if __name__ == "__main__":
    main()
