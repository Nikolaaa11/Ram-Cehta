import { describe, expect, it } from "vitest";

import { ocPdfFilename } from "@/lib/oc-filename";

// ESPEJO de backend/tests/unit/test_oc_filename_util.py — mismos casos, mismos
// resultados esperados. Si un caso pasa acá y falla allá (o al revés), backend
// y frontend divergieron y el usuario ve un nombre distinto según por dónde
// descargue (`a.download` pisa el Content-Disposition).

describe("ocPdfFilename", () => {
  it("no duplica el prefijo cuando el número ya empieza con OC", () => {
    // Los 3 números reales de producción ya empiezan con "OC".
    expect(ocPdfFilename("OC-FLUJO-COMPLETO-9901")).toBe(
      "OC-FLUJO-COMPLETO-9901.pdf",
    );
    expect(ocPdfFilename("OC0041-PAN001")).toBe("OC0041-PAN001.pdf");
    expect(ocPdfFilename("OC")).toBe("OC.pdf");
  });

  it("normaliza el prefijo a mayúscula sin duplicarlo", () => {
    expect(ocPdfFilename("oc0041-PAN001")).toBe("OC0041-PAN001.pdf");
    expect(ocPdfFilename("oC-123")).toBe("OC-123.pdf");
  });

  it("antepone OC- cuando el número no lo trae", () => {
    expect(ocPdfFilename("1234")).toBe("OC-1234.pdf");
    expect(ocPdfFilename("2026-001")).toBe("OC-2026-001.pdf");
    // 'OCTUBRE' no es el prefijo: OC seguido de letra no cuenta.
    expect(ocPdfFilename("OCTUBRE-01")).toBe("OC-OCTUBRE-01.pdf");
  });

  it("colapsa los espacios a guion bajo", () => {
    expect(
      ocPdfFilename("OC0041-PAN001-Comercializadora los Canelos jv"),
    ).toBe("OC0041-PAN001-Comercializadora_los_Canelos_jv.pdf");
    expect(ocPdfFilename("  1234   con    espacios  ")).toBe(
      "OC-1234_con_espacios.pdf",
    );
  });

  it("conserva las tildes (Panimávida)", () => {
    expect(ocPdfFilename("OC-2026-Panimávida")).toBe(
      "OC-2026-Panimávida.pdf",
    );
  });

  it("reemplaza los caracteres que Windows prohíbe", () => {
    expect(ocPdfFilename('12/34\\56:78*90?A"B<C>D|E')).toBe(
      "OC-12-34-56-78-90-A-B-C-D-E.pdf",
    );
    const conControles = `123${String.fromCharCode(0)}${String.fromCharCode(31)}456`;
    expect(ocPdfFilename(conControles)).toBe("OC-123--456.pdf");
  });

  it("cae al fallback cuando no queda nada usable", () => {
    expect(ocPdfFilename("///")).toBe("OC.pdf");
    expect(ocPdfFilename("")).toBe("OC.pdf");
    expect(ocPdfFilename("   ")).toBe("OC.pdf");
    expect(ocPdfFilename(null)).toBe("OC.pdf");
    expect(ocPdfFilename(undefined)).toBe("OC.pdf");
  });

  it("no pierde el 0 (chequeo explícito de null, no ||)", () => {
    expect(ocPdfFilename(0)).toBe("OC-0.pdf");
    expect(ocPdfFilename("0")).toBe("OC-0.pdf");
  });

  it("no deja punto ni espacio al final del stem", () => {
    expect(ocPdfFilename("1234. ")).toBe("OC-1234.pdf");
  });

  it("trunca los números absurdamente largos", () => {
    const filename = ocPdfFilename("X".repeat(500));
    expect(filename.startsWith("OC-XXX")).toBe(true);
    expect(filename.endsWith(".pdf")).toBe(true);
    expect(filename.length).toBeLessThanOrEqual(124);
  });
});
