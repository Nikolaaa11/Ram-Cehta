/**
 * Paridad frontend↔backend del reparto CORFO por fuente.
 *
 * Lee el MISMO snapshot que `backend/tests/unit/test_reparto_corfo.py::
 * test_snapshot_paridad` (`backend/tests/fixtures/reparto_corfo_esperado.json`).
 * Si alguien toca el motor Python o el espejo TS y no el otro, una de las
 * dos suites falla.
 *
 * Por qué importa: la ficha recalcula el reparto en vivo mientras Claudia
 * tipea porcentajes, y lo que muestra tiene que ser exactamente lo que la
 * API guarda después. Un peso de diferencia entre pantalla y BD es un
 * descuadre que CORFO ve en la rendición.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  centavosADecimal,
  centesimosAPct,
  decimalACentavos,
  escalarReparto,
  estadoReparto,
  FUENTES,
  MontosInvalidosError,
  normalizarMontos,
  patchMontos,
  pctACentesimos,
  pctDesdeMontos,
  RepartoInvalidoError,
  repartirPorPct,
  repartoDesdeApi,
  repartoParaApi,
} from "@/lib/claudia/reparto";
import type { Fuente } from "@/lib/claudia/types";

interface CasoPct {
  nombre: string;
  total: string;
  pcts: Partial<Record<Fuente, string>>;
  esperado_montos: Record<Fuente, string>;
  esperado_estado: string;
  esperado_pcts: Record<Fuente, string>;
}

interface CasoMontos {
  nombre: string;
  total: string;
  montos: Partial<Record<Fuente, string>> | null;
  esperado_normalizados: Record<Fuente, string | null>;
  esperado_estado: string;
  esperado_pcts: Record<Fuente, string> | null;
}

/** Los casos de `escalar_reparto`: cambia el total, el reparto se escala. */
interface CasoEscalar {
  nombre: string;
  total: string;
  montos: Partial<Record<Fuente, string>> | null;
  escalar_a: string;
  esperado_escalado: Record<Fuente, string | null>;
  esperado_estado: string;
}

type Caso = CasoPct | CasoMontos | CasoEscalar;

const snapshotPath = resolve(
  __dirname,
  "../../../backend/tests/fixtures/reparto_corfo_esperado.json",
);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
  fuentes: string[];
  casos: Caso[];
};

const casosPct = snapshot.casos.filter((c): c is CasoPct => "pcts" in c);
const casosMontos = snapshot.casos.filter(
  (c): c is CasoMontos => "montos" in c && "esperado_normalizados" in c,
);
const casosEscalar = snapshot.casos.filter((c): c is CasoEscalar => "escalar_a" in c);

/** Los strings del snapshot → centavos / centésimos. */
function pctsEnCentesimos(pcts: Partial<Record<Fuente, string>>) {
  const out: Partial<Record<Fuente, number>> = {};
  for (const f of FUENTES) {
    const v = pcts[f];
    if (v !== undefined) out[f] = pctACentesimos(v)!;
  }
  return out;
}

function montosEnCentavos(montos: Partial<Record<Fuente, string>> | null) {
  if (montos === null) return null;
  const out: Partial<Record<Fuente, number | null>> = {};
  for (const f of FUENTES) {
    const v = montos[f];
    if (v !== undefined) out[f] = decimalACentavos(v);
  }
  return out;
}

function aStrings(montos: Record<Fuente, number | null>): Record<Fuente, string | null> {
  const out = {} as Record<Fuente, string | null>;
  for (const f of FUENTES) {
    const v = montos[f];
    out[f] = v === null ? null : centavosADecimal(v);
  }
  return out;
}

function pctsAStrings(pcts: Record<Fuente, number> | null): Record<Fuente, string> | null {
  if (pcts === null) return null;
  const out = {} as Record<Fuente, string>;
  for (const f of FUENTES) out[f] = centesimosAPct(pcts[f]);
  return out;
}

describe("el snapshot compartido", () => {
  it("existe y cubre los casos que importan", () => {
    // Si el fixture se mueve o se vacía, este test avisa en vez de que los
    // `it.each` de abajo pasen trivialmente sobre 0 casos.
    expect(snapshot.fuentes).toEqual([...FUENTES]);
    expect(snapshot.casos.length).toBe(18);
    expect(casosPct.length).toBeGreaterThanOrEqual(7);
    expect(casosMontos.length).toBeGreaterThanOrEqual(4);
    expect(casosEscalar.length).toBe(5);
    // Ningún caso se queda afuera de los tres grupos (si el fixture suma
    // una forma nueva, este test avisa en vez de pasar por omisión).
    expect(casosPct.length + casosMontos.length + casosEscalar.length).toBe(snapshot.casos.length);
    const nombres = snapshot.casos.map((c) => c.nombre).join(" | ");
    expect(nombres).toMatch(/residuo/i); // residuo a la fuente mayor
    expect(nombres).toMatch(/empate/i); // desempate por orden canónico
    expect(nombres).toMatch(/centavos/i); // centavos del total
    expect(nombres).toMatch(/descuadrad/i); // descuadre
    expect(nombres).toMatch(/sin clasificar/i); // sin clasificar
    expect(nombres).toMatch(/escalar/i); // escalar al cambiar el total
  });
});

describe("escalarReparto · paridad con el backend (escalar_reparto)", () => {
  it.each(casosEscalar.map((c) => [c.nombre, c] as const))("%s", (_n, caso) => {
    const viejo = decimalACentavos(caso.total)!;
    const nuevo = decimalACentavos(caso.escalar_a)!;
    const escalado = escalarReparto(viejo, nuevo, montosEnCentavos(caso.montos));
    expect(aStrings(escalado)).toEqual(caso.esperado_escalado);
    expect(estadoReparto(nuevo, escalado)).toBe(caso.esperado_estado);
  });

  it("descuadrado contra el total viejo → error (no se escala lo que no cierra)", () => {
    expect(() => escalarReparto(100_000, 200_000, { subsidio: 50_000, cehta: 40_000 })).toThrow(
      RepartoInvalidoError,
    );
  });

  it("desde total $0 sólo se acepta ir a $0", () => {
    const ceros = { subsidio: 0, cehta_ptec: 0, cehta: 0, trewaox: 0 };
    expect(escalarReparto(0, 0, ceros)).toEqual(ceros);
    expect(() => escalarReparto(0, 100, ceros)).toThrow(/\$0/);
  });

  it("total negativo → error", () => {
    expect(() => escalarReparto(100, -1, { subsidio: 100 })).toThrow(/negativo/);
  });

  it("empate entre fuentes: el residuo va a la primera en FUENTES", () => {
    // 50/50 sobre $2 → $1 y $1; a $3 cada una da 1,5 → HALF_UP 2 y 2 = 4,
    // el residuo −1 lo absorbe subsidio (empatada con cehta, va primero).
    const r = escalarReparto(200, 300, { subsidio: 100, cehta: 100 });
    expect(r).toEqual({ subsidio: 100, cehta_ptec: 0, cehta: 200, trewaox: 0 });
    expect(estadoReparto(300, r)).toBe("OK");
  });
});

describe("repartirPorPct · paridad con el backend", () => {
  it.each(casosPct.map((c) => [c.nombre, c] as const))("%s", (_n, caso) => {
    const total = decimalACentavos(caso.total)!;
    const montos = repartirPorPct(total, pctsEnCentesimos(caso.pcts));
    expect(aStrings(montos)).toEqual(caso.esperado_montos);
    // La suma cierra EXACTAMENTE contra el total (a centavo), siempre.
    const suma = FUENTES.reduce((acc, f) => acc + montos[f], 0);
    expect(suma).toBe(total);
    expect(estadoReparto(total, montos)).toBe(caso.esperado_estado);
    expect(pctsAStrings(pctDesdeMontos(total, montos))).toEqual(caso.esperado_pcts);
  });
});

describe("normalizarMontos / estadoReparto / pctDesdeMontos · paridad con el backend", () => {
  it.each(casosMontos.map((c) => [c.nombre, c] as const))("%s", (_n, caso) => {
    const total = decimalACentavos(caso.total)!;
    const normalizados = normalizarMontos(montosEnCentavos(caso.montos));
    expect(aStrings(normalizados)).toEqual(caso.esperado_normalizados);
    expect(estadoReparto(total, normalizados)).toBe(caso.esperado_estado);
    expect(pctsAStrings(pctDesdeMontos(total, normalizados))).toEqual(caso.esperado_pcts);
  });
});

describe("las reglas que el backend fija por test", () => {
  it("porcentajes que no suman 100 → error en español", () => {
    expect(() => repartirPorPct(100_000, { subsidio: 5000, cehta: 4000 })).toThrow(
      RepartoInvalidoError,
    );
    expect(() => repartirPorPct(100_000, { subsidio: 5000, cehta: 4000 })).toThrow(
      /suman 90%, tienen que sumar 100%/,
    );
  });

  it("un porcentaje fuera de 0..100 → error", () => {
    expect(() => repartirPorPct(100_000, { subsidio: 12_000 })).toThrow(
      /entre 0 y 100/,
    );
    expect(() => repartirPorPct(100_000, { subsidio: -100, cehta: 10_100 })).toThrow(
      RepartoInvalidoError,
    );
  });

  it("total negativo → error", () => {
    expect(() => repartirPorPct(-1, { subsidio: 10_000 })).toThrow(/negativo/);
  });

  it("tolerancia ±0,01: 99.99 y 100.01 pasan, 99.98 no", () => {
    expect(() => repartirPorPct(30_000, { subsidio: 3333, cehta_ptec: 3333, cehta: 3333 })).not.toThrow();
    expect(() => repartirPorPct(30_000, { subsidio: 3334, cehta_ptec: 3334, cehta: 3333 })).not.toThrow();
    expect(() => repartirPorPct(30_000, { subsidio: 3333, cehta_ptec: 3333, cehta: 3332 })).toThrow(
      RepartoInvalidoError,
    );
  });

  it("un cero explícito no es 'sin clasificar' (todo-o-nada)", () => {
    // La trampa del cero falsy: `{subsidio: 0}` es un reparto con 0 en
    // subsidio y 0 en el resto, no las 4 en null.
    const n = normalizarMontos({ subsidio: 0 });
    expect(n).toEqual({ subsidio: 0, cehta_ptec: 0, cehta: 0, trewaox: 0 });
    expect(estadoReparto(0, n)).toBe("OK");
    expect(estadoReparto(100, n)).toBe("DESCUADRADO");
  });
});

describe("patchMontos · editar neto/impuesto/total desde la grilla", () => {
  const base = {
    monto_neto: "79287.00",
    impuesto: "15065.00",
    total: "94352.00",
    reparto: { subsidio: "0.00", cehta_ptec: "0.00", cehta: "94352.00", trewaox: "0.00" },
    reparto_estado: "OK" as const,
  };

  it("editar el total recalcula el neto (impuesto fijo) y ESCALA el reparto", () => {
    const p = patchMontos(base, "total", 10_000_000); // $100.000
    expect(p.total).toBe("100000.00");
    expect(p.impuesto).toBe("15065.00");
    expect(p.monto_neto).toBe("84935.00");
    // 100 % Cehta se mantiene y la suma cierra exacto.
    expect(p.reparto).toEqual({ subsidio: "0.00", cehta_ptec: "0.00", cehta: "100000.00", trewaox: "0.00" });
  });

  it("editar el neto deja el TOTAL fijo: el impuesto pasa a ser total − neto y el reparto no se toca", () => {
    const p = patchMontos(base, "monto_neto", 8_000_000);
    expect(p.monto_neto).toBe("80000.00");
    expect(p.impuesto).toBe("14352.00");
    expect(p.total).toBeUndefined();
    expect(p.reparto).toBeUndefined();
  });

  it("editar el impuesto deja el Total fijo: el neto pasa a ser total − impuesto", () => {
    const p = patchMontos(base, "impuesto", 1_000_000);
    expect(p.impuesto).toBe("10000.00");
    expect(p.monto_neto).toBe("84352.00");
    expect(p.total).toBeUndefined();
    expect(p.reparto).toBeUndefined();
  });

  it("neto o impuesto mayores que el total → MontosInvalidosError (no se guarda)", () => {
    expect(() => patchMontos(base, "monto_neto", 10_000_000)).toThrow(MontosInvalidosError);
    expect(() => patchMontos(base, "monto_neto", 10_000_000)).toThrow(
      /neto \$100\.000 no puede superar el total \$94\.352/,
    );
    expect(() => patchMontos(base, "impuesto", 9_435_201)).toThrow(/impuesto .* no puede superar/);
    // Justo igual al total sí vale: el otro queda en 0.
    expect(patchMontos(base, "monto_neto", 9_435_200)).toEqual({ monto_neto: "94352.00", impuesto: "0.00" });
  });

  it("vaciar el neto lo recalcula (total − impuesto); vaciar el impuesto lo deja en 0", () => {
    expect(patchMontos(base, "monto_neto", null)).toEqual({ monto_neto: "79287.00", impuesto: "15065.00" });
    expect(patchMontos(base, "impuesto", null)).toEqual({ monto_neto: "94352.00", impuesto: "0.00" });
  });

  it("PROYECTA: neto y después impuesto dejan el reparto IDÉNTICO y el total en 590.777", () => {
    // Antes esta secuencia movía $21 del Subsidio a Cehta por el drift de
    // convertir a % y volver a pesos. Ahora el total no se mueve y el
    // reparto ni se mira.
    const proyecta = {
      monto_neto: null,
      impuesto: null,
      total: "590777.00",
      reparto: { subsidio: "496451.00", cehta_ptec: "0.00", cehta: "94326.00", trewaox: "0.00" },
      reparto_estado: "OK" as const,
    };
    const p1 = patchMontos(proyecta, "monto_neto", 49_645_100);
    expect(p1).toEqual({ monto_neto: "496451.00", impuesto: "94326.00" });
    // Lo que la API devolvería tras aplicar p1 (total intacto, reparto intacto).
    const despues = { ...proyecta, monto_neto: p1.monto_neto!, impuesto: p1.impuesto! };
    const p2 = patchMontos(despues, "impuesto", 9_432_600);
    expect(p2).toEqual({ monto_neto: "496451.00", impuesto: "94326.00" });
    expect(p2.reparto).toBeUndefined();
    expect(p2.total).toBeUndefined();
    expect(decimalACentavos(despues.total)).toBe(59_077_700);
    expect(despues.reparto).toEqual(proyecta.reparto);
  });

  it("un reparto descuadrado o sin clasificar no se toca al cambiar el total", () => {
    const p1 = patchMontos(
      { ...base, reparto: { ...base.reparto, cehta: "90000.00" }, reparto_estado: "DESCUADRADO" },
      "total",
      10_000_000,
    );
    expect(p1.total).toBe("100000.00");
    expect(p1.reparto).toBeUndefined();
    const p2 = patchMontos({ ...base, reparto: null, reparto_estado: "SIN_CLASIFICAR" }, "total", 10_000_000);
    expect(p2.reparto).toBeUndefined();
    expect(p2.total).toBe("100000.00");
  });

  it("50/20/30 sobrevive al cambio de total con residuo a la mayor", () => {
    const p = patchMontos(
      {
        monto_neto: null,
        impuesto: null,
        total: "1000000.00",
        reparto: { subsidio: "500000.00", cehta_ptec: "200000.00", cehta: "300000.00", trewaox: "0.00" },
        reparto_estado: "OK",
      },
      "total",
      100_000_100, // $1.000.001
    );
    expect(p.monto_neto).toBeUndefined(); // no había neto/impuesto: no se inventan
    expect(p.reparto).toEqual({
      subsidio: "500001.00",
      cehta_ptec: "200000.00",
      cehta: "300000.00",
      trewaox: "0.00",
    });
  });

  it("cambiar el total escala en proporción exacta, no por porcentajes (PROYECTA)", () => {
    const p = patchMontos(
      {
        monto_neto: null,
        impuesto: null,
        total: "590777.00",
        reparto: { subsidio: "496451.00", cehta_ptec: "0.00", cehta: "94326.00", trewaox: "0.00" },
        reparto_estado: "OK",
      },
      "total",
      49_645_100,
    );
    // Igual al caso "escalar PROYECTA de 590777 a 496451" del fixture.
    expect(p.reparto).toEqual({ subsidio: "417185.00", cehta_ptec: "0.00", cehta: "79266.00", trewaox: "0.00" });
  });

  it("desde total $0 con reparto en ceros no se inventa un reparto", () => {
    const p = patchMontos(
      {
        monto_neto: null,
        impuesto: null,
        total: "0.00",
        reparto: { subsidio: "0.00", cehta_ptec: "0.00", cehta: "0.00", trewaox: "0.00" },
        reparto_estado: "OK",
      },
      "total",
      100,
    );
    expect(p.total).toBe("1.00");
    expect(p.reparto).toBeUndefined();
  });

  it("borrar el total no manda nada (es obligatorio)", () => {
    expect(patchMontos(base, "total", null)).toEqual({});
  });
});

describe("decimal string ↔ centavos (sin float)", () => {
  it("parsea partiendo en el punto, no multiplicando", () => {
    // 0.29 * 100 en float da 28.999999999999996.
    expect(decimalACentavos("0.29")).toBe(29);
    expect(decimalACentavos("94352.00")).toBe(9_435_200);
    expect(decimalACentavos("94352")).toBe(9_435_200);
    expect(decimalACentavos("1.5")).toBe(150);
    expect(decimalACentavos(".5")).toBe(50);
    expect(decimalACentavos("-12.34")).toBe(-1234);
    expect(decimalACentavos("12,5")).toBe(1250);
  });

  it("redondea HALF_UP al segundo decimal, como Decimal.quantize", () => {
    expect(decimalACentavos("5645105.9504")).toBe(564_510_595);
    expect(decimalACentavos("0.995")).toBe(100);
    expect(decimalACentavos("0.9949")).toBe(99);
    expect(decimalACentavos("0.005")).toBe(1);
  });

  it("vacío o basura → null (no NaN, no 0)", () => {
    for (const v of ["", "   ", "abc", "1.2.3", null, undefined]) {
      expect(decimalACentavos(v)).toBeNull();
    }
  });

  it("vuelve a string con 2 decimales, como NUMERIC(18,2)", () => {
    expect(centavosADecimal(9_435_200)).toBe("94352.00");
    expect(centavosADecimal(5)).toBe("0.05");
    expect(centavosADecimal(0)).toBe("0.00");
    expect(centavosADecimal(-1234)).toBe("-12.34");
    expect(centesimosAPct(10_000)).toBe("100.00");
    expect(centesimosAPct(3333)).toBe("33.33");
  });

  it("ida y vuelta con la API", () => {
    const api = { subsidio: "496451.00", cehta_ptec: "0.00", cehta: "94326.00", trewaox: "0.00" };
    const c = repartoDesdeApi(api);
    expect(c).toEqual({ subsidio: 49_645_100, cehta_ptec: 0, cehta: 9_432_600, trewaox: 0 });
    expect(repartoParaApi(c)).toEqual(api);
    expect(repartoDesdeApi(null)).toEqual({ subsidio: null, cehta_ptec: null, cehta: null, trewaox: null });
    expect(repartoParaApi(repartoDesdeApi(null))).toBeNull();
  });
});
