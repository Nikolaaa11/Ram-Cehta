"""Genera `tests/fixtures/reparto_corfo_esperado.json`: paridad Python ↔ TypeScript.

El motor de reparto (`app/domain/value_objects/reparto_corfo.py`) es la
fuente de verdad. El frontend tiene un espejo en TypeScript
(`frontend/lib/claudia/reparto.ts`) para que el editor recalcule en vivo sin
ir al servidor. Este snapshot es el contrato entre los dos: los mismos
casos, los mismos resultados al centavo. Si cambia el motor, se regenera
acá y las DOS suites (pytest + vitest) tienen que seguir verdes.

    python scripts/gen_snapshot_reparto_corfo.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.value_objects.reparto_corfo import (
    FUENTES,
    escalar_reparto,
    estado_reparto,
    normalizar_montos,
    pct_desde_montos,
    repartir_por_pct,
)

DESTINO = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "reparto_corfo_esperado.json"

#: Los casos. Los que traen `pcts` prueban % → montos; los que traen `montos`
#: prueban montos → estado + %. Varios son filas REALES del Excel de Claudia.
CASOS: list[dict] = [
    {"nombre": "default proyecto 50/20/30 con residuo HALF_UP",
     "total": "1000001", "pcts": {"subsidio": "50", "cehta_ptec": "20", "cehta": "30"}},
    {"nombre": "33.33 x3: el residuo va a la fuente mayor",
     "total": "100", "pcts": {"subsidio": "33.33", "cehta_ptec": "33.33", "cehta": "33.34"}},
    {"nombre": "centavos del total los absorbe la mayor (CAMILO SALAZAR ene-2026)",
     "total": "5645105.9504",
     "pcts": {"subsidio": "35.43", "cehta_ptec": "60.05", "cehta": "4.52"}},
    {"nombre": "100% subsidio (PROGARANTIA)",
     "total": "9935822", "pcts": {"subsidio": "100"}},
    {"nombre": "empate 50/50 sobre $1 desempata por orden canonico",
     "total": "1", "pcts": {"subsidio": "50", "cehta": "50"}},
    {"nombre": "cuatro fuentes TRONGKAI (CENTRO TECNOLOGICO nov-2025)",
     "total": "2828673", "pcts": {"trewaox": "84.03", "cehta": "15.97"}},
    {"nombre": "total cero reparte ceros",
     "total": "0", "pcts": {"subsidio": "100"}},
    {"nombre": "tolerancia 99.99",
     "total": "300", "pcts": {"subsidio": "33.33", "cehta_ptec": "33.33", "cehta": "33.33"}},
    {"nombre": "montos OK (PROYECTA SPA dic-2025)",
     "total": "590777", "montos": {"subsidio": "496451", "cehta": "94326"}},
    {"nombre": "montos descuadrados: los % NO se maquillan",
     "total": "1000", "montos": {"subsidio": "500", "cehta": "400"}},
    {"nombre": "sin clasificar",
     "total": "1000", "montos": None},
    {"nombre": "montos con 3 fuentes y centavos (CAMILO SALAZAR ene-2026)",
     "total": "5645105.9504",
     "montos": {"subsidio": "2000000", "cehta_ptec": "3390000", "cehta": "255105.9504"}},
    {"nombre": "una sola fuente con valor: las otras pasan a 0",
     "total": "94352", "montos": {"cehta": "94352"}},
    # Escalado exacto al cambiar el total (sin pasar por %): PROYECTA SPA
    {"nombre": "escalar PROYECTA de 590777 a 496451 (residuo a la mayor)",
     "total": "590777", "montos": {"subsidio": "496451", "cehta": "94326"},
     "escalar_a": "496451"},
    {"nombre": "escalar de vuelta 496451 -> 590777 mueve a lo sumo $1",
     "total": "496451", "montos": {"subsidio": "417185", "cehta": "79266"},
     "escalar_a": "590777"},
    {"nombre": "escalar 3 fuentes con centavos (CAMILO SALAZAR) a 1000000",
     "total": "5645105.9504",
     "montos": {"subsidio": "2000000", "cehta_ptec": "3390000", "cehta": "255105.9504"},
     "escalar_a": "1000000"},
    {"nombre": "escalar sin clasificar sigue sin clasificar",
     "total": "1000", "montos": None, "escalar_a": "2000"},
    {"nombre": "escalar al mismo total no toca nada",
     "total": "590777", "montos": {"subsidio": "496451", "cehta": "94326"},
     "escalar_a": "590777"},
]


def _s(d: dict | None) -> dict | None:
    if d is None:
        return None
    return {f: (str(v) if v is not None else None) for f, v in d.items()}


def main() -> None:
    salida = []
    for c in CASOS:
        item: dict = {"nombre": c["nombre"], "total": c["total"]}
        if "pcts" in c:
            montos = repartir_por_pct(c["total"], c["pcts"])
            item["pcts"] = c["pcts"]
            item["esperado_montos"] = _s(montos)
            item["esperado_estado"] = estado_reparto(c["total"], montos)
            item["esperado_pcts"] = _s(pct_desde_montos(c["total"], montos))
        elif "escalar_a" in c:
            item["montos"] = c["montos"]
            item["escalar_a"] = c["escalar_a"]
            escalado = escalar_reparto(c["total"], c["escalar_a"], c["montos"])
            item["esperado_escalado"] = _s(escalado)
            item["esperado_estado"] = estado_reparto(c["escalar_a"], escalado)
        else:
            item["montos"] = c["montos"]
            item["esperado_normalizados"] = _s(normalizar_montos(c["montos"]))
            item["esperado_estado"] = estado_reparto(c["total"], c["montos"])
            item["esperado_pcts"] = _s(pct_desde_montos(c["total"], c["montos"]))
        salida.append(item)

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    payload = {"fuentes": list(FUENTES), "casos": salida}
    DESTINO.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"OK - {len(salida)} casos -> {DESTINO}")


if __name__ == "__main__":
    main()
