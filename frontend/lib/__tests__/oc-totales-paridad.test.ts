/**
 * Test de PARIDAD frontend↔backend de los totales de una OC.
 *
 * Lee el MISMO snapshot que `backend/tests/unit/test_oc_totales_paridad.py`
 * (`backend/tests/fixtures/oc_totales_esperado.json`). Si alguien toca una de
 * las dos implementaciones y no la otra, una de las dos suites falla.
 *
 * Por qué importa: las dos pantallas de IA calculaban la vista previa con
 * `moneda === "CLP" ? neto * 0.19 : 0` mientras el servidor aplicaba IVA
 * también a la UF. Una OC en UF mostraba IVA 0 en pantalla y salía con 19 %
 * en el PDF — el "los cálculos no me cuadran" que reportó el equipo.
 * Corregir el literal no alcanzaba: vuelve a divergir en el próximo cambio.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { calcularTotalesOC, sumarItemizado } from "../oc/totales";

const snapshotPath = resolve(
  __dirname,
  "../../../backend/tests/fixtures/oc_totales_esperado.json",
);
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const casos: Record<
  string,
  {
    entrada: {
      neto: string;
      moneda: string;
      tipo_documento: string;
      iva_porcentaje: string;
      retencion_porcentaje: string;
    };
    esperado: Record<string, string>;
  }
> = snapshot.casos;

describe("calcularTotalesOC · paridad con el backend", () => {
  it("el snapshot compartido existe y cubre los casos que importan", () => {
    // Si el fixture se mueve o se vacía, este test avisa en vez de que los
    // `it.each` de abajo pasen trivialmente sobre 0 casos.
    const nombres = Object.keys(casos);
    expect(nombres.length).toBeGreaterThanOrEqual(15);
    // Los tres que cubren las quejas reportadas.
    expect(nombres).toContain("uf_factura_19"); // el IVA de la UF
    expect(nombres).toContain("clp_honorarios_1525"); // la retención
    expect(nombres).toContain("clp_neto_con_centavos"); // el peso sin centavos
  });

  it.each(Object.entries(casos))(
    "%s da los mismos seis números que el backend",
    (_nombre, caso) => {
      const r = calcularTotalesOC({
        neto: caso.entrada.neto,
        moneda: caso.entrada.moneda,
        tipoDocumento: caso.entrada.tipo_documento,
        ivaPorcentaje: caso.entrada.iva_porcentaje,
        retencionPorcentaje: caso.entrada.retencion_porcentaje,
      });
      expect({
        neto: r.neto,
        iva_porcentaje: r.ivaPorcentaje,
        iva: r.iva,
        total: r.total,
        retencion_porcentaje: r.retencionPorcentaje,
        retencion_monto: r.retencionMonto,
        total_a_pagar: r.totalAPagar,
      }).toEqual(caso.esperado);
    },
  );
});

describe("las identidades de plata cierran", () => {
  it.each(Object.entries(casos))("%s: total = neto + iva", (_n, caso) => {
    const e = caso.esperado;
    expect(Number(e.total)).toBeCloseTo(Number(e.neto) + Number(e.iva), 6);
  });

  it.each(Object.entries(casos))(
    "%s: total_a_pagar + retencion = total",
    (_n, caso) => {
      // El líquido sale por RESTA, así que esto cierra exacto siempre. Si
      // alguien lo cambiara por un segundo cálculo independiente, acá salta.
      const e = caso.esperado;
      expect(Number(e.total_a_pagar) + Number(e.retencion_monto)).toBeCloseTo(
        Number(e.total),
        6,
      );
    },
  );
});

describe("sumarItemizado", () => {
  it("suma cantidad × precio sin error de coma flotante", () => {
    // 0.1 + 0.2 en float da 0.30000000000000004. Con tres líneas de 0,1 el
    // reduce ingenuo daba 0.30000000000000004 y el neto salía con basura.
    expect(
      sumarItemizado([
        { cantidad: "1", precio_unitario: "0.1" },
        { cantidad: "1", precio_unitario: "0.2" },
      ]),
    ).toBe("0.3");
  });

  it("un caso real de la planilla", () => {
    expect(
      sumarItemizado([
        { cantidad: "50", precio_unitario: "40000" },
        { cantidad: "1", precio_unitario: "500000" },
      ]),
    ).toBe("2500000");
  });

  it("cantidades fraccionarias", () => {
    expect(
      sumarItemizado([{ cantidad: "2.5", precio_unitario: "40855.33" }]),
    ).toBe("102138.325");
  });

  it("la lista vacía suma cero, no NaN", () => {
    expect(sumarItemizado([])).toBe("0");
  });

  it("un campo a medio escribir no rompe la vista previa", () => {
    // El operador está tipeando: "12." todavía no es un número.
    expect(
      sumarItemizado([
        { cantidad: "12.", precio_unitario: "" },
        { cantidad: "", precio_unitario: "abc" },
      ]),
    ).toBe("0");
  });
});

describe("el redondeo es HALF_UP, como en Python", () => {
  it("sube en el medio exacto", () => {
    // `Math.round` es HALF_UP sólo para positivos; el backend usa HALF_UP
    // siempre. Un IVA que caiga justo en la mitad tiene que subir.
    const r = calcularTotalesOC({
      neto: "1000000.50",
      moneda: "CLP",
      tipoDocumento: "FACTURA",
      ivaPorcentaje: "19",
      retencionPorcentaje: "0",
    });
    expect(r.neto).toBe("1000001");
  });

  it("la UF conserva sus centavos en el IVA", () => {
    // 123,45 × 19 % = 23,4555 -> 23,46. Redondeado a UF entera serían 23 y
    // se perderían casi $17.000.
    const r = calcularTotalesOC({
      neto: "123.45",
      moneda: "UF",
      tipoDocumento: "FACTURA",
      ivaPorcentaje: "19",
      retencionPorcentaje: "0",
    });
    expect(r.iva).toBe("23.46");
  });
});

describe("lo que la pantalla mostraba mal", () => {
  it("una OC en UF SÍ lleva IVA", () => {
    // La regresión exacta que reportó el equipo.
    const r = calcularTotalesOC({
      neto: "100",
      moneda: "UF",
      tipoDocumento: "FACTURA",
      ivaPorcentaje: "19",
      retencionPorcentaje: "0",
    });
    expect(Number(r.iva)).toBeGreaterThan(0);
    expect(r.iva).toBe("19.00");
  });

  it("una boleta de honorarios NO lleva IVA y SÍ retención", () => {
    const r = calcularTotalesOC({
      neto: "3645000",
      moneda: "CLP",
      tipoDocumento: "HONORARIOS",
      ivaPorcentaje: "19", // aunque el formulario venga con 19 pegado
      retencionPorcentaje: "15.25",
    });
    expect(r.iva).toBe("0");
    expect(r.ivaPorcentaje).toBe("0"); // el % persistido dice la verdad
    expect(r.retencionMonto).toBe("555863");
    expect(r.totalAPagar).toBe("3089137");
  });

  it("el IVA no está clavado en 19", () => {
    const r = calcularTotalesOC({
      neto: "1000000",
      moneda: "CLP",
      tipoDocumento: "FACTURA",
      ivaPorcentaje: "12.5",
      retencionPorcentaje: "0",
    });
    expect(r.iva).toBe("125000");
  });

  it("un IVA de 0 puesto a propósito se respeta", () => {
    // La trampa del cero falso: con `|| 19` un 0 explícito volvía a 19.
    const r = calcularTotalesOC({
      neto: "1000000",
      moneda: "CLP",
      tipoDocumento: "FACTURA",
      ivaPorcentaje: "0",
      retencionPorcentaje: "0",
    });
    expect(r.iva).toBe("0");
    expect(r.total).toBe("1000000");
  });
});
