"""Genera el snapshot compartido de totales de OC.

Lo leen DOS suites:
  · backend/tests/unit/test_oc_totales_paridad.py
  · frontend/lib/__tests__/oc-totales-paridad.test.ts

Existe porque la pantalla y el PDF venían diciendo cosas distintas. Las dos
pantallas de IA calculaban la vista previa con `moneda === "CLP" ? neto*0.19 : 0`
mientras el servidor aplicaba IVA también a la UF: una OC en UF mostraba IVA 0
y salía con 19%. Corregir el literal no alcanza —vuelve a divergir en el
próximo cambio—, así que las dos implementaciones se atan a este archivo.

La AUTORIDAD es y sigue siendo `_derivar_totales_oc`. Este script lo interroga
y escribe lo que responde; el TypeScript se acomoda, nunca al revés.

    python scripts/gen_snapshot_totales_oc.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND))

from app.api.v1.ordenes_compra import _derivar_totales_oc  # noqa: E402

_DESTINO = _BACKEND / "tests" / "fixtures" / "oc_totales_esperado.json"

#: (etiqueta, neto, moneda, tipo, iva%, retención%)
#:
#: Se eligen por lo que cada uno PRUEBA, no por variedad decorativa. Si mañana
#: alguien "simplifica" una regla, el caso que la cubre falla en las dos
#: suites a la vez.
CASOS: list[tuple[str, str, str, str, str, str]] = [
    # ── El caso corriente ────────────────────────────────────────────────
    ("clp_factura_19", "1000000", "CLP", "FACTURA", "19", "0"),
    ("clp_boleta_19", "250000", "CLP", "BOLETA", "19", "0"),

    # ── El peso NO tiene centavos ────────────────────────────────────────
    # La suma del itemizado puede traerlos (cantidad fraccionaria, gross-up);
    # el neto se redondea a peso entero ANTES de calcular.
    ("clp_neto_con_centavos", "1179939.99", "CLP", "FACTURA", "19", "0"),
    ("clp_neto_medio_peso", "1000000.50", "CLP", "FACTURA", "19", "0"),

    # ── La UF SÍ lleva IVA, y CON decimales ──────────────────────────────
    # El corazón de la queja "no me cuadra": la pantalla mostraba 0.
    ("uf_factura_19", "100", "UF", "FACTURA", "19", "0"),
    ("uf_factura_decimales", "123.45", "UF", "FACTURA", "19", "0"),
    ("uf_neto_largo", "1234.567", "UF", "FACTURA", "19", "0"),

    # ── El dólar queda afuera a propósito ────────────────────────────────
    # Exportación/importación tiene otro tratamiento; el % persistido también
    # baja a 0 para que la fila no se contradiga.
    ("usd_factura_sin_iva", "1000", "USD", "FACTURA", "19", "0"),

    # ── Exenta ───────────────────────────────────────────────────────────
    ("clp_exenta", "500000", "CLP", "FACTURA_EXENTA", "19", "0"),
    ("uf_exenta", "123.45", "UF", "FACTURA_EXENTA", "19", "0"),

    # ── Honorarios: sin IVA y CON retención ──────────────────────────────
    # La segunda queja. El líquido sale por resta, así que
    # total_a_pagar + retencion == total cierra exacto siempre.
    ("clp_honorarios_1525", "3645000", "CLP", "HONORARIOS", "0", "15.25"),
    ("clp_honorarios_impar", "1179941", "CLP", "HONORARIOS", "0", "15.25"),
    ("uf_honorarios", "123.45", "UF", "HONORARIOS", "0", "15.25"),
    ("clp_honorarios_ret_cero", "1000000", "CLP", "HONORARIOS", "0", "0"),

    # ── Tasas pactadas y el cero explícito ───────────────────────────────
    ("clp_iva_pactado", "1000000", "CLP", "FACTURA", "12.5", "0"),
    ("clp_iva_cero_explicito", "1000000", "CLP", "FACTURA", "0", "0"),

    # ── Bordes ───────────────────────────────────────────────────────────
    ("clp_neto_cero", "0", "CLP", "FACTURA", "19", "0"),
    ("clp_un_peso", "1", "CLP", "FACTURA", "19", "0"),
    ("clp_monto_grande", "987654321", "CLP", "FACTURA", "19", "0"),
    ("uf_un_centesimo", "0.01", "UF", "FACTURA", "19", "0"),
]

_CLAVES = (
    "neto",
    "iva_porcentaje",
    "iva",
    "total",
    "retencion_porcentaje",
    "retencion_monto",
    "total_a_pagar",
)


def main() -> None:
    casos: dict[str, dict] = {}
    for etiqueta, neto, moneda, tipo, iva_pct, ret_pct in CASOS:
        d = _derivar_totales_oc(
            neto=Decimal(neto),
            moneda=moneda,
            tipo_documento=tipo,
            iva_porcentaje=Decimal(iva_pct),
            retencion_porcentaje=Decimal(ret_pct),
        )
        # Todo como STRING: un float en JSON perdería justo la precisión que
        # este archivo existe para custodiar.
        casos[etiqueta] = {
            "entrada": {
                "neto": neto,
                "moneda": moneda,
                "tipo_documento": tipo,
                "iva_porcentaje": iva_pct,
                "retencion_porcentaje": ret_pct,
            },
            "esperado": {k: str(d[k]) for k in _CLAVES},
        }

    _DESTINO.parent.mkdir(parents=True, exist_ok=True)
    _DESTINO.write_text(
        json.dumps(
            {
                "_generado_por": "backend/scripts/gen_snapshot_totales_oc.py",
                "_autoridad": "app.api.v1.ordenes_compra._derivar_totales_oc",
                "casos": casos,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(casos)} casos -> {_DESTINO}")


if __name__ == "__main__":
    main()
