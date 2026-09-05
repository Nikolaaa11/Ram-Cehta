"""Importa el Excel "Registro de Egresos" de Claudia a `core.corfo_registro_egresos`.

Cuatro modos, según lo que se pase:

    # 1. Sólo mirar: parsea y resume. NO necesita base de datos.
    python scripts/importar_registro_egresos_excel.py --empresa REVTECH \
        --archivo "C:/Users/DELL/Downloads/CC Bancos_Revtech.xlsx" --dry-run

    #    Los Excel reales repiten filas idénticas que son pagos distintos
    #    (cuotas a co-ejecutores, peajes). Por contrato (§3.4) entran TODAS,
    #    cada una con huella propia y la repetida con una observación. Con
    #    --colapsar-repetidas sólo entra la primera (comportamiento viejo).
    #    --conservar-repetidas se acepta pero no hace nada: es el default.

    # 2. Parsear y dejar las filas en JSON (fechas ISO, plata como string).
    #    Tampoco toca la BD. Sirve para subir a Fly un JSON chico en vez del .xlsx.
    python scripts/importar_registro_egresos_excel.py --empresa TRONGKAI \
        --archivo "C:/Users/DELL/Downloads/Cuenta Bancos_trongkai.xlsx" --json-out trongkai.json

    # 3. Parsear y cargar de verdad (usa DATABASE_URL del entorno / .env).
    python scripts/importar_registro_egresos_excel.py --empresa REVTECH \
        --archivo ruta.xlsx --usuario nrietta@cehtacapital.com

    # 4. Cargar desde el JSON del modo 2 (en el servidor, sin releer el Excel).
    #    Con --dry-run consulta la BD sólo para decir cuántas ya existen.
    python scripts/importar_registro_egresos_excel.py --empresa TRONGKAI \
        --json-in trongkai.json --usuario nrietta@cehtacapital.com [--dry-run]

La carga es idempotente: correr dos veces el mismo archivo crea 0 filas y el
resumen dice cuántas ya existían. Las filas que el Excel trae descuadradas o
sin clasificar entran tal cual: la pantalla las marca, este script no las
"arregla".
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from app.services.corfo_egresos_import_service import (  # noqa: E402
    FilaEgreso,
    FilaSaltada,
    ResultadoParseo,
    ResumenCarga,
    cargar_filas,
    contar_reparto,
    empresas_corfo,
    parsear_registro_egresos,
)


def _plata(monto: Decimal) -> str:
    """Decimal → '$291.145.758' (pesos enteros, puntos de miles, HALF_UP)."""
    entero = int(monto.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return "$" + f"{entero:,}".replace(",", ".")


def _linea(titulo: str) -> None:
    print(f"\n{titulo}\n{'-' * len(titulo)}")


def _imprimir_resumen_parseo(res: ResultadoParseo, empresa: str, archivo: Path) -> None:
    filas = res.filas
    descuadradas, sin_clasificar = contar_reparto(filas)
    total = sum((f.total for f in filas), Decimal("0"))

    _linea(f"Registro de egresos · {empresa} · {archivo.name}")
    print(f"Columnas ({len(res.columnas)}): {', '.join(res.columnas)}")
    print(f"Filas con datos (leídas): {res.leidas}")
    print(f"  · a cargar:              {len(filas)}")
    print(f"  · saltadas:              {len(res.saltadas)}")
    # Las repetidas ya están dentro de "a cargar": se listan para que quien
    # importa sepa cuáles revisar, no porque cambien el total.
    print(f"  · repetidas (cargadas con observación): {len(res.repetidas_en_excel)}")
    if res.duplicadas_en_excel:
        print(f"  · colapsadas (--colapsar-repetidas): {len(res.duplicadas_en_excel)}")
    for s in res.saltadas:
        print(f"      fila {s.fila_excel}: {s.motivo}")
    if res.repetidas_en_excel:
        print(
            "      filas repetidas (n-ésima aparición de una fila idéntica, entran igual): "
            + ", ".join(str(n) for n in res.repetidas_en_excel)
        )
    if res.duplicadas_en_excel:
        print(
            "      filas colapsadas (no se cargan, sólo entra la primera): "
            + ", ".join(str(n) for n in res.duplicadas_en_excel)
        )

    _linea("Reparto (SEPARACIÓN VALORES)")
    print(f"Sin clasificar (4 fuentes vacías): {sin_clasificar}")
    print(f"Descuadradas (no suman el total):  {descuadradas}")
    print(f"OK:                                {len(filas) - sin_clasificar - descuadradas}")
    no_cuadra = [f for f in filas if not f.neto_mas_impuesto_cuadra]
    print(f"Neto + impuesto distinto del total: {len(no_cuadra)}")

    _linea("Estados de pago")
    estados = Counter(f.estado_pago for f in filas)
    print(" · ".join(f"{k}: {estados.get(k, 0)}" for k in ("PAGADO", "PARCIAL", "PENDIENTE")))

    _linea("Tipos de documento")
    for tipo, n in Counter(f.tipo_documento for f in filas).most_common():
        print(f"  {tipo:<18} {n}")

    _linea("Mes a mes")
    por_mes: dict[str, list[FilaEgreso]] = {}
    for f in filas:
        por_mes.setdefault(f.periodo, []).append(f)
    for periodo in sorted(por_mes):
        grupo = por_mes[periodo]
        print(
            f"  {periodo}  {len(grupo):>4} filas  "
            f"{_plata(sum((g.total for g in grupo), Decimal('0'))):>16}"
        )

    if filas:
        fechas = sorted(f.fecha for f in filas)
        print(f"\nRango: {fechas[0].isoformat()} → {fechas[-1].isoformat()}")
    print(f"TOTAL a cargar: {_plata(total)}")


def _imprimir_resumen_carga(r: ResumenCarga) -> None:
    modo = "DRY RUN (no se escribió nada)" if r.dry_run else "CARGA REAL"
    _linea(f"Carga · {r.empresa_codigo} · {modo}")
    print(f"Filas recibidas:       {r.leidas}")
    verbo = "se crearían" if r.dry_run else "creadas"
    print(f"{verbo.capitalize():<22} {r.creadas}")
    print(f"Ya existían (omitidas): {r.omitidas_existentes}")
    print(f"Descuadradas:          {r.descuadradas}")
    print(f"Sin clasificar:        {r.sin_clasificar}")


def _escribir_json(res: ResultadoParseo, empresa: str, archivo: Path, destino: Path) -> None:
    payload = {
        "empresa_codigo": empresa,
        "archivo": archivo.name,
        "generado": datetime.now(UTC).isoformat(timespec="seconds"),
        "columnas": res.columnas,
        "filas": [f.to_dict() for f in res.filas],
        "saltadas": [{"fila_excel": s.fila_excel, "motivo": s.motivo} for s in res.saltadas],
        "repetidas_en_excel": res.repetidas_en_excel,
        "duplicadas_en_excel": res.duplicadas_en_excel,
    }
    destino.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nJSON escrito: {destino} ({len(res.filas)} filas)")


def _leer_json(
    origen: Path,
) -> tuple[str, list[FilaEgreso], list[FilaSaltada], list[int], list[int]]:
    """→ (empresa, filas, saltadas, repetidas_en_excel, duplicadas_en_excel)."""
    payload = json.loads(origen.read_text(encoding="utf-8"))
    filas = [FilaEgreso.from_dict(d) for d in payload["filas"]]
    saltadas = [
        FilaSaltada(int(s["fila_excel"]), str(s["motivo"])) for s in payload.get("saltadas", [])
    ]
    return (
        str(payload["empresa_codigo"]).strip().upper(),
        filas,
        saltadas,
        [int(n) for n in payload.get("repetidas_en_excel", [])],
        [int(n) for n in payload.get("duplicadas_en_excel", [])],
    )


async def _cargar(
    empresa: str, filas: list[FilaEgreso], usuario: str, dry_run: bool
) -> ResumenCarga:
    # Import acá y no arriba: `app.core.database` crea el engine con
    # DATABASE_URL, y los modos sin BD (--dry-run sobre .xlsx, --json-out)
    # tienen que funcionar en una máquina sin .env.
    from app.core.database import SessionLocal

    async with SessionLocal() as db:
        return await cargar_filas(db, empresa, filas, usuario, dry_run=dry_run)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Importa el Excel 'Registro de Egresos' de Claudia (CORFO) a la plataforma.",
    )
    p.add_argument("--empresa", required=True, help="REVTECH o TRONGKAI")
    fuente = p.add_mutually_exclusive_group(required=True)
    fuente.add_argument("--archivo", type=Path, help="Ruta al .xlsx de Claudia")
    fuente.add_argument("--json-in", type=Path, help="JSON generado con --json-out")
    p.add_argument("--dry-run", action="store_true", help="No escribe en la BD")
    p.add_argument("--usuario", help="Email de quien importa (created_by). Obligatorio para cargar")
    p.add_argument("--json-out", type=Path, help="Escribe las filas parseadas a este JSON")
    p.add_argument(
        "--colapsar-repetidas",
        action="store_true",
        help=(
            "Comportamiento viejo: de las filas idénticas del mismo archivo sólo entra "
            "la primera; las demás se reportan como duplicadas y NO se cargan. Por "
            "defecto entran todas (son pagos distintos: cuotas a co-ejecutores, peajes), "
            "cada una con huella propia y una observación."
        ),
    )
    # Se acepta para no romper comandos guardados: hoy es el default.
    p.add_argument("--conservar-repetidas", action="store_true", help=argparse.SUPPRESS)
    return p


def main(argv: list[str] | None = None) -> int:
    # Windows con cp1252 se ahoga con "✓" y acentos en la consola.
    with contextlib.suppress(AttributeError, ValueError):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]

    args = _parser().parse_args(argv)
    empresa = args.empresa.strip().upper()
    if empresa not in empresas_corfo():
        print(f"ERROR: --empresa tiene que ser REVTECH o TRONGKAI (llegó {args.empresa!r})")
        return 1
    if args.json_out and not args.archivo:
        print("ERROR: --json-out sólo tiene sentido con --archivo")
        return 1

    # ── Modo Excel ────────────────────────────────────────────────
    if args.archivo:
        if not args.archivo.is_file():
            print(f"ERROR: no existe {args.archivo}")
            return 1
        try:
            res = parsear_registro_egresos(
                args.archivo.read_bytes(), empresa, conservar_repetidas=not args.colapsar_repetidas
            )
        except ValueError as exc:
            print(f"ERROR: {exc}")
            return 1
        _imprimir_resumen_parseo(res, empresa, args.archivo)
        if args.json_out:
            _escribir_json(res, empresa, args.archivo, args.json_out)
        if args.dry_run or args.json_out:
            return 0
        filas = res.filas
    # ── Modo JSON ─────────────────────────────────────────────────
    else:
        if not args.json_in.is_file():
            print(f"ERROR: no existe {args.json_in}")
            return 1
        try:
            empresa_json, filas, saltadas, repetidas, duplicadas = _leer_json(args.json_in)
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            print(f"ERROR: el JSON no tiene el formato de --json-out: {exc}")
            return 1
        if empresa_json != empresa:
            # La huella de cada fila lleva la empresa: cargar REVTECH como
            # TRONGKAI no chocaría con nada y quedaría todo en la empresa equivocada.
            print(f"ERROR: el JSON es de {empresa_json} y pediste --empresa {empresa}")
            return 1
        print(
            f"JSON {args.json_in.name}: {len(filas)} filas a cargar "
            f"({len(repetidas)} repetidas con observación), {len(saltadas)} saltadas y "
            f"{len(duplicadas)} colapsadas en el Excel original"
        )

    usuario = (args.usuario or "").strip()
    if not usuario:
        print("ERROR: para cargar hace falta --usuario (email que queda como created_by)")
        return 1

    try:
        resumen = asyncio.run(_cargar(empresa, filas, usuario, args.dry_run))
    except Exception as exc:  # se informa y se sale con código 1
        print(f"ERROR cargando en la BD: {type(exc).__name__}: {exc}")
        return 1
    _imprimir_resumen_carga(resumen)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
