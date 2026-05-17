"""Plan B Round 79 — genera recovery links SIN enviar email.

Cuando /auth/v1/recover hit el rate limit de Supabase (2 emails/hora en
free tier), usar /auth/v1/admin/generate_link que NO consume el rate
limit porque no envia email — solo devuelve el link.

El admin (vos) luego reenviá los links por WhatsApp/Slack/etc a cada GG.

Run: python backend/scripts/generate_recovery_links_round79.py
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

# Los que faltaron por rate limit en el script anterior + el resto.
# btoro@cenergy.cl y jgonzalez@climatesmartleasing.com ya recibieron email.
TARGETS = [
    ("czuniga@dteconsulting.cl", "GG DTE"),
    ("jiprieto@evoquenergy.com", "GG EVOQUE"),
    ("camilo@revtech.cl", "GG REVTECH"),
    ("j.alvarez@rhoingenieria.cl", "GG RHO"),
    ("jocuevas@trongkai.com", "GG TRONGKAI"),
    ("grietta@cehtacapital.com", "DIRECTOR Guido Rietta"),
]


def gen_link(email: str) -> tuple[bool, str]:
    """admin/generate_link no envia email, devuelve el link directo."""
    url = f"{SUPABASE_URL}/auth/v1/admin/generate_link"
    payload = {"type": "recovery", "email": email}
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    r = requests.post(url, json=payload, headers=headers, timeout=15)
    if r.status_code in (200, 201):
        data = r.json()
        # GoTrue returns "action_link" o "properties.action_link"
        link = (
            data.get("action_link")
            or data.get("properties", {}).get("action_link")
            or ""
        )
        return True, link
    return False, f"HTTP {r.status_code} :: {r.text[:160]}"


def main() -> None:
    print(f"Generando recovery links para {len(TARGETS)} usuarios...\n")
    print("(estos links son ÚNICOS y VÁLIDOS 1 HORA — reenvialos por WApp/email)\n")
    for email, label in TARGETS:
        ok, val = gen_link(email)
        if ok:
            print(f"[OK] {email}  ({label})")
            print(f"     {val}\n")
        else:
            print(f"[FAIL] {email}  ({label}) — {val}\n")


if __name__ == "__main__":
    main()
