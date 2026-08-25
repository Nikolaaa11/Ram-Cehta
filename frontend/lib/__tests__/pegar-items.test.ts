/**
 * Pegado de ítems desde Excel.
 *
 * Los casos con números NO son inventados: son formatos que Excel produce de
 * verdad en una máquina con configuración regional chilena, donde el punto es
 * separador de MILES y la coma es el decimal — al revés que en inglés.
 * Interpretar `1.234` mal cambia el monto por mil, en un documento que el
 * proveedor firma.
 */
import { describe, expect, it } from "vitest";

import {
  limpiarCeros,
  normalizarNumero,
  parsearItemsPegados,
} from "@/lib/oc/pegar-items";

describe("normalizarNumero — el punto es MILES en Chile", () => {
  it("interpreta el formato chileno", () => {
    expect(normalizarNumero("1.234.567")).toBe("1234567");
    expect(normalizarNumero("$1.234.567")).toBe("1234567");
    expect(normalizarNumero("1.234.567,89")).toBe("1234567.89");
    expect(normalizarNumero("40.855")).toBe("40855");
  });

  it("interpreta también el formato inglés, por el separador más a la derecha", () => {
    // Si vienen los dos, manda el que está más a la derecha.
    expect(normalizarNumero("1,234.56")).toBe("1234.56");
    expect(normalizarNumero("1.234,56")).toBe("1234.56");
  });

  it("una sola coma siempre es decimal", () => {
    // En Chile nadie escribe la coma como separador de miles.
    expect(normalizarNumero("2,5")).toBe("2.5");
    expect(normalizarNumero("0,25")).toBe("0.25");
  });

  it("un solo punto se decide por cuántos dígitos lo siguen", () => {
    // El caso ambiguo, y el que más plata puede costar.
    expect(normalizarNumero("1.234")).toBe("1234"); // 3 dígitos -> miles
    expect(normalizarNumero("1.5")).toBe("1.5"); //    1 dígito  -> decimal
    expect(normalizarNumero("1.50")).toBe("1.50"); //  2 dígitos -> decimal
    expect(normalizarNumero("1.2345")).toBe("1.2345"); // 4       -> decimal
  });

  it("limpia símbolos, espacios y comillas de Excel", () => {
    expect(normalizarNumero(' "$ 40.855" ')).toBe("40855");
    expect(normalizarNumero("$ 1 234")).toBe("1234");
  });

  it("devuelve vacío cuando no hay ningún dígito", () => {
    // Un campo vacío se ve mejor que NaN o que un 0 que nadie escribió.
    for (const basura of ["", "   ", "—", "n/a", "$"]) {
      expect(normalizarNumero(basura)).toBe("");
    }
  });

  it("conserva el signo negativo", () => {
    expect(normalizarNumero("-1.234")).toBe("-1234");
  });
});

describe("limpiarCeros — sin decimales, sólo el número", () => {
  it("saca los ceros que no aportan", () => {
    expect(limpiarCeros("1.0000")).toBe("1");
    expect(limpiarCeros("2.50")).toBe("2.5");
    expect(limpiarCeros("50.000")).toBe("50");
  });

  it("no toca un entero ni un decimal significativo", () => {
    expect(limpiarCeros("1")).toBe("1");
    expect(limpiarCeros("2.5")).toBe("2.5");
    expect(limpiarCeros("")).toBe("");
  });

  it("un cero sigue siendo cero", () => {
    // La trampa del cero falso: "0.00" no puede quedar en "" ni desaparecer.
    expect(limpiarCeros("0.00")).toBe("0");
    expect(limpiarCeros("0")).toBe("0");
  });
});

describe("parsearItemsPegados", () => {
  it("interpreta una selección de Excel de 4 columnas", () => {
    const pegado = [
      "Retiro y valorización de residuos\t50\tTon\t$40.000",
      "Análisis de caracterización\t1\tGl\t$500.000",
    ].join("\n");
    expect(parsearItemsPegados(pegado)).toEqual([
      {
        descripcion: "Retiro y valorización de residuos",
        cantidad: "50",
        unidad: "Ton",
        precio_unitario: "40000",
      },
      {
        descripcion: "Análisis de caracterización",
        cantidad: "1",
        unidad: "Gl",
        precio_unitario: "500000",
      },
    ]);
  });

  it("tolera menos columnas de las esperadas", () => {
    const r = parsearItemsPegados("Solo descripción\nOtra más");
    expect(r).toHaveLength(2);
    expect(r[0]!.descripcion).toBe("Solo descripción");
    expect(r[0]!.precio_unitario).toBe("");
  });

  it("descarta la fila de encabezados si vino seleccionada", () => {
    const pegado = [
      "Descripción\tCantidad\tUnidad\tPrecio unitario",
      "Fosa séptica\t1\tGl\t2.925.000",
    ].join("\n");
    const r = parsearItemsPegados(pegado);
    expect(r).toHaveLength(1);
    expect(r[0]!.descripcion).toBe("Fosa séptica");
  });

  it("NO descarta un ítem cuya descripción menciona 'cantidad'", () => {
    // El filtro de encabezados exige 2+ rótulos Y ninguna cifra: una
    // descripción real casi siempre trae un número.
    const r = parsearItemsPegados("Ajuste de cantidad de unidad 3\t2\tUn\t100");
    expect(r).toHaveLength(1);
    expect(r[0]!.descripcion).toBe("Ajuste de cantidad de unidad 3");
  });

  it("una celda con salto de línea es UN ítem, no dos", () => {
    // Excel encierra entre comillas cualquier celda con saltos internos.
    const pegado = '"Retiro de residuos\nsegún protocolo"\t2\tUn\t1.000';
    const r = parsearItemsPegados(pegado);
    expect(r).toHaveLength(1);
    expect(r[0]!.descripcion).toBe("Retiro de residuos\nsegún protocolo");
    expect(r[0]!.cantidad).toBe("2");
  });

  it("respeta las comillas escapadas de Excel", () => {
    const r = parsearItemsPegados('"Cañería de 3"" pulgadas"\t1\tUn\t500');
    expect(r[0]!.descripcion).toBe('Cañería de 3" pulgadas');
  });

  it("saltea filas vacías", () => {
    const r = parsearItemsPegados("Uno\t1\tUn\t100\n\n\t\t\t\nDos\t2\tUn\t200");
    expect(r).toHaveLength(2);
  });

  it("no se hace cargo de un pegado normal de una sola palabra", () => {
    // Si alguien pega "Hormigón" dentro de un campo, tiene que comportarse
    // como el pegado del navegador de siempre, no crear un ítem.
    expect(parsearItemsPegados("Hormigón")).toEqual([]);
    expect(parsearItemsPegados("  ")).toEqual([]);
    expect(parsearItemsPegados("")).toEqual([]);
  });

  it("acepta CSV con punto y coma (exportación regional chilena)", () => {
    const r = parsearItemsPegados("Fosa séptica;1;Gl;2.925.000\nApoyo;3;Días;240.000");
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({
      descripcion: "Apoyo",
      cantidad: "3",
      unidad: "Días",
      precio_unitario: "240000",
    });
  });

  it("no pone un número como unidad de medida", () => {
    // Si el orden de columnas no era el esperado, prefiere dejarla vacía
    // antes que imprimir "50" como unidad en el PDF.
    const r = parsearItemsPegados("Algo\t2\t50\t100");
    expect(r[0]!.unidad).toBe("");
  });

  it("los montos pegados no pierden ni ganan un factor mil", () => {
    // La verificación que importa: lo que se pega es lo que se cobra.
    const r = parsearItemsPegados("Servicio\t1\tGl\t$2.925.000");
    expect(Number(r[0]!.precio_unitario)).toBe(2_925_000);
  });
});
