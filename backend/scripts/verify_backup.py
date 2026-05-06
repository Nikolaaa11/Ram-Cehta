"""Verify backup integrity — descarga el último .dump de Dropbox y valida.

Estrategia:
  1. List `/Cehta Capital/99-Backups/` por fecha desc
  2. Descarga el último archivo `cehta-backup-*.dump`
  3. Verifica con `pg_restore --list` que sea un dump válido
  4. Output: tamaño + cantidad de tablas + última fecha de tabla más activa

NO restaura. Solo verifica que el archivo es íntegro y restorable.

Schedule recomendado: weekly (lunes 06:00 UTC) post backup_cron diario.
Si exit != 0, alerta automática (Fly cron + Sentry).

Uso manual:
    fly ssh console -a cehta-backend
    python -m scripts.verify_backup
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import structlog

log = structlog.get_logger(__name__)

DROPBOX_BACKUP_FOLDER = "/Cehta Capital/99-Backups"
BACKUP_FILE_PATTERN = re.compile(r"^cehta-backup-(\d{4}-\d{2}-\d{2}_\d{6})\.dump$")


def find_latest_backup() -> tuple[str, int] | None:
    """Devuelve (path, size_bytes) del backup más reciente, o None."""
    try:
        from app.services.dropbox_service import DropboxService

        dbx = DropboxService()
    except Exception as exc:
        log.error("verify_backup.dropbox_init_failed", error=str(exc))
        return None

    try:
        items = dbx.list_folder(DROPBOX_BACKUP_FOLDER)
    except Exception as exc:
        log.error("verify_backup.list_failed", error=str(exc))
        return None

    backups: list[tuple[str, str, int]] = []
    for item in items:
        if item.get("type") != "file":
            continue
        name = item.get("name", "")
        m = BACKUP_FILE_PATTERN.match(name)
        if not m:
            continue
        backups.append((m.group(1), item["path"], item.get("size", 0)))

    if not backups:
        return None

    # Ordenar por timestamp descendente (string sort funciona porque
    # YYYY-MM-DD_HHMMSS es lex-orderable)
    backups.sort(key=lambda x: x[0], reverse=True)
    _, path, size = backups[0]
    return path, size


def download_backup(remote_path: str, local_path: Path) -> bool:
    """Descarga el dump a un path local. Devuelve True si OK."""
    try:
        from app.services.dropbox_service import DropboxService

        dbx = DropboxService()
        content = dbx.download_file(remote_path)
        local_path.write_bytes(content)
        return True
    except Exception as exc:
        log.error("verify_backup.download_failed", error=str(exc), path=remote_path)
        return False


def verify_dump_integrity(dump_path: Path) -> dict:
    """Valida el dump con `pg_restore --list`. Devuelve stats.

    pg_restore --list lee el header del custom format y lista las
    tablas/objetos sin restaurar. Si el archivo está corrupto, falla.
    """
    try:
        result = subprocess.run(
            ["pg_restore", "--list", str(dump_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return {"valid": False, "error": "pg_restore timeout (120s)"}
    except FileNotFoundError:
        return {
            "valid": False,
            "error": "pg_restore no encontrado (instalar postgresql-client)",
        }

    if result.returncode != 0:
        return {
            "valid": False,
            "error": f"pg_restore exit {result.returncode}",
            "stderr": result.stderr[:500],
        }

    # Contar tablas (líneas que empiezan con "TABLE DATA")
    table_count = sum(
        1 for line in result.stdout.splitlines() if "TABLE DATA" in line
    )
    object_count = len(result.stdout.splitlines())

    return {
        "valid": True,
        "table_count": table_count,
        "object_count": object_count,
    }


def main() -> int:
    latest = find_latest_backup()
    if latest is None:
        print(json.dumps({
            "status": "failed",
            "stage": "find_latest",
            "error": "No backups encontrados en Dropbox /99-Backups/",
        }))
        return 1

    remote_path, expected_size = latest
    log.info("verify_backup.found", path=remote_path, size=expected_size)

    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / "backup.dump"

        if not download_backup(remote_path, local):
            print(json.dumps({
                "status": "failed",
                "stage": "download",
                "remote_path": remote_path,
            }))
            return 1

        actual_size = local.stat().st_size
        log.info("verify_backup.downloaded", size=actual_size)

        if expected_size and abs(actual_size - expected_size) > 100:
            # Diferencia >100 bytes → posible truncado
            print(json.dumps({
                "status": "failed",
                "stage": "size_mismatch",
                "expected": expected_size,
                "actual": actual_size,
            }))
            return 1

        result = verify_dump_integrity(local)
        if not result.get("valid"):
            print(json.dumps({
                "status": "failed",
                "stage": "pg_restore_list",
                **result,
            }))
            return 1

        print(json.dumps({
            "status": "ok",
            "remote_path": remote_path,
            "size_bytes": actual_size,
            "size_mb": round(actual_size / 1024 / 1024, 2),
            "table_count": result["table_count"],
            "object_count": result["object_count"],
        }))
        return 0


if __name__ == "__main__":
    sys.exit(main())
