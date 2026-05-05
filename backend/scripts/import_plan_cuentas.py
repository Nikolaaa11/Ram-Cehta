"""CLI del importador del Plan de Cuentas v2.

Wrapper delgado sobre `app.services.plan_cuentas_import_service`.
La lógica real vive ahí — este script solo cubre el caso CLI / cron.
El endpoint admin `POST /admin/plan-cuentas/import` (subir .xlsx desde
el dashboard) usa el mismo service.

Uso:

    # Dry-run — no toca DB, solo imprime resumen
    python -m scripts.import_plan_cuentas

    # Apply — escribe a la DB
    python -m scripts.import_plan_cuentas --apply

    # Excel en otra ruta
    python -m scripts.import_plan_cuentas --xlsx /ruta/al.xlsx --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.core.database import SessionLocal
from app.services.plan_cuentas_import_service import (
    PlanCuentasParseError,
    apply_to_db,
    build_summary,
    parse_xlsx_path,
)


async def _run_apply(payload) -> dict[str, int]:  # type: ignore[no-untyped-def]
    async with SessionLocal() as db:
        counters = await apply_to_db(db, payload)
        await db.commit()
    return counters


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Importer del Plan de Cuentas v2 (cuentas + proyectos + áreas)"
    )
    default_xlsx = Path.home() / "Downloads" / "Plan_de_cuentas_v2.xlsx"
    parser.add_argument("--xlsx", type=Path, default=default_xlsx)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.xlsx.exists():
        print(f"ERROR: no se encuentra {args.xlsx}", file=sys.stderr)
        return 1

    print(f"Leyendo {args.xlsx}...")
    try:
        payload = parse_xlsx_path(args.xlsx)
    except PlanCuentasParseError as exc:
        print(f"ERROR de parseo: {exc}", file=sys.stderr)
        return 1

    summary = build_summary(payload)
    print(json.dumps(summary, indent=2, ensure_ascii=False, default=str))

    if not args.apply:
        print("\nModo DRY-RUN. Para aplicar: agregar --apply")
        return 0

    print(
        f"\nAplicando a la DB "
        f"({len(payload.cuentas)} cuentas + {len(payload.proyectos)} proyectos "
        f"+ {len(payload.areas)} áreas)..."
    )
    counters = asyncio.run(_run_apply(payload))
    print(json.dumps(counters, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
