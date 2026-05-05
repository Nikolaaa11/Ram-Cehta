"""Servicio importador del Plan de Cuentas v2.

Lógica reutilizable extraída de `scripts/import_plan_cuentas.py` para
poder invocarse desde:
  1. CLI (`python -m scripts.import_plan_cuentas --apply`)
  2. Endpoint admin `POST /api/v1/admin/plan-cuentas/import` (multipart)

La lógica es la misma: leer .xlsx → parsear → UPSERT en DB. Idempotente.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from io import BytesIO
from pathlib import Path
from typing import Any

import openpyxl
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Empresas del Excel (orden importa para iterar las columnas Hab_X)
EMPRESAS_EXCEL = ["CSL", "RHO", "DTE", "RVT", "EVQ", "TRK", "AFIS", "FIP"]

# Mapeo de prefijo de empresa a código real en core.empresas.codigo
EMPRESA_CODE_MAP = {
    "CSL": "CSL",
    "RHO": "RHO",
    "DTE": "DTE",
    "RVT": "REVTECH",
    "EVQ": "EVOQUE",
    "TRK": "TRONGKAI",
    "AFIS": "AFIS",
    "FIP": "FIP_CEHTA",
}

# CENERGY replica las habilitaciones de la empresa fuente.
# Acordado con COO: CENERGY es servicios, idéntico giro a DTE.
CENERGY_REPLICA_FROM = "DTE"


# ---------------------------------------------------------------------
# Parsers de tipos del Excel
# ---------------------------------------------------------------------


def _bool_x(value: Any) -> bool:
    """Excel marca true como 'x', false como None/empty."""
    if value is None:
        return False
    s = str(value).strip().lower()
    return s in ("x", "1", "true", "si", "sí")


def _bool_excel(value: Any) -> bool:
    """Para columnas TRUE/FALSE explícitas (Activa, Hab_X)."""
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    return s in ("true", "1", "si", "sí", "x")


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------
# Parsing del .xlsx
# ---------------------------------------------------------------------


class PlanCuentasParseError(ValueError):
    """Excel no tiene la estructura esperada."""


def parse_xlsx_bytes(
    xlsx_bytes: bytes,
) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    """Parsea el .xlsx desde bytes (uso desde upload).

    Devuelve:
      cuentas: lista de dicts listos para INSERT en core.plan_cuentas
      habilitaciones: dict empresa_codigo → set(cuenta_codigo) habilitados

    Lanza PlanCuentasParseError si la estructura del Excel no es la esperada.
    """
    return _parse_workbook(openpyxl.load_workbook(BytesIO(xlsx_bytes), read_only=True, data_only=True))


def parse_xlsx_path(
    xlsx_path: Path,
) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    """Parsea desde una ruta del filesystem (uso desde CLI)."""
    return _parse_workbook(openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True))


def _parse_workbook(wb: Any) -> tuple[list[dict[str, Any]], dict[str, set[str]]]:
    if "PlanDeCuentas" not in wb.sheetnames:
        raise PlanCuentasParseError(
            f"El Excel no tiene hoja 'PlanDeCuentas'. Hojas: {wb.sheetnames}"
        )
    ws = wb["PlanDeCuentas"]

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise PlanCuentasParseError("Hoja PlanDeCuentas vacía")

    header = [str(c).strip() if c else "" for c in rows[0]]
    expected = [
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
    missing = [c for c in expected if c not in header]
    if missing:
        raise PlanCuentasParseError(f"Columnas faltantes en Excel: {missing}")

    idx = {col: header.index(col) for col in expected}

    cuentas: list[dict[str, Any]] = []
    habilitaciones: dict[str, set[str]] = defaultdict(set)

    for row in rows[1:]:
        if not row or row[0] is None:
            continue
        codigo = str(row[idx["Cuenta"]]).strip()
        if not codigo:
            continue

        nivel = int(row[idx["Nivel"]])
        tipo = str(row[idx["Tipo"]]).strip()

        cuenta = {
            "codigo": codigo,
            "nivel": nivel,
            "tipo": tipo,
            "nombre": str(row[idx["Descripcion"]]).strip(),
            "descripcion": None,
            "codigo_padre": _str_or_none(row[idx["CuentaPadre"]]),
            "imputable": _bool_excel(row[idx["Imputable"]]),
            "iva_tratamiento": _str_or_none(row[idx["IvaTratamiento"]]) or "NA",
            "corfo_elegible": _bool_excel(row[idx["CorfoElegible"]]),
            "tipo_gasto_corfo": _str_or_none(row[idx["TipoGastoCorfo"]]),
            "nubox_code": _str_or_none(row[idx["NuboxCode"]]) or codigo,
            "codigo_f22": _int_or_none(row[idx["CodigoF22"]]),
            "ajuste_14d": _str_or_none(row[idx["Ajuste14D"]]),
            "flag_partida": _bool_x(row[idx["FlagPartida"]]),
            "flag_concepto": _bool_x(row[idx["FlagConcepto"]]),
            "flag_capital": _bool_x(row[idx["FlagCapital"]]),
            "flag_activo_fijo": _bool_x(row[idx["FlagActivoFijo"]]),
            "flag_documento": _bool_x(row[idx["FlagDocumento"]]),
            "flag_control_gestion": _bool_x(row[idx["FlagControlGestion"]]),
            "flag_activo_neto": _bool_x(row[idx["FlagActivoNeto"]]),
            "flag_caja": _bool_x(row[idx["FlagCaja"]]),
            "flag_marca_14d": _bool_x(row[idx["Flag14D"]]),
            "flag_percepcion": _bool_x(row[idx["FlagPercepcion"]]),
            "activa": _bool_excel(row[idx["Activa"]]),
        }
        cuentas.append(cuenta)

        for empresa_excel in EMPRESAS_EXCEL:
            col = f"Hab_{empresa_excel}"
            if _bool_excel(row[idx[col]]):
                empresa_codigo = EMPRESA_CODE_MAP[empresa_excel]
                habilitaciones[empresa_codigo].add(codigo)

    fuente_codigo = EMPRESA_CODE_MAP[CENERGY_REPLICA_FROM]
    if fuente_codigo in habilitaciones:
        habilitaciones["CENERGY"] = set(habilitaciones[fuente_codigo])

    return cuentas, dict(habilitaciones)


# ---------------------------------------------------------------------
# Apply a DB (idempotente)
# ---------------------------------------------------------------------


async def apply_to_db(
    db: AsyncSession,
    cuentas: list[dict[str, Any]],
    habilitaciones: dict[str, set[str]],
) -> dict[str, int]:
    """UPSERT atómico de las cuentas + habilitaciones. Caller hace commit."""
    counters = {
        "cuentas_upserted": 0,
        "habilitaciones_upserted": 0,
        "habilitaciones_omitidas_empresa_inexistente": 0,
    }

    empresas_db = (
        (
            await db.execute(
                text("SELECT codigo FROM core.empresas WHERE activo = TRUE")
            )
        )
        .scalars()
        .all()
    )
    empresas_db_set = set(empresas_db)

    cuentas_ordenadas = sorted(cuentas, key=lambda c: (c["nivel"], c["codigo"]))

    for c in cuentas_ordenadas:
        await db.execute(
            text(
                """
                INSERT INTO core.plan_cuentas (
                    codigo, nivel, tipo, nombre, descripcion, codigo_padre,
                    imputable, iva_tratamiento,
                    corfo_elegible, tipo_gasto_corfo, nubox_code,
                    codigo_f22, ajuste_14d,
                    flag_partida, flag_concepto, flag_capital,
                    flag_activo_fijo, flag_documento, flag_control_gestion,
                    flag_activo_neto, flag_caja, flag_marca_14d,
                    flag_percepcion, activa
                )
                VALUES (
                    :codigo, :nivel, :tipo, :nombre, :descripcion, :codigo_padre,
                    :imputable, :iva_tratamiento,
                    :corfo_elegible, :tipo_gasto_corfo, :nubox_code,
                    :codigo_f22, :ajuste_14d,
                    :flag_partida, :flag_concepto, :flag_capital,
                    :flag_activo_fijo, :flag_documento, :flag_control_gestion,
                    :flag_activo_neto, :flag_caja, :flag_marca_14d,
                    :flag_percepcion, :activa
                )
                ON CONFLICT (codigo) DO UPDATE SET
                    nivel = EXCLUDED.nivel,
                    tipo = EXCLUDED.tipo,
                    nombre = EXCLUDED.nombre,
                    descripcion = EXCLUDED.descripcion,
                    codigo_padre = EXCLUDED.codigo_padre,
                    imputable = EXCLUDED.imputable,
                    iva_tratamiento = EXCLUDED.iva_tratamiento,
                    corfo_elegible = EXCLUDED.corfo_elegible,
                    tipo_gasto_corfo = EXCLUDED.tipo_gasto_corfo,
                    nubox_code = EXCLUDED.nubox_code,
                    codigo_f22 = EXCLUDED.codigo_f22,
                    ajuste_14d = EXCLUDED.ajuste_14d,
                    flag_partida = EXCLUDED.flag_partida,
                    flag_concepto = EXCLUDED.flag_concepto,
                    flag_capital = EXCLUDED.flag_capital,
                    flag_activo_fijo = EXCLUDED.flag_activo_fijo,
                    flag_documento = EXCLUDED.flag_documento,
                    flag_control_gestion = EXCLUDED.flag_control_gestion,
                    flag_activo_neto = EXCLUDED.flag_activo_neto,
                    flag_caja = EXCLUDED.flag_caja,
                    flag_marca_14d = EXCLUDED.flag_marca_14d,
                    flag_percepcion = EXCLUDED.flag_percepcion,
                    activa = EXCLUDED.activa,
                    updated_at = now()
                """
            ),
            c,
        )
        counters["cuentas_upserted"] += 1

    for empresa_codigo, codigos_cuenta in habilitaciones.items():
        if empresa_codigo not in empresas_db_set:
            counters["habilitaciones_omitidas_empresa_inexistente"] += len(
                codigos_cuenta
            )
            continue
        for cuenta_codigo in codigos_cuenta:
            await db.execute(
                text(
                    """
                    INSERT INTO core.plan_cuenta_empresa (
                        cuenta_codigo, empresa_codigo, habilitada
                    )
                    VALUES (:cc, :ec, TRUE)
                    ON CONFLICT (cuenta_codigo, empresa_codigo) DO UPDATE
                        SET habilitada = TRUE,
                            habilitada_en = now()
                    """
                ),
                {"cc": cuenta_codigo, "ec": empresa_codigo},
            )
            counters["habilitaciones_upserted"] += 1

    return counters


# ---------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------


def build_summary(
    cuentas: list[dict[str, Any]],
    habilitaciones: dict[str, set[str]],
) -> dict[str, Any]:
    """Devuelve el resumen de import en formato JSON-friendly."""
    by_nivel = Counter(c["nivel"] for c in cuentas)
    by_tipo = Counter(c["tipo"] for c in cuentas)
    by_corfo_tipo = Counter(
        c["tipo_gasto_corfo"] for c in cuentas if c["corfo_elegible"]
    )

    return {
        "total_cuentas": len(cuentas),
        "por_nivel": dict(sorted(by_nivel.items())),
        "por_tipo": dict(sorted(by_tipo.items())),
        "imputables": sum(1 for c in cuentas if c["imputable"]),
        "corfo_elegibles": sum(1 for c in cuentas if c["corfo_elegible"]),
        "por_tipo_gasto_corfo": {
            str(k): v for k, v in sorted(by_corfo_tipo.items(), key=lambda x: str(x[0]))
        },
        "con_codigo_f22": sum(1 for c in cuentas if c["codigo_f22"] is not None),
        "habilitaciones_por_empresa": {
            empresa: len(codigos)
            for empresa, codigos in sorted(habilitaciones.items())
        },
    }
