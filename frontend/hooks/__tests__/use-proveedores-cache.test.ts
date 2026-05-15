/**
 * Tests unit para use-proveedores-cache.ts — Round 53.
 *
 * Por ahora solo cubre `highlightMatch` (función pura, no requiere
 * QueryClient ni react-test-renderer). Si más adelante se quiere testear
 * `useFilterProveedores` y `useProveedoresCache`, se necesita
 * QueryClientProvider wrapper.
 */
import { describe, expect, it } from "vitest";
import { highlightMatch } from "@/hooks/use-proveedores-cache";

describe("highlightMatch", () => {
  it("devuelve un único segment sin highlight si query es vacío", () => {
    expect(highlightMatch("BANCO DE CHILE", "")).toEqual([
      { text: "BANCO DE CHILE", highlight: false },
    ]);
  });

  it("devuelve un único segment sin highlight si query es solo espacios", () => {
    expect(highlightMatch("BANCO DE CHILE", "   ")).toEqual([
      { text: "BANCO DE CHILE", highlight: false },
    ]);
  });

  it("resalta la coincidencia al inicio del string", () => {
    const result = highlightMatch("BANCO DE CHILE", "BAN");
    expect(result).toEqual([
      { text: "BAN", highlight: true },
      { text: "CO DE CHILE", highlight: false },
    ]);
  });

  it("resalta la coincidencia en el medio del string", () => {
    const result = highlightMatch("EL BANCO DE CHILE", "BANCO");
    expect(result).toEqual([
      { text: "EL ", highlight: false },
      { text: "BANCO", highlight: true },
      { text: " DE CHILE", highlight: false },
    ]);
  });

  it("resalta la coincidencia al final del string", () => {
    const result = highlightMatch("BANCO DE CHILE", "CHILE");
    expect(result).toEqual([
      { text: "BANCO DE ", highlight: false },
      { text: "CHILE", highlight: true },
    ]);
  });

  it("resalta TODAS las coincidencias en el string", () => {
    const result = highlightMatch("ABABAB", "AB");
    expect(result).toEqual([
      { text: "AB", highlight: true },
      { text: "AB", highlight: true },
      { text: "AB", highlight: true },
    ]);
  });

  it("es case-insensitive (preserva el case del texto original)", () => {
    const result = highlightMatch("Banco de Chile", "BANCO");
    // El texto en la salida mantiene el case original "Banco".
    expect(result).toEqual([
      { text: "Banco", highlight: true },
      { text: " de Chile", highlight: false },
    ]);
  });

  it("no resalta cuando query no aparece", () => {
    expect(highlightMatch("BANCO DE CHILE", "XYZ")).toEqual([
      { text: "BANCO DE CHILE", highlight: false },
    ]);
  });

  it("maneja text vacío", () => {
    expect(highlightMatch("", "BAN")).toEqual([
      { text: "", highlight: false },
    ]);
  });

  it("maneja query más larga que text", () => {
    expect(highlightMatch("AB", "ABCDE")).toEqual([
      { text: "AB", highlight: false },
    ]);
  });

  it("trimea espacios del query antes de matchear", () => {
    const result = highlightMatch("BANCO DE CHILE", "  BANCO  ");
    expect(result).toEqual([
      { text: "BANCO", highlight: true },
      { text: " DE CHILE", highlight: false },
    ]);
  });
});
