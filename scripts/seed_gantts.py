"""Seed-import bulk de Cartas Gantt vía sync-from-dropbox.

Usa el endpoint POST /avance/{empresa}/import-excel/sync-from-dropbox que
descarga el Roadmap.xlsx desde Dropbox, lo parsea con el formato
detectado automáticamente y commitea proyectos+hitos a la DB.

Pre-requisitos:
1. Backend deployado con el endpoint sync-from-dropbox (V4 fase 8).
2. Dropbox conectado en /admin/integraciones.
3. Roadmap.xlsx subido a:
   /Cehta Capital/01-Empresas/{empresa}/05-Proyectos & Avance/Roadmap.xlsx

Uso (PowerShell):
    cd Ram-Cehta
    set CEHTA_API_URL=https://cehta-backend.fly.dev/api/v1
    set CEHTA_TOKEN=eyJhbGc...
    python scripts/seed_gantts.py

Para conseguir el token:
    1. Abrí cehta-capital.vercel.app y logueate.
    2. F12 → Application → Local Storage → buscá clave 'sb-*-auth-token'.
    3. Copiá el valor de 'access_token' (sin las comillas).

Idempotente: el endpoint hace upsert por metadata_.codigo_excel, así que
podés correrlo varias veces sin duplicar proyectos.
"""
from __future__ import annotations

import os
import sys
import time

import requests

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]

API_URL = os.environ.get("CEHTA_API_URL", "https://cehta-backend.fly.dev/api/v1")
TOKEN = os.environ.get("CEHTA_TOKEN", "")

# Empresas con Gantt en Dropbox. Si tu DB usa otro código (ej: EE en vez
# de EVOQUE), ajustá acá. Para verificar: GET /catalogos/empresas
EMPRESAS_GANTT: list[str] = [
    "RHO",
    "TRONGKAI",
    "EVOQUE",
    "DTE",
    "REVTECH",
]


def sync_one(empresa: str) -> dict:
    """POST sync-from-dropbox. Devuelve respuesta JSON o {error: ...}."""
    url = f"{API_URL}/avance/{empresa}/import-excel/sync-from-dropbox"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(url, headers=headers, json={}, timeout=180)
    except requests.RequestException as e:
        return {"error": f"Network error: {e}"}

    if r.status_code != 200:
        try:
            detail = r.json().get("detail", r.text[:300])
        except Exception:
            detail = r.text[:300]
        return {"error": f"HTTP {r.status_code}: {detail}"}
    return r.json()


def main() -> int:
    if not TOKEN:
        print("✗ Falta CEHTA_TOKEN.")
        print("  Conseguilo desde DevTools del browser:")
        print("  1. Abrí cehta-capital.vercel.app y logueate.")
        print("  2. F12 → Application → Local Storage → 'sb-*-auth-token'.")
        print("  3. Copiá el valor de 'access_token' (sin comillas).")
        print("  4. set CEHTA_TOKEN=ese_valor && python scripts/seed_gantts.py")
        return 1

    print(f"━━━ Sync Gantt bulk ━━━")
    print(f"  API: {API_URL}")
    print(f"  Empresas: {', '.join(EMPRESAS_GANTT)}")
    print()

    totales = {
        "creados": 0,
        "actualizados": 0,
        "hitos_creados": 0,
        "hitos_actualizados": 0,
        "errores": 0,
        "ok": 0,
    }

    for empresa in EMPRESAS_GANTT:
        print(f"━ {empresa} ─ sincronizando desde Dropbox…")
        t0 = time.time()
        result = sync_one(empresa)
        elapsed = time.time() - t0

        if "error" in result:
            print(f"   ✗ ERROR ({elapsed:.1f}s): {result['error']}")
            totales["errores"] += 1
            continue

        formato = result.get("formato", "?")
        pc = result.get("proyectos_creados", 0)
        pa = result.get("proyectos_actualizados", 0)
        hc = result.get("hitos_creados", 0)
        ha = result.get("hitos_actualizados", 0)
        warns = result.get("warnings", [])

        print(f"   ✓ OK ({elapsed:.1f}s · formato {formato})")
        print(f"     proyectos: +{pc} nuevos, ~{pa} actualizados")
        print(f"     hitos: +{hc} nuevos, ~{ha} actualizados")
        if warns:
            print(f"     ⚠ {len(warns)} warning(s):")
            for w in warns[:3]:
                print(f"       - {w}")

        totales["creados"] += pc
        totales["actualizados"] += pa
        totales["hitos_creados"] += hc
        totales["hitos_actualizados"] += ha
        totales["ok"] += 1

    print()
    print("━" * 60)
    print(
        f"  ✓ {totales['ok']}/{len(EMPRESAS_GANTT)} empresas sincronizadas"
    )
    print(
        f"  Proyectos: +{totales['creados']} nuevos, ~{totales['actualizados']} actualizados"
    )
    print(
        f"  Hitos:     +{totales['hitos_creados']} nuevos, ~{totales['hitos_actualizados']} actualizados"
    )
    if totales["errores"]:
        print(f"  ⚠ {totales['errores']} empresas fallaron — revisá arriba.")
    print("━" * 60)
    return 0 if totales["errores"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
