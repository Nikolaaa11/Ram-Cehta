"""F22 Dropbox sync — lógica compartida entre /f22/sync-dropbox y /empresa/{cod}/sync-all-dropbox.

Single source of truth para el matching de filename y la inserción
idempotente en `core.f22_obligaciones`. Cualquier cambio (regex, naming
convention) se hace acá y ambos endpoints lo heredan automáticamente.
"""
from __future__ import annotations

import re
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Patrón estricto: requiere que el filename empiece con el año
# (`2025.pdf`, `2025_v2.pdf`) o sea `F22_2025.pdf` / `F22-2025.pdf`.
# Evita falsos positivos como `Borrador_2025_v2024.pdf`.
_F22_FILENAME_RE = re.compile(
    r"^(?:F22[_\- ]?)?(20\d{2})(?:[_\- .].*)?\.pdf$",
    re.IGNORECASE,
)


async def sync_f22_dropbox(
    db: AsyncSession,
    dbx: object,  # DropboxService — type-hint loose para evitar import circular
    empresa_codigo: str,
) -> dict:
    """Escanea el folder F22 de la empresa y crea las filas faltantes.

    Devuelve `{created, skipped, errors}`. Idempotente: el UNIQUE
    (empresa, año) + ON CONFLICT DO NOTHING evita duplicados al re-correr.

    Convención de filename:
      - `{YYYY}.pdf`           — recomendado
      - `F22_{YYYY}.pdf`       — alternativa con prefijo
      - `F22-{YYYY}.pdf`
      - `{YYYY}_v2.pdf`        — versiones también OK
    Filenames sin patrón válido se cuentan como skipped.

    Vencimiento default: abril 30 del año siguiente al período tributario.
    """
    root = (
        f"/Cehta Capital/01-Empresas/{empresa_codigo}"
        f"/03-Legal/Declaraciones SII/F22"
    )
    try:
        items = dbx.list_folder(root)  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        return {
            "created": 0,
            "skipped": 0,
            "errors": [f"Listar {root}: {exc}"],
        }

    # Pre-cargar años existentes para evitar N queries
    existing_rows = (
        await db.execute(
            text(
                "SELECT ano_tributario FROM core.f22_obligaciones "
                "WHERE empresa_codigo = :e"
            ),
            {"e": empresa_codigo},
        )
    ).fetchall()
    existing: set[int] = {int(r[0]) for r in existing_rows}

    created = skipped = 0
    errors: list[str] = []

    for it in items:
        if it.get("type") != "file":
            continue
        name = it.get("name") or ""
        m = _F22_FILENAME_RE.match(name)
        if not m:
            skipped += 1
            continue
        ano = int(m.group(1))
        if ano in existing:
            skipped += 1
            continue

        try:
            await db.execute(
                text("""
                    INSERT INTO core.f22_obligaciones (
                        empresa_codigo, ano_tributario, fecha_vencimiento,
                        estado, dropbox_path
                    )
                    VALUES (:e, :a, :fv, 'pendiente', :p)
                    ON CONFLICT (empresa_codigo, ano_tributario) DO NOTHING
                """),
                {
                    "e": empresa_codigo,
                    "a": ano,
                    "fv": date(ano + 1, 4, 30),
                    "p": it.get("path"),
                },
            )
            created += 1
            existing.add(ano)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"INSERT año {ano}: {exc}")

    await db.commit()
    return {"created": created, "skipped": skipped, "errors": errors}
