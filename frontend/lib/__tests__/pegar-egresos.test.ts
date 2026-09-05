/**
 * Pegado de gastos desde el Excel de Claudia.
 *
 * Los casos reproducen lo que trae el Excel de verdad (§1.2 del spec):
 * estados con símbolo, `\xa0` al final de los nombres, folios numéricos,
 * montos con puntos de miles y coma decimal, totales con 4 decimales,
 * "Boletas" y "Boleta", "liquidación" en minúscula. Y las dos variantes de
 * columnas (REVTECH 16, TRONGKAI 17 con Trewaox).
 */
import { describe, expect, it } from "vitest";

import {
  columnaPorNombre,
  egresoPegadoAFila,
  parsearEgresosPegados,
  parsearEstadoPago,
  parsearFecha,
  parsearMonto,
  parsearRut,
  parsearTipoDocumento,
  totalPegado,
  trocearLotes,
} from "@/lib/claudia/pegar-egresos";
import { BATCH_MAX_FILAS, LARGO_MAX } from "@/lib/claudia/types";

const ENCABEZADO_REVTECH =
  "Fecha\tDescripción\tRUT Emisor\tTipo de Documento\tFolio\tMonto Neto/Pagado\tImpuesto/Patronal\tTotal\tTipo de Egreso\tFuente\tProyecto\tSubsidio\tCehta-Ptec\tCehta\tEstado\tFecha de Pago";

// MCG, ago-2026, tal cual sale del Excel de REVTECH (RUT con puntos, \xa0).
const FILA_MCG =
  "27-08-2026\tMCG AUDITORES CONSULTORES SPA \t76.642.280-2\tFactura\t10540\t79.287\t15.065\t94.352\tCehta\tCehta\tCehta\t\t\t94.352\t✓ Pagado\t08-01-2026";

describe("parsearFecha", () => {
  it("acepta dd-mm-yyyy, dd/mm/yyyy y yyyy-mm-dd", () => {
    expect(parsearFecha("03-11-2025")).toBe("2025-11-03");
    expect(parsearFecha("3/11/2025")).toBe("2025-11-03");
    expect(parsearFecha("03.11.2025")).toBe("2025-11-03");
    expect(parsearFecha("2025-11-03")).toBe("2025-11-03");
    expect(parsearFecha("2025-11-03 00:00:00")).toBe("2025-11-03");
    expect(parsearFecha("03-11-25")).toBe("2025-11-03");
  });

  it("rechaza lo que no es una fecha real", () => {
    // Excel trae 2 filas de REVTECH con fecha inválida: se marcan, no se inventan.
    expect(parsearFecha("31-02-2026")).toBe("");
    expect(parsearFecha("Pendiente")).toBe("");
    expect(parsearFecha("")).toBe("");
    expect(parsearFecha("13/13/2025")).toBe("");
  });
});

describe("parsearMonto — puntos de miles y 2 decimales", () => {
  it("interpreta el formato chileno y normaliza a 2 decimales", () => {
    expect(parsearMonto("94.352")).toBe("94352.00");
    expect(parsearMonto("$1.234.567")).toBe("1234567.00");
    expect(parsearMonto("1.234.567,5")).toBe("1234567.50");
    expect(parsearMonto("5645105.9504")).toBe("5645105.95"); // total desde UF
    expect(parsearMonto("")).toBe("");
    expect(parsearMonto("—")).toBe("");
  });
});

describe("parsearTipoDocumento", () => {
  it("normaliza las variantes del Excel", () => {
    expect(parsearTipoDocumento("Factura")).toEqual({ codigo: "FACTURA", reconocido: true });
    expect(parsearTipoDocumento("Factura Exenta")).toEqual({ codigo: "FACTURA_EXENTA", reconocido: true });
    expect(parsearTipoDocumento("Boletas")).toEqual({ codigo: "BOLETA", reconocido: true });
    expect(parsearTipoDocumento("Boleta")).toEqual({ codigo: "BOLETA", reconocido: true });
    expect(parsearTipoDocumento("Boleta Honorario")).toEqual({ codigo: "BOLETA_HONORARIO", reconocido: true });
    expect(parsearTipoDocumento("liquidación")).toEqual({ codigo: "LIQUIDACION", reconocido: true });
    expect(parsearTipoDocumento("Co-Ejecutor")).toEqual({ codigo: "CO_EJECUTOR", reconocido: true });
    expect(parsearTipoDocumento("Invoice")).toEqual({ codigo: "INVOICE", reconocido: true });
  });

  it("lo desconocido queda como OTRO y se avisa", () => {
    expect(parsearTipoDocumento("Recibo simple")).toEqual({ codigo: "OTRO", reconocido: false });
    expect(parsearTipoDocumento("")).toEqual({ codigo: "OTRO", reconocido: true });
  });
});

describe("parsearEstadoPago — símbolos del Excel", () => {
  it("lee el símbolo o la palabra", () => {
    expect(parsearEstadoPago("✓ Pagado").codigo).toBe("PAGADO");
    expect(parsearEstadoPago("◑ Pagado Parcial").codigo).toBe("PARCIAL");
    expect(parsearEstadoPago("✗ Pendiente").codigo).toBe("PENDIENTE");
    expect(parsearEstadoPago("pagado").codigo).toBe("PAGADO");
    expect(parsearEstadoPago("Parcial").codigo).toBe("PARCIAL");
    expect(parsearEstadoPago("").codigo).toBe("PENDIENTE");
  });
});

describe("parsearRut", () => {
  it("saca puntos, deja el guion y la K en mayúscula", () => {
    expect(parsearRut("76.642.280-2")).toBe("76642280-2");
    expect(parsearRut("766422802")).toBe("76642280-2");
    expect(parsearRut("12.345.678-k")).toBe("12345678-K");
    expect(parsearRut("")).toBe("");
  });
});

describe("columnaPorNombre — las dos variantes de encabezados", () => {
  it("reconoce los rótulos de REVTECH y TRONGKAI sin importar acentos", () => {
    expect(columnaPorNombre("Fecha")).toBe("fecha");
    expect(columnaPorNombre("Fecha de Pago")).toBe("fecha_pago");
    expect(columnaPorNombre("DESCRIPCIÓN")).toBe("descripcion");
    expect(columnaPorNombre("RUT Emisor")).toBe("rut_emisor");
    expect(columnaPorNombre("Tipo de Documento")).toBe("tipo_documento");
    expect(columnaPorNombre("Monto Neto/Pagado")).toBe("monto_neto");
    expect(columnaPorNombre("Impuesto/Patronal")).toBe("impuesto");
    expect(columnaPorNombre("Tipo de Egreso")).toBe("tipo_egreso");
    expect(columnaPorNombre("Tipo Financiamiento")).toBe("fuente");
    expect(columnaPorNombre("Fuente")).toBe("fuente");
    expect(columnaPorNombre("Trewaox")).toBe("trewaox");
    expect(columnaPorNombre("Cehta-Ptec")).toBe("cehta_ptec");
    expect(columnaPorNombre("Cehta")).toBe("cehta");
    expect(columnaPorNombre("Estado")).toBe("estado_pago");
    expect(columnaPorNombre("Comentario interno")).toBe("ignorar");
  });
});

describe("parsearEgresosPegados", () => {
  it("una sola línea sin tabs es un pegado común: no se interpreta", () => {
    expect(parsearEgresosPegados("MCG AUDITORES").filas).toEqual([]);
    expect(parsearEgresosPegados("").filas).toEqual([]);
  });

  it("sin encabezado, 16 columnas = orden REVTECH", () => {
    const r = parsearEgresosPegados(FILA_MCG);
    expect(r.conEncabezado).toBe(false);
    expect(r.filas).toHaveLength(1);
    const f = r.filas[0]!;
    expect(f.errores).toEqual([]);
    expect(f.fecha).toBe("2026-08-27");
    expect(f.descripcion).toBe("MCG AUDITORES CONSULTORES SPA"); // sin el \xa0
    expect(f.rut_emisor).toBe("76642280-2");
    expect(f.tipo_documento).toBe("FACTURA");
    expect(f.folio).toBe("10540");
    expect(f.monto_neto).toBe("79287.00");
    expect(f.impuesto).toBe("15065.00");
    expect(f.total).toBe("94352.00");
    expect(f.tipo_egreso).toBe("Cehta");
    expect(f.fuente).toBe("Cehta");
    expect(f.proyecto).toBe("Cehta");
    // Una fuente con valor: las otras pasan a 0 (todo-o-nada).
    expect(f.reparto).toEqual({
      subsidio: "0.00",
      cehta_ptec: "0.00",
      cehta: "94352.00",
      trewaox: "0.00",
    });
    expect(f.estado_pago).toBe("PAGADO");
    expect(f.fecha_pago).toBe("2026-01-08");
  });

  it("con encabezado, las columnas se reconocen por nombre", () => {
    const r = parsearEgresosPegados(`${ENCABEZADO_REVTECH}\n${FILA_MCG}`);
    expect(r.conEncabezado).toBe(true);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]!.fila).toBe(1);
    expect(r.filas[0]!.total).toBe("94352.00");
    expect(r.filas[0]!.estado_pago).toBe("PAGADO");
  });

  it("con encabezado en otro orden, igual acierta", () => {
    const texto =
      "Total\tDescripción\tFecha\tEstado\n" +
      "1.000\tArriendo oficina\t2025-11-01\t✗ Pendiente";
    const f = parsearEgresosPegados(texto).filas[0]!;
    expect(f.total).toBe("1000.00");
    expect(f.descripcion).toBe("Arriendo oficina");
    expect(f.fecha).toBe("2025-11-01");
    expect(f.estado_pago).toBe("PENDIENTE");
    expect(f.reparto).toBeNull();
    expect(f.errores).toEqual([]);
  });

  it("17 columnas sin encabezado = orden TRONGKAI (Trewaox antes de Subsidio)", () => {
    const fila =
      "01-11-2025\tCENTRO TECNOLOGICO\t77.221.203-8\tFactura\t55\t2.828.673\t0\t2.828.673\tInnovaRegion\tServicios\tTrewaox\t2.376.934\t\t\t451.739\t✓ Pagado\t";
    const f = parsearEgresosPegados(fila).filas[0]!;
    expect(f.fuente).toBe("InnovaRegion"); // Tipo Financiamiento
    expect(f.tipo_egreso).toBe("Servicios");
    expect(f.proyecto).toBe("Trewaox");
    expect(f.reparto).toEqual({
      subsidio: "0.00",
      cehta_ptec: "0.00",
      cehta: "451739.00",
      trewaox: "2376934.00",
    });
    expect(f.avisos).toEqual([]);
    expect(f.errores).toEqual([]);
  });

  it("las 4 fuentes vacías → sin clasificar (null), no ceros", () => {
    const f = parsearEgresosPegados(
      "03-11-2025\tPROGARANTIA\t\tFactura\t1\t\t\t9.935.822\t\t\t\t\t\t\t\t",
    ).filas[0]!;
    expect(f.reparto).toBeNull();
    expect(f.monto_neto).toBe("");
    expect(f.errores).toEqual([]);
  });

  it("marca las filas que la API rechazaría, sin tirar las demás", () => {
    const texto = [
      "31-02-2026\tFecha imposible\t\tFactura\t1\t\t\t1.000\t\t\t\t\t\t\t\t",
      "03-11-2025\t\t\tFactura\t2\t\t\t1.000\t\t\t\t\t\t\t\t",
      "03-11-2025\tSin total\t\tFactura\t3\t\t\t\t\t\t\t\t\t\t\t",
      "03-11-2025\tRUT malo\t76.642.280-3\tFactura\t4\t\t\t1.000\t\t\t\t\t\t\t\t",
      "03-11-2025\tNeto+imp no cierra\t\tFactura\t5\t100\t19\t120\t\t\t\t\t\t\t\t",
      "03-11-2025\tLa buena\t\tBoletas\t6\t\t\t1.000\t\t\t\t\t\t\t\t",
    ].join("\n");
    const r = parsearEgresosPegados(texto);
    expect(r.filas).toHaveLength(6);
    expect(r.filas[0]!.errores.join(" ")).toMatch(/fecha/i);
    expect(r.filas[1]!.errores.join(" ")).toMatch(/descripci/i);
    expect(r.filas[2]!.errores.join(" ")).toMatch(/total/i);
    expect(r.filas[3]!.errores.join(" ")).toMatch(/RUT/);
    expect(r.filas[4]!.errores.join(" ")).toMatch(/Neto \+ impuesto/);
    expect(r.filas[5]!.errores).toEqual([]);
    expect(r.filas[5]!.tipo_documento).toBe("BOLETA");
    expect(r.filas[5]!.fila).toBe(6);
  });

  it("una fila que excede los largos de la API se marca como 'no se va a agregar' con motivo", () => {
    const larga = "X".repeat(LARGO_MAX.descripcion + 1);
    const folioLargo = "9".repeat(LARGO_MAX.folio + 1);
    const texto = [
      `03-11-2025\t${larga}\t\tFactura\t1\t\t\t1.000\t\t\t\t\t\t\t\t`,
      `03-11-2025\tFolio largo\t\tFactura\t${folioLargo}\t\t\t1.000\t\t\t\t\t\t\t\t`,
      `03-11-2025\tProyecto largo\t\tFactura\t3\t\t\t1.000\t\t\t${"P".repeat(121)}\t\t\t\t\t`,
      `03-11-2025\tJusto en el límite\t\tFactura\t${"4".repeat(LARGO_MAX.folio)}\t\t\t1.000\t\t\t\t\t\t\t\t`,
    ].join("\n");
    const r = parsearEgresosPegados(texto);
    expect(r.filas[0]!.errores.join(" ")).toMatch(/Descripción tiene 501 caracteres y el máximo es 500/);
    expect(r.filas[1]!.errores.join(" ")).toMatch(/Folio tiene 51 caracteres y el máximo es 50/);
    expect(r.filas[2]!.errores.join(" ")).toMatch(/Proyecto tiene 121 caracteres y el máximo es 120/);
    expect(r.filas[3]!.errores).toEqual([]);
  });

  it("un reparto que no suma el total no bloquea: avisa y queda sin clasificar", () => {
    // El Excel tiene 2 + 17 filas así. Inventar el reparto sería mentirle a CORFO.
    const f = parsearEgresosPegados(
      "03-11-2025\tDescuadrado\t\tFactura\t1\t\t\t1.000\t\t\t\t500\t\t400\t\t",
    ).filas[0]!;
    expect(f.errores).toEqual([]);
    expect(f.avisos.join(" ")).toMatch(/no suma el total/);
    const fila = egresoPegadoAFila(f);
    expect(fila.reparto).toBeUndefined();
    expect(fila.observaciones).toMatch(/Reparto pegado que no cuadra/);
  });

  it("filas vacías y \\r\\n de Windows no crean gastos fantasma", () => {
    const r = parsearEgresosPegados(`${FILA_MCG}\r\n\r\n\t\t\t\r\n${FILA_MCG}\r\n`);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[1]!.fila).toBe(2);
  });

  it("una descripción con salto de línea entre comillas es UNA fila", () => {
    const texto =
      '03-11-2025\t"Retiro de residuos\nsegún protocolo"\t\tFactura\t9\t\t\t1.000\t\t\t\t\t\t\t\t';
    const r = parsearEgresosPegados(texto);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]!.descripcion).toBe("Retiro de residuos\nsegún protocolo");
  });
});

describe("egresoPegadoAFila → cuerpo de POST /batch", () => {
  it("arma la fila con origen PASTE y null en lo vacío", () => {
    const f = parsearEgresosPegados(FILA_MCG).filas[0]!;
    const fila = egresoPegadoAFila(f);
    expect(fila).toEqual({
      fecha: "2026-08-27",
      descripcion: "MCG AUDITORES CONSULTORES SPA",
      rut_emisor: "76642280-2",
      tipo_documento: "FACTURA",
      folio: "10540",
      monto_neto: "79287.00",
      impuesto: "15065.00",
      total: "94352.00",
      tipo_egreso: "Cehta",
      fuente: "Cehta",
      proyecto: "Cehta",
      estado_pago: "PAGADO",
      fecha_pago: "2026-01-08",
      observaciones: null,
      origen: "PASTE",
      reparto: { subsidio: "0.00", cehta_ptec: "0.00", cehta: "94352.00", trewaox: "0.00" },
    });
  });

  it("el tipo de documento original desconocido va a observaciones", () => {
    const f = parsearEgresosPegados(
      "03-11-2025\tAlgo\t\tRecibo simple\t\t\t\t500\t\t\t\t\t\t\t\t",
    ).filas[0]!;
    const fila = egresoPegadoAFila(f);
    expect(fila.tipo_documento).toBe("OTRO");
    expect(fila.observaciones).toBe("Tipo de documento original: Recibo simple");
    expect(fila.folio).toBeNull();
    expect(fila.rut_emisor).toBeNull();
  });

  it("totalPegado suma en centavos enteros", () => {
    const r = parsearEgresosPegados(`${FILA_MCG}\n${FILA_MCG}`);
    expect(totalPegado(r.filas)).toBe(18_870_400);
  });
});

describe("trocearLotes → un POST /batch por cada 500 filas", () => {
  it("parte en lotes de 500, en orden, sin perder ni repetir filas", () => {
    const filas = Array.from({ length: 1201 }, (_, i) => i);
    const lotes = trocearLotes(filas);
    expect(BATCH_MAX_FILAS).toBe(500);
    expect(lotes.map((l) => l.length)).toEqual([500, 500, 201]);
    expect(lotes.flat()).toEqual(filas);
  });

  it("hasta 500 filas es un solo lote; vacío es cero lotes", () => {
    expect(trocearLotes(Array.from({ length: 500 }, (_, i) => i))).toHaveLength(1);
    expect(trocearLotes([])).toEqual([]);
  });
});
