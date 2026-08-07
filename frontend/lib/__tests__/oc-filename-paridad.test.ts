/**
 * Test de PARIDAD frontend↔backend del nombre del PDF de la OC.
 *
 * Lee el MISMO snapshot que `backend/tests/unit/test_oc_filename_paridad.py`
 * (`backend/tests/fixtures/oc_filename_esperado.json`). Si alguien toca una de
 * las dos implementaciones y no la otra, uno de los dos suites falla.
 *
 * Por qué importa: en las descargas por blob el atributo `a.download` de este
 * frontend PISA el `Content-Disposition` del backend. Si divergen, el archivo
 * que baja el usuario tiene un nombre distinto al del adjunto que le llega por
 * correo, y nadie lo nota hasta que alguien compara los dos.
 *
 * Trampa conocida que este test cubre: `\s` no significa lo mismo en JS que en
 * Python (JS matchea U+FEFF y no U+0085; Python al revés), por eso las dos
 * implementaciones enumeran la clase de whitespace en vez de usar `\s`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ocPdfFilename } from "../oc-filename";

const snapshotPath = resolve(
  __dirname,
  "../../../backend/tests/fixtures/oc_filename_esperado.json",
);
const casos: Record<string, string> = JSON.parse(
  readFileSync(snapshotPath, "utf8"),
).casos;

describe("ocPdfFilename · paridad con el backend", () => {
  it("el snapshot compartido existe y no está vacío", () => {
    // Si el fixture se mueve o se vacía, este test avisa en vez de que los
    // `it.each` de abajo pasen trivialmente sobre 0 casos.
    expect(Object.keys(casos).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(casos))(
    "%j produce el mismo nombre que el backend",
    (numeroOc, esperado) => {
      expect(ocPdfFilename(numeroOc)).toBe(esperado);
    },
  );

  it("nunca duplica el prefijo OC en los números reales de producción", () => {
    for (const real of [
      "OC-FLUJO-COMPLETO-9901",
      "OC0041-PAN001-Comercializadora los Canelos jv",
    ]) {
      expect(ocPdfFilename(real).toUpperCase().startsWith("OC-OC")).toBe(false);
    }
  });
});
