"""R152AAAA · Sube los logos de las empresas a Dropbox + actualiza DB.

Uso:
  python scripts/_upload_logos_dropbox.py <dir_con_logos>

Mapea archivos por nombre base: {CODIGO}.{ext} → empresa codigo.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import dropbox
import psycopg2

# Credenciales (sacadas del container Fly + de la DB core.integrations)
DROPBOX_CLIENT_ID = "uj21ugdbgb3ao3p"
DROPBOX_CLIENT_SECRET = "ignq3m6a9ry72kq"
# refresh_token activo viene de core.integrations (NO de env: el .env tiene
# el original que ya fue rotado por OAuth)

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)

EMPRESAS_CONOCIDAS = {
    "AFIS", "FIP_CEHTA", "CEHTA", "CENERGY", "EVOQUE", "CSL",
    "TRONGKAI", "RHO", "REVTECH", "DTE",
}


def main(logos_dir: str) -> None:
    path = Path(logos_dir)
    if not path.is_dir():
        sys.exit(f"No es directorio: {path}")

    logos = sorted(path.glob("*"))
    print(f"=== R152AAAA Upload logos a Dropbox ===")
    print(f"Carpeta: {path}")
    print(f"Archivos detectados: {len(logos)}")
    print()

    # Leer credenciales activas de la DB (core.integrations.dropbox)
    conn_creds = psycopg2.connect(DATABASE_URL)
    cur_creds = conn_creds.cursor()
    cur_creds.execute(
        "SELECT access_token, refresh_token FROM core.integrations "
        "WHERE provider = %s",
        ("dropbox",),
    )
    row = cur_creds.fetchone()
    cur_creds.close()
    conn_creds.close()
    if not row:
        sys.exit("No hay integracion dropbox activa en core.integrations")
    access_token, refresh_token = row

    dbx = dropbox.Dropbox(
        oauth2_access_token=access_token,
        oauth2_refresh_token=refresh_token,
        app_key=DROPBOX_CLIENT_ID,
        app_secret=DROPBOX_CLIENT_SECRET,
    )
    # Verifica que el token funciona
    acc = dbx.users_get_current_account()
    print(f"Conectado a Dropbox como: {acc.name.display_name} ({acc.email})")
    print()

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    uploaded = 0
    skipped = 0
    for logo_path in logos:
        if logo_path.is_dir():
            continue
        # codigo = nombre sin extensión, uppercase
        codigo = logo_path.stem.upper()
        if codigo not in EMPRESAS_CONOCIDAS:
            print(f"  SKIP {logo_path.name} (codigo {codigo!r} no esta en empresas conocidas)")
            skipped += 1
            continue
        ext = logo_path.suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            print(f"  SKIP {logo_path.name} (extension {ext} no soportada)")
            skipped += 1
            continue
        dropbox_path = f"/Cehta Capital/01-Empresas/{codigo}/00-Branding/logo{ext}"

        # Crear carpetas padre (idempotente)
        parts = []
        for part in dropbox_path.split("/")[:-1]:
            if part:
                parts.append(part)
                folder = "/" + "/".join(parts)
                try:
                    dbx.files_create_folder_v2(folder)
                except dropbox.exceptions.ApiError as e:
                    if "conflict" in str(e).lower() or "already_exists" in str(e).lower():
                        pass  # ya existe
                    else:
                        # Otros errores, ignoramos silencioso
                        pass

        # Subir archivo con overwrite
        content = logo_path.read_bytes()
        dbx.files_upload(
            content,
            dropbox_path,
            mode=dropbox.files.WriteMode.overwrite,
            autorename=False,
        )

        # Actualizar DB
        cur.execute(
            """UPDATE core.empresas
               SET logo_dropbox_path = %s, updated_at = NOW()
               WHERE codigo = %s""",
            (dropbox_path, codigo),
        )
        print(f"  OK  {codigo:12s} {dropbox_path}  ({len(content):>7} bytes)")
        uploaded += 1

    conn.commit()
    cur.close()
    conn.close()

    print()
    print(f"=== Listo: {uploaded} subidos, {skipped} saltados ===")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python _upload_logos_dropbox.py <dir_con_logos>")
        sys.exit(1)
    main(sys.argv[1])
