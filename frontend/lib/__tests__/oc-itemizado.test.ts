import { describe, expect, it } from "vitest";
import { importeLinea, montoLinea, precioUnitario, sumaItemizado } from "@/lib/oc/itemizado";

// Las 19 líneas reales de OC0059-PAN001-Comercializadora los Canelos.
const OC96 = [
  ["2", "67142.86"], ["1", "54453.76"], ["1", "4873.95"], ["1", "1680.67"],
  ["19", "420.17"], ["3", "4201.68"], ["6", "546.22"], ["10", "2268.91"],
  ["13", "2268.91"], ["5", "8235.29"], ["8", "294.12"], ["1", "2100.84"],
  ["1", "420.17"], ["2", "294.12"], ["1", "1680.67"], ["1", "420.17"],
  ["20", "84.03"], ["6", "1596.64"], ["6", "840.34"],
].map(([cantidad, precio_unitario]) => ({ cantidad, precio_unitario, total_linea: null }));

describe("importeLinea", () => {
  it("usa el importe guardado cuando existe", () => {
    expect(importeLinea({ total_linea: "134286", cantidad: "2", precio_unitario: "1" })).toBe(
      134286,
    );
  });

  it("lo calcula cuando la línea viene sin importe (OC viejas)", () => {
    expect(importeLinea({ total_linea: null, cantidad: "2", precio_unitario: "67142.86" })).toBe(
      134286,
    );
  });

  it("no muestra cero por un dato faltante", () => {
    expect(importeLinea({ cantidad: "19", precio_unitario: "420.17" })).toBe(7983);
  });

  it("respeta los descuentos (líneas negativas)", () => {
    expect(importeLinea({ cantidad: "1", precio_unitario: "-500000" })).toBe(-500000);
  });
});

describe("la columna de la OC 96 suma el neto", () => {
  it("da exactamente 336.387", () => {
    expect(sumaItemizado(OC96)).toBe(336387);
  });
});

describe("precioUnitario", () => {
  it("muestra los decimales cuando el precio los tiene", () => {
    expect(precioUnitario("67142.86")).toBe("$67.142,86");
  });

  it("no inventa decimales cuando el precio es entero", () => {
    expect(precioUnitario("600000")).toBe("$600.000");
  });
});

describe("redondeo simétrico y monedas", () => {
  it("un descuento de medio peso redondea como el backend (-1, no -0)", () => {
    expect(importeLinea({ cantidad: "1", precio_unitario: "-0.5" })).toBe(-1);
    expect(importeLinea({ cantidad: "1", precio_unitario: "-1.5" })).toBe(-2);
  });

  it("en UF conserva los centésimos", () => {
    expect(importeLinea({ cantidad: "1", precio_unitario: "12.45" }, "UF")).toBe(12.45);
    expect(sumaItemizado([{ cantidad: "2", precio_unitario: "1.005" }], "UF")).toBe(2.01);
  });

  it("muestra cada moneda con su símbolo", () => {
    expect(montoLinea(4.5, "UF")).toBe("UF 4,50");
    expect(montoLinea(1234, "CLP")).toBe("$1.234");
    expect(montoLinea(19.99, "USD")).toBe("US$19,99");
    expect(precioUnitario("4.5", "UF")).toBe("UF 4,50");
  });
});

// El interruptor de la OC (mostrar_decimales, 2026-09-24). Es presentación:
// el importe de la línea y la suma NO se mueven, sólo el precio impreso.
describe("con decimales / sin decimales", () => {
  it("apagado, el precio sale redondeado a peso", () => {
    expect(precioUnitario("67142.86", "CLP", false)).toBe("$67.143");
    expect(precioUnitario("420.17", "CLP", false)).toBe("$420");
    expect(precioUnitario("0.5", "CLP", false)).toBe("$1");
  });

  it("el default sigue siendo con decimales", () => {
    expect(precioUnitario("67142.86", "CLP")).toBe("$67.142,86");
    expect(precioUnitario("67142.86", "CLP", true)).toBe("$67.142,86");
  });

  it("un precio entero se ve igual en los dos modos", () => {
    expect(precioUnitario("600000", "CLP", false)).toBe("$600.000");
    expect(precioUnitario("600000", "CLP", true)).toBe("$600.000");
  });

  it("en UF y USD se ignora: los centésimos son plata", () => {
    expect(precioUnitario("12.45", "UF", false)).toBe("UF 12,45");
    expect(precioUnitario("19.99", "USD", false)).toBe("US$19,99");
  });

  it("no toca el importe de la línea ni la suma de la columna", () => {
    // El interruptor es un parámetro de `precioUnitario` y de nada más: la
    // columna de importes sigue sumando el mismo neto.
    expect(sumaItemizado(OC96)).toBe(336387);
    // `!` por `noUncheckedIndexedAccess` del tsconfig: OC96[0] existe, pero
    // el tipo dice `... | undefined` y `tsc --noEmit` (CI + build de Vercel)
    // lo rechaza. Misma convención que lib/__tests__/pegar-items.test.ts.
    expect(importeLinea(OC96[0]!)).toBe(134286);
  });
});
