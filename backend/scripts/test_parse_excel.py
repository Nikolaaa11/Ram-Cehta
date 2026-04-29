"""Test parsing del Excel madre con el ETL service.

Uso:
    python -m scripts.test_parse_excel "C:/path/to/Data Madre.xlsx"

Reporta cuántas filas raw se parsearon, cuántas serían validadas (asumiendo
todas las empresas existen en core.empresas), y las primeras 3 filas como
muestra. NO escribe a DB.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

from app.services.etl_service import (
    EMPRESA_NAME_MAP,
    _validate_and_transform_row,
    normalize_empresa_codigo,
    parse_resumen_sheet,
)


def main(path: Path) -> None:
    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if not path.exists():
        print(f"[ERROR] Archivo no encontrado: {path}")
        sys.exit(1)

    content = path.read_bytes()
    print(f"[FILE] {path.name} ({len(content) / 1024:.1f} KB)")

    raw_rows, parse_rejected = parse_resumen_sheet(content)
    print(f"[PARSE] raw_rows={len(raw_rows)} rejected_at_parse={len(parse_rejected)}")

    if parse_rejected:
        print("\n[PARSE REJECTED] muestras (max 5):")
        for r in parse_rejected[:5]:
            print(f"  fila {r.source_row_num}: {r.reason}")

    # Conteo de empresas detectadas (raw, antes de normalizar)
    empresas_raw = Counter(r.data.get("empresa") for r in raw_rows)
    print(f"\n[EMPRESAS RAW] detectadas en {len(raw_rows)} filas:")
    for emp, count in empresas_raw.most_common(15):
        normalized = normalize_empresa_codigo(emp) if emp else None
        print(f"  {emp!r:30} -> {normalized!r:15} ({count} filas)")

    # Simulamos validación contra TODAS las empresas conocidas (las del seed +
    # las normalizadas del Excel — para ver qué filas pasarían)
    seed_empresas = {
        "TRONGKAI", "REVTECH", "EVOQUE", "DTE", "CSL", "RHO",
        "AFIS", "FIP_CEHTA", "CENERGY",
    }

    validated = 0
    rejection_reasons: Counter[str] = Counter()
    sample_validated = []
    sample_rejected = []

    for raw in raw_rows:
        row, rej = _validate_and_transform_row(raw, seed_empresas)
        if row is not None:
            validated += 1
            if len(sample_validated) < 3:
                sample_validated.append({
                    "empresa": row["empresa_codigo"],
                    "fecha": str(row["fecha"]),
                    "descripcion": (row.get("descripcion") or "")[:60],
                    "abono": str(row["abono"]),
                    "egreso": str(row["egreso"]),
                    "concepto": row.get("concepto_general"),
                    "proyecto": row.get("proyecto"),
                })
        else:
            assert rej is not None
            # Truncate reason to first 80 chars for grouping
            reason_key = rej.reason[:80]
            rejection_reasons[reason_key] += 1
            if len(sample_rejected) < 5:
                sample_rejected.append({
                    "row": rej.source_row_num,
                    "reason": rej.reason,
                    "empresa": rej.raw_data.get("empresa"),
                    "fecha": rej.raw_data.get("fecha"),
                    "periodo": rej.raw_data.get("periodo"),
                    "anio": rej.raw_data.get("anio"),
                })

    print(f"\n[VALIDATION] (asumiendo seed empresas conocidas):")
    print(f"  validated: {validated} / {len(raw_rows)}")
    print(f"\n[REJECTION REASONS]:")
    for reason, count in rejection_reasons.most_common(10):
        print(f"  {count:5} × {reason}")

    if sample_rejected:
        print(f"\n[SAMPLE REJECTED ROWS]:")
        import json
        for r in sample_rejected:
            print(f"  fila {r['row']}: empresa={r['empresa']!r} fecha={r['fecha']!r} periodo={r['periodo']!r} anio={r['anio']!r}")
            print(f"     reason: {r['reason']}")

    if sample_validated:
        print(f"\n[SAMPLE VALIDATED ROWS]")
        import json
        for row in sample_validated:
            print(f"  {json.dumps(row, ensure_ascii=False)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python -m scripts.test_parse_excel <path>")
        sys.exit(1)
    main(Path(sys.argv[1]))
