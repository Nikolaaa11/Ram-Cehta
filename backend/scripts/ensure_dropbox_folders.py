"""MEGAPROMPT PREVOUCHER F4 — Sistema de carpetas canónico en Dropbox.

Crea (idempotente, solo CREA — nunca borra ni mueve) la estructura de
carpetas que la plataforma usa para SACAR y GUARDAR información, para las
10 empresas + carpetas raíz. La estructura refleja EXACTAMENTE los paths
que el código ya usa (mapeados en docs/MEGAPROMPT_CHANGELOG.md · F4):

/Cehta Capital/
├── 00-Inbox/{año}/                       ← adjuntos de emails entrantes
├── 00-Inteligencia de Negocios/          ← Data Madre (+ Histórico/ del ETL)
├── 01-Empresas/{COD}/
│   ├── 00-Branding/                      ← logo.png para PDFs de OC/voucher
│   ├── 02-Trabajadores/Activos/          ← carpetas por trabajador
│   ├── 02-Trabajadores/Inactivos/
│   ├── 03-Legal/                         ← docs legales por categoría
│   │   └── Declaraciones SII/F29/ y F22/ ← PDFs que sincroniza la plataforma
│   ├── 04-Financiero/Cartolas Bancarias/ ← PDFs cartolas (sync conciliación)
│   ├── 04-Financiero/Estados Financieros/{Mensuales,Trimestrales,Semestrales,Anuales}/
│   ├── 05-Proyectos & Avance/            ← Roadmap.xlsx / Carta Gantt.xlsx
│   ├── 06-Adjuntos-Vouchers/{año}/       ← fotos/PDFs subidos al crear voucher
│   └── 06-Adjuntos-OCs/{año}/            ← fotos/PDFs subidos al crear OC
├── 02-Fondo (FIP CEHTA)/Vouchers/{COD}/  ← adjuntos formales por voucher
├── 08-AI Knowledge Base/{COD}/           ← docs que indexa ClaudIA
├── 99-Backups/                           ← dumps pg_dump del cron
└── Fondos & Inversionistas/              ← LPs Pipeline.xlsx

Uso (con DATABASE_URL en el entorno o backend/.env cargado):
    python -m scripts.ensure_dropbox_folders [--dry-run]
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

EMPRESAS = [
    "AFIS", "CEHTA", "CENERGY", "CSL", "DTE",
    "EVOQUE", "FIP_CEHTA", "REVTECH", "RHO", "TRONGKAI",
]
ROOT = "/Cehta Capital"


def canonical_paths() -> list[str]:
    year = datetime.now(timezone.utc).year
    paths: list[str] = [
        f"{ROOT}/00-Inbox/{year}",
        f"{ROOT}/00-Inteligencia de Negocios",
        f"{ROOT}/99-Backups",
        f"{ROOT}/Fondos & Inversionistas",
    ]
    for cod in EMPRESAS:
        base = f"{ROOT}/01-Empresas/{cod}"
        paths += [
            f"{base}/00-Branding",
            f"{base}/02-Trabajadores/Activos",
            f"{base}/02-Trabajadores/Inactivos",
            f"{base}/03-Legal/Declaraciones SII/F29",
            f"{base}/03-Legal/Declaraciones SII/F22",
            f"{base}/04-Financiero/Cartolas Bancarias",
            f"{base}/04-Financiero/Estados Financieros/Mensuales",
            f"{base}/04-Financiero/Estados Financieros/Trimestrales",
            f"{base}/04-Financiero/Estados Financieros/Semestrales",
            f"{base}/04-Financiero/Estados Financieros/Anuales",
            f"{base}/05-Proyectos & Avance",
            f"{base}/06-Adjuntos-Vouchers/{year}",
            f"{base}/06-Adjuntos-OCs/{year}",
            f"{ROOT}/02-Fondo (FIP CEHTA)/Vouchers/{cod}",
            f"{ROOT}/08-AI Knowledge Base/{cod}",
        ]
    return paths


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    paths = canonical_paths()
    print(f"Sistema de carpetas: {len(paths)} rutas canónicas")
    if dry_run:
        for p in paths:
            print(f"  [dry-run] {p}")
        return 0

    import psycopg2

    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT access_token, refresh_token FROM core.integrations "
                "WHERE provider = 'dropbox' LIMIT 1"
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        print("ERROR: Dropbox no conectado (core.integrations)")
        return 1

    from app.services.dropbox_service import DropboxService

    dbx = DropboxService(access_token=row[0], refresh_token=row[1])
    ok = 0
    errores: list[str] = []
    for p in paths:
        try:
            dbx.ensure_folder_path(p)
            ok += 1
        except Exception as exc:  # noqa: BLE001
            errores.append(f"{p}: {exc}")
    print(f"OK: {ok}/{len(paths)} rutas aseguradas (crear-si-falta, idempotente)")
    for e in errores[:10]:
        print(f"  ERROR {e}")
    return 0 if not errores else 1


if __name__ == "__main__":
    raise SystemExit(main())
