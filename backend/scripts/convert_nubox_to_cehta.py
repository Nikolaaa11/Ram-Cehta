"""Convierte un Excel Nubox IFRS (.xls) al formato que espera el importer
del plan de cuentas de Cehta (.xlsx con columnas Hab_X por empresa).

Uso:
    python scripts/convert_nubox_to_cehta.py <ruta_in.xls> <ruta_out.xlsx>

El Excel Nubox tiene 4 columnas relevantes (Codigo, Tipo, Descripcion,
Atributos). Esta utilidad:
  - Mapea Tipo Nubox -> nivel + tipo contable Cehta:
      GRUPO=nivel 1, SUBGRUPO=nivel 2, MAYOR=nivel 3, SUBCUENTA=nivel 4
      Codigo "1"=ACTIVO, "2x"=PASIVO (salvo "23"=PATRIMONIO),
      "4"=GASTO, "5"=INGRESO
  - Deriva codigo_padre del propio codigo (ej "1101-01" -> "1101"; "1101"
    -> "11"; "11" -> "1"; "1" -> None).
  - Solo las SUBCUENTAS son imputables.
  - Habilita la cuenta para TODAS las empresas configuradas (objetivo del
    usuario: "este es para todas las empresas").
"""
from __future__ import annotations

import sys
from pathlib import Path

import openpyxl
import xlrd

# Las 8 empresas del Excel Cehta. CENERGY se hereda de DTE en el importer.
EMPRESAS_EXCEL = ["CSL", "RHO", "DTE", "RVT", "EVQ", "TRK", "AFIS", "FIP"]


def _codigo_padre(codigo: str) -> str | None:
    """Deriva el padre del codigo del plan Nubox.

    Reglas:
      - "1101-01" (subcuenta nivel 4) -> "1101" (mayor)
      - "1101"    (mayor nivel 3)     -> "11"   (subgrupo)
      - "11"      (subgrupo nivel 2)  -> "1"    (grupo)
      - "1"       (grupo nivel 1)     -> None
    """
    if "-" in codigo:
        return codigo.split("-", 1)[0]
    if len(codigo) == 4:  # MAYOR como "1101"
        return codigo[:2]
    if len(codigo) == 2:  # SUBGRUPO como "11"
        return codigo[0]
    return None


def _tipo_contable(codigo: str) -> str:
    """Mapea el primer dígito del código Nubox al tipo contable Cehta.

    Casos especiales: "23" (subgrupo PATRIMONIO) y sus descendientes son
    PATRIMONIO, no PASIVO. Se detecta porque el codigo empieza con "23".
    """
    if codigo.startswith("23"):
        return "PATRIMONIO"
    primero = codigo[0]
    return {
        "1": "ACTIVO",
        "2": "PASIVO",
        "4": "GASTO",
        "5": "INGRESO",
    }.get(primero, "RESULTADO")


def _nivel_from_tipo_nubox(tipo_nubox: str) -> int:
    return {
        "GRUPO": 1,
        "SUBGRUPO": 2,
        "MAYOR": 3,
        "SUBCUENTA": 4,
    }.get(tipo_nubox, 4)


def _bool_si_no(s: str) -> bool:
    return str(s).strip().upper() == "SI"


# Columnas en el order exacto que espera plan_cuentas_import_service._parse_plan_cuentas
HEADERS = [
    "Cuenta", "Nivel", "Tipo", "Descripcion", "CuentaPadre",
    "Imputable", "IvaTratamiento", "CorfoElegible", "TipoGastoCorfo",
    "NuboxCode", "CodigoF22", "Ajuste14D",
    "FlagPartida", "FlagConcepto", "FlagCapital", "FlagActivoFijo",
    "FlagDocumento", "FlagControlGestion", "FlagActivoNeto", "FlagCaja",
    "Flag14D", "FlagPercepcion",
    "Activa",
    "Hab_CSL", "Hab_RHO", "Hab_DTE", "Hab_RVT",
    "Hab_EVQ", "Hab_TRK", "Hab_AFIS", "Hab_FIP",
]


def convert(in_path: Path, out_path: Path) -> dict[str, int]:
    """Convierte el .xls Nubox al .xlsx Cehta. Devuelve conteos para sanity check."""
    wb_in = xlrd.open_workbook(str(in_path))
    sheet_name = "rpt_PlanDeCuentasExtendido"
    if sheet_name not in wb_in.sheet_names():
        raise SystemExit(
            f"ERROR: hoja '{sheet_name}' no existe. Hojas: {wb_in.sheet_names()}"
        )
    sh = wb_in.sheet_by_name(sheet_name)

    wb_out = openpyxl.Workbook()
    ws_out = wb_out.active
    if ws_out is None:
        raise SystemExit("No se pudo crear hoja activa")
    ws_out.title = "PlanDeCuentas"
    ws_out.append(HEADERS)

    counts = {"GRUPO": 0, "SUBGRUPO": 0, "MAYOR": 0, "SUBCUENTA": 0}

    for r in range(1, sh.nrows):  # skip header row
        codigo = str(sh.cell_value(r, 0)).strip()
        tipo_nubox = str(sh.cell_value(r, 1)).strip().upper()
        descripcion_raw = str(sh.cell_value(r, 2)).strip()
        # Fix encoding (xlrd devuelve algunas tildes como ?)
        descripcion = descripcion_raw.replace("�", "")
        atributo_bancario = str(sh.cell_value(r, 3)).strip()  # SI/NO

        if not codigo:
            continue

        nivel = _nivel_from_tipo_nubox(tipo_nubox)
        tipo = _tipo_contable(codigo)
        imputable = (tipo_nubox == "SUBCUENTA")  # solo nivel 4
        codigo_padre = _codigo_padre(codigo)

        # Si es cuenta bancaria, marcar flag_caja (para conciliación).
        flag_caja = _bool_si_no(atributo_bancario) and imputable

        row = [
            codigo,            # Cuenta
            nivel,             # Nivel
            tipo,              # Tipo
            descripcion,       # Descripcion
            codigo_padre or "",  # CuentaPadre
            "TRUE" if imputable else "FALSE",  # Imputable
            "NA",              # IvaTratamiento (default; CO o COMPRA si tiene IVA)
            "FALSE",           # CorfoElegible (FE marca después)
            "",                # TipoGastoCorfo
            codigo,            # NuboxCode (es la plantilla Nubox, identidad)
            "",                # CodigoF22
            "",                # Ajuste14D
            "",                # FlagPartida
            "",                # FlagConcepto
            "",                # FlagCapital
            "",                # FlagActivoFijo
            "",                # FlagDocumento
            "",                # FlagControlGestion
            "",                # FlagActivoNeto
            "x" if flag_caja else "",  # FlagCaja
            "",                # Flag14D
            "",                # FlagPercepcion
            "TRUE",            # Activa
        ]
        # Hab_X = TRUE para todas las empresas (el usuario pidió "para todas")
        row.extend(["TRUE"] * len(EMPRESAS_EXCEL))

        ws_out.append(row)
        counts[tipo_nubox] = counts.get(tipo_nubox, 0) + 1

    # Hoja Areas vacía con header válido (opcional para el importer).
    # No la generamos para no sobreescribir las áreas seed de la 0034.

    wb_out.save(str(out_path))
    return counts


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 1
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    if not in_path.exists():
        print(f"ERROR: no existe {in_path}", file=sys.stderr)
        return 1
    counts = convert(in_path, out_path)
    print(f"OK: {out_path}")
    print(f"Total cuentas convertidas: {sum(counts.values())}")
    for tipo, n in counts.items():
        print(f"  {tipo}: {n}")
    print(f"\nTodas las cuentas habilitadas para: {EMPRESAS_EXCEL}")
    print("CENERGY hereda automaticamente las habilitaciones de DTE (logica del importer)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
