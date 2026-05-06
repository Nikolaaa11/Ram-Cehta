"""Backup automático de la DB Postgres → Dropbox /99-Backups/.

Se invoca desde un cron Fly (recomendado: diario 03:00 UTC = 00:00 CLT).

Estrategia:
  1. pg_dump del schema completo (custom format binario, comprimible).
  2. Sube el archivo a Dropbox /Cehta Capital/99-Backups/{YYYY-MM-DD}.dump.
  3. Mantiene últimos 30 días + último de cada mes (retention manual via
     un job separado — no implementado acá).

Tamaño estimado: ~50MB para la DB actual (vouchers + movimientos +
inbox_messages comprimidos en custom-format).

Restore (manual, desde laptop):
    pg_restore -h <host> -U <user> -d <db> --clean --if-exists \\
        backup_2026-05-06.dump

Soft-fail: si Dropbox no está configurado o pg_dump falla, log error y
exit 1 — el cron fly verá el non-zero exit y alertará si está configurado.

Variables de entorno:
    DATABASE_URL                — fuente del dump
    DROPBOX_REFRESH_TOKEN       — destino (Cehta corporate Dropbox)
    BACKUP_RETENTION_DAYS       — opcional, default 30 (informativo)
"""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

DROPBOX_BACKUP_FOLDER = "/Cehta Capital/99-Backups"


def parse_database_url(url: str) -> dict[str, str]:
    """Parsea DATABASE_URL postgresql://user:pass@host:port/db a dict de args
    para pg_dump (no soporta async drivers en URL).
    """
    # Remover prefix +asyncpg si existe
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)

    from urllib.parse import urlparse

    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "database": (parsed.path or "/postgres").lstrip("/"),
    }


def run_pg_dump(
    *,
    host: str,
    port: str,
    user: str,
    password: str,
    database: str,
    output_path: Path,
) -> None:
    """Ejecuta pg_dump con custom format compressed."""
    env = os.environ.copy()
    env["PGPASSWORD"] = password

    cmd = [
        "pg_dump",
        f"--host={host}",
        f"--port={port}",
        f"--username={user}",
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-acl",
        f"--file={output_path}",
        database,
    ]
    log.info("backup.pg_dump.start", db=database, output=str(output_path))
    result = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"pg_dump failed (exit {result.returncode}): {result.stderr}"
        )
    size = output_path.stat().st_size
    log.info("backup.pg_dump.ok", size_bytes=size, mb=round(size / 1024 / 1024, 2))


def upload_to_dropbox(local_path: Path, remote_filename: str) -> str:
    """Sube el dump a Dropbox /99-Backups/. Devuelve el path remoto."""
    from app.services.dropbox_service import DropboxService

    dbx = DropboxService()
    dbx.ensure_folder_path(DROPBOX_BACKUP_FOLDER)

    with local_path.open("rb") as f:
        content = f.read()

    remote_path = f"{DROPBOX_BACKUP_FOLDER}/{remote_filename}"
    dbx.upload_file(remote_path, content, overwrite=True)
    log.info(
        "backup.dropbox.upload_ok",
        remote=remote_path,
        size_bytes=len(content),
    )
    return remote_path


def main() -> int:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        log.error("backup.no_database_url")
        return 1

    db_args = parse_database_url(db_url)
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d_%H%M%S")
    filename = f"cehta-backup-{timestamp}.dump"

    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / filename
        try:
            run_pg_dump(output_path=output, **db_args)
        except Exception as exc:
            log.exception("backup.pg_dump.failed", error=str(exc))
            print(json.dumps({"status": "failed", "stage": "pg_dump", "error": str(exc)}))
            return 1

        try:
            remote = upload_to_dropbox(output, filename)
        except Exception as exc:
            log.exception("backup.upload.failed", error=str(exc))
            print(json.dumps({
                "status": "failed",
                "stage": "upload",
                "error": str(exc),
                "local_size": output.stat().st_size,
            }))
            return 1

    print(json.dumps({
        "status": "ok",
        "filename": filename,
        "remote_path": remote,
        "size_bytes": output.stat().st_size if output.exists() else 0,
    }, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
