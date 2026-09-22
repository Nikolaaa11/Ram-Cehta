import { describe, expect, it } from "vitest";
import { importeLinea, precioUnitario, sumaItemizado } from "@/lib/oc/itemizado";

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
