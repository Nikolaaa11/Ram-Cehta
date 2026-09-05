/**
 * Smoke test de RENDER de /claudia/egresos (la pantalla de Claudia).
 *
 * Por qué existe: en esta plataforma ya se escaparon dos bugs críticos de
 * páginas que no abrían aunque `tsc` y el build pasaran (memoria:
 * "verificar la UI, no sólo la API"). Un E2E que pega a los endpoints no
 * prueba la pantalla; esto la monta de verdad con React + jsdom y una API
 * falsa que responde con la forma EXACTA del contrato (§3.3 del spec):
 *
 *   - la página renderiza sin lanzar y muestra las 2 descripciones,
 *   - los chips de meses y el KPI de total aparecen,
 *   - click en la fila abre la ficha (pestañas Gasto / CORFO / Historial),
 *   - un mes con 0 gastos muestra el vacío honesto, no ceros en verde.
 *
 * Más abajo, la regresión de la grilla (U1): tras confirmar una celda con
 * Enter, la SIGUIENTE celda abandonada con click (blur) tiene que guardarse.
 * Antes una bandera "saltar el próximo blur" quedaba pegada y se comía ese
 * guardado, porque React 19 no despacha el blur del input que se desmonta.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  CatalogosResponse,
  EgresoDetalle,
  EgresoRead,
  EgresosListResponse,
  EgresoUpdate,
  PeriodosResponse,
  ResumenResponse,
} from "@/lib/claudia/types";

// ── Datos falsos con la forma del contrato (§3.3) ────────────────────────
// `vi.hoisted` porque los factories de `vi.mock` se izan por encima de los
// imports y no pueden ver constantes comunes del módulo.
const fake = vi.hoisted(() => {
  const corfoVacio = {
    cuenta: null,
    item: null,
    fuente_financiamiento: null,
    etapa: null,
    fecha_recepcion: null,
    monto_rendir: null,
    monto_cancelado: null,
    forma_pago: null,
    glosa: null,
    receptor_rut: null,
    receptor_nombre: null,
  };
  const egresoOk: EgresoRead = {
    egreso_id: 1,
    empresa_codigo: "REVTECH",
    periodo: "2026-08",
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
    reparto: { subsidio: "0.00", cehta_ptec: "0.00", cehta: "94352.00", trewaox: "0.00" },
    reparto_pct: { subsidio: "0.00", cehta_ptec: "0.00", cehta: "100.00", trewaox: "0.00" },
    reparto_estado: "OK",
    corfo: corfoVacio,
    observaciones: null,
    adjunto_dropbox_path: null,
    origen: "IMPORT_EXCEL",
    neto_mas_impuesto_cuadra: true,
    created_at: "2026-09-01T10:00:00Z",
    created_by: "claudia@trongkai.com",
    updated_at: "2026-09-01T10:00:00Z",
    updated_by: "claudia@trongkai.com",
    version: 2,
  };
  // PROYECTA con un reparto que NO suma el total (590.756 ≠ 590.777) y
  // neto + impuesto que tampoco cuadran: es lo que trae el Excel real.
  const egresoDescuadrado: EgresoRead = {
    ...egresoOk,
    egreso_id: 2,
    fecha: "2026-08-10",
    descripcion: "PROYECTA SPA",
    rut_emisor: null,
    tipo_documento: "BOLETA_HONORARIO",
    folio: "77",
    monto_neto: "500000.00",
    impuesto: "100000.00",
    total: "590777.00",
    estado_pago: "PENDIENTE",
    fecha_pago: null,
    reparto: { subsidio: "496430.00", cehta_ptec: "0.00", cehta: "94326.00", trewaox: "0.00" },
    reparto_pct: { subsidio: "84.03", cehta_ptec: "0.00", cehta: "15.97", trewaox: "0.00" },
    reparto_estado: "DESCUADRADO",
    neto_mas_impuesto_cuadra: false,
    version: 1,
  };
  const lista: EgresosListResponse = {
    empresa_codigo: "REVTECH",
    periodo: "2026-08",
    items: [egresoOk, egresoDescuadrado],
    n: 2,
    truncado: false,
  };
  const periodos: PeriodosResponse = {
    items: [
      { periodo: "2026-08", n: 2, total: "685129.00", pendiente: "590777.00", sin_clasificar: 0, descuadrados: 1 },
      { periodo: "2026-07", n: 3, total: "1200000.00", pendiente: "0.00", sin_clasificar: 1, descuadrados: 0 },
    ],
    n_total: 5,
    total_general: "1885129.00",
  };
  const resumen: ResumenResponse = {
    empresa_codigo: "REVTECH",
    periodo: "2026-08",
    n: 2,
    total: "685129.00",
    por_fuente: { subsidio: "496430.00", cehta_ptec: "0.00", cehta: "188678.00", trewaox: "0.00", sin_clasificar: "0.00" },
    por_estado: {
      PAGADO: { n: 1, monto: "94352.00" },
      PARCIAL: { n: 0, monto: "0.00" },
      PENDIENTE: { n: 1, monto: "590777.00" },
    },
    pct_pagado: "13.77",
    por_tipo_documento: [
      { tipo_documento: "FACTURA", n: 1, monto: "94352.00" },
      { tipo_documento: "BOLETA_HONORARIO", n: 1, monto: "590777.00" },
    ],
    descuadrados: 1,
    sin_clasificar: 0,
  };
  const catalogos: CatalogosResponse = {
    tipos_documento: [
      { codigo: "FACTURA", label: "Factura" },
      { codigo: "BOLETA", label: "Boleta" },
      { codigo: "BOLETA_HONORARIO", label: "Boleta de honorarios" },
    ],
    estados_pago: [
      { codigo: "PAGADO", label: "Pagado" },
      { codigo: "PARCIAL", label: "Pagado parcial" },
      { codigo: "PENDIENTE", label: "Pendiente" },
    ],
    fuentes: [
      { codigo: "subsidio", label: "Subsidio CORFO" },
      { codigo: "cehta_ptec", label: "Cehta · aporte P-tec" },
      { codigo: "cehta", label: "Cehta (fuera del subsidio)" },
    ],
    formas_pago: ["TRANSFERENCIA", "CHEQUE"],
    corfo: {
      cuenta_gastos: [{ codigo: "GASTOS DE OPERACION", label: "Gastos de operación" }, "INVERSION"],
      item_gastos: ["MATERIALES", "SERVICIOS", "OTROS"],
      etapa: ["ETAPA 1", "ETAPA 2"],
      tipo_doc_gastos: ["FACTURA", "BOLETA", "BOLETA HONORARIOS"],
      fuente_financiamiento_sugeridas: ["SUBSIDIO", "APORTE PECUNIARIO", "APORTE VALORIZADO"],
    },
    sugerencias: {
      tipo_egreso: ["Cehta", "Servicios"],
      fuente: ["Cehta", "Corfo"],
      proyecto: ["Cehta", "Trewaox"],
    },
  };
  const detalle: EgresoDetalle = {
    ...egresoOk,
    historial: [
      { version: 1, accion: "INSERT", changed_at: "2026-09-01T09:00:00Z", changed_by: "claudia@trongkai.com", cambios: [] },
      {
        version: 2,
        accion: "UPDATE",
        changed_at: "2026-09-01T10:00:00Z",
        changed_by: "claudia@trongkai.com",
        cambios: [{ campo: "monto_cehta", antes: "0.00", despues: "94352.00" }],
      },
    ],
  };
  return {
    /** Se cambia por test: `vacio = true` → la lista viene sin items. */
    estado: { vacio: false },
    llamadas: [] as string[],
    egresoOk,
    egresoDescuadrado,
    lista,
    periodos,
    resumen,
    catalogos,
    detalle,
  };
});

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({
    session: { access_token: "token-falso", user: { id: "u-claudia", email: "claudia@trongkai.com" } },
    loading: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {} }),
  usePathname: () => "/claudia/egresos",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly detail: string,
    ) {
      super(detail);
      this.name = "ApiError";
    }
  }
  const apiClient = {
    async get(path: string) {
      fake.llamadas.push(path);
      if (path.startsWith("/claudia/egresos/periodos")) return fake.periodos;
      if (path.startsWith("/claudia/egresos/resumen")) {
        return fake.estado.vacio
          ? { ...fake.resumen, n: 0, total: "0.00", descuadrados: 0, pct_pagado: null }
          : fake.resumen;
      }
      if (path.startsWith("/claudia/egresos/catalogos")) return fake.catalogos;
      if (/^\/claudia\/egresos\/\d+$/.test(path)) return fake.detalle;
      if (path.startsWith("/claudia/egresos?")) {
        return fake.estado.vacio ? { ...fake.lista, items: [], n: 0 } : fake.lista;
      }
      throw new ApiError(404, `Sin fake para GET ${path}`);
    },
    async post(path: string) {
      throw new ApiError(500, `Sin fake para POST ${path}`);
    },
    async put(path: string) {
      throw new ApiError(500, `Sin fake para PUT ${path}`);
    },
    async patch(path: string) {
      throw new ApiError(500, `Sin fake para PATCH ${path}`);
    },
    async delete(path: string) {
      throw new ApiError(500, `Sin fake para DELETE ${path}`);
    },
    async postForm(path: string) {
      throw new ApiError(500, `Sin fake para POST form ${path}`);
    },
  };
  return { apiClient, ApiError };
});

import RegistroEgresosPage from "@/app/(app)/claudia/egresos/page";
import { EgresosGrid } from "@/components/claudia/EgresosGrid";

function renderConQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
  // jsdom no implementa scrollIntoView; la grilla lo usa al mover el foco.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  fake.estado.vacio = false;
  fake.llamadas.length = 0;
  window.localStorage.clear();
});

describe("/claudia/egresos · smoke de render", () => {
  it("renderiza sin lanzar: descripciones, chips de meses y KPI de total", async () => {
    renderConQuery(<RegistroEgresosPage />);

    expect(await screen.findByText("MCG AUDITORES CONSULTORES SPA")).toBeInTheDocument();
    expect(screen.getByText("PROYECTA SPA")).toBeInTheDocument();

    // Chips de meses (tablist real) con "Todos" al inicio.
    const meses = screen.getByRole("tablist", { name: "Meses del registro" });
    expect(within(meses).getByRole("tab", { name: /Todos/ })).toBeInTheDocument();
    expect(within(meses).getByRole("tab", { name: /Ago 2026/ })).toHaveAttribute("aria-selected", "true");
    expect(within(meses).getByRole("tab", { name: /Jul 2026/ })).toBeInTheDocument();

    // KPI de total del mes.
    const kpis = await screen.findByRole("region", { name: "Indicadores del período" });
    expect(within(kpis).getByText("Total egresos")).toBeInTheDocument();
    expect(within(kpis).getByText("2 gastos")).toBeInTheDocument();
    // El descuadrado del mes se anuncia en tinta (con el punto ámbar al lado).
    expect(within(kpis).getByText(/1 descuadrados/)).toBeInTheDocument();

    // Los badges del reparto de cada fila.
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Descuadrado")).toBeInTheDocument();

    // La API se consultó con la empresa y el mes más reciente.
    expect(fake.llamadas.some((p) => p.startsWith("/claudia/egresos?") && p.includes("periodo=2026-08"))).toBe(true);
  });

  it("click en la fila abre la ficha con las pestañas Gasto / CORFO / Historial y el foco en Gasto", async () => {
    renderConQuery(<RegistroEgresosPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir ficha de MCG/ }));

    const tabGasto = await screen.findByRole("tab", { name: "Gasto" });
    expect(tabGasto).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "CORFO" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Historial/ })).toBeInTheDocument();
    // U2: al abrir, el foco entra al panel (pestaña Gasto), no se queda en la grilla.
    await waitFor(() => expect(tabGasto).toHaveFocus());
    // El editor de reparto está y no deja guardar sin cambios.
    expect(screen.getByRole("button", { name: "Guardar reparto" })).toBeDisabled();
    expect(fake.llamadas).toContain("/claudia/egresos/1");

    // U5: flechas mueven selección Y foco; End va a la última pestaña.
    fireEvent.keyDown(tabGasto, { key: "ArrowRight" });
    const tabCorfo = screen.getByRole("tab", { name: "CORFO" });
    await waitFor(() => expect(tabCorfo).toHaveAttribute("aria-selected", "true"));
    expect(tabCorfo).toHaveFocus();
    fireEvent.keyDown(tabCorfo, { key: "End" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /Historial/ })).toHaveAttribute("aria-selected", "true"),
    );
    expect(screen.getByRole("tab", { name: /Historial/ })).toHaveFocus();
  });

  it("un mes con 0 gastos muestra el vacío honesto, sin KPIs en verde", async () => {
    fake.estado.vacio = true;
    renderConQuery(<RegistroEgresosPage />);

    expect(await screen.findByText(/Todavía no hay gastos en Ago 2026 para REVTECH/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar el primer gasto" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Indicadores del período" })).toBeNull();
    expect(screen.queryByText("MCG AUDITORES CONSULTORES SPA")).toBeNull();
  });
});

describe("EgresosGrid · U1: la edición abandonada con click se guarda después de un Enter", () => {
  function renderGrilla(onActualizar: (id: number, patch: EgresoUpdate) => Promise<EgresoRead>) {
    return render(
      <EgresosGrid
        items={[fake.egresoOk, fake.egresoDescuadrado]}
        loading={false}
        empresa="REVTECH"
        periodo="2026-08"
        catalogos={fake.catalogos}
        mostrarTrewaox={false}
        onAbrir={() => {}}
        onActualizar={onActualizar}
        onCrear={async () => fake.egresoOk}
        onPegar={async () => {}}
        focoNuevo={0}
        vacio={null}
      />,
    );
  }

  it("Enter en una celda → editar otra → click afuera: onActualizar se llama la segunda vez", async () => {
    const onActualizar = vi.fn(async (id: number, patch: EgresoUpdate): Promise<EgresoRead> => {
      const base = id === 1 ? fake.egresoOk : fake.egresoDescuadrado;
      return { ...base, descripcion: patch.descripcion ?? base.descripcion };
    });
    const { container } = renderGrilla(onActualizar);

    // 1) Descripción de la fila 1, confirmada con Enter.
    const celda1 = container.querySelector<HTMLTableCellElement>('td[data-fila="1"][data-col="1"]')!;
    expect(celda1).not.toBeNull();
    fireEvent.keyDown(celda1, { key: "Enter" });
    const input1 = await screen.findByRole("textbox", { name: "Descripción" });
    fireEvent.change(input1, { target: { value: "MCG editado" } });
    fireEvent.keyDown(input1, { key: "Enter" });
    await waitFor(() => expect(onActualizar).toHaveBeenCalledTimes(1));
    expect(onActualizar).toHaveBeenLastCalledWith(1, { descripcion: "MCG editado" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Descripción" })).toBeNull());

    // 2) Descripción de la fila 2, abandonada con click afuera (blur).
    const celda2 = container.querySelector<HTMLTableCellElement>('td[data-fila="2"][data-col="1"]')!;
    fireEvent.keyDown(celda2, { key: "Enter" });
    const input2 = await screen.findByRole("textbox", { name: "Descripción" });
    fireEvent.change(input2, { target: { value: "PROYECTA editado" } });
    fireEvent.blur(input2);
    await waitFor(() => expect(onActualizar).toHaveBeenCalledTimes(2));
    expect(onActualizar).toHaveBeenLastCalledWith(2, { descripcion: "PROYECTA editado" });
  });

  it("Esc cancela sin guardar y el blur posterior tampoco guarda", async () => {
    const onActualizar = vi.fn(async () => fake.egresoOk);
    const { container } = renderGrilla(onActualizar);
    const celda = container.querySelector<HTMLTableCellElement>('td[data-fila="1"][data-col="4"]')!; // Folio
    fireEvent.keyDown(celda, { key: "Enter" });
    const input = await screen.findByRole("textbox", { name: "Folio" });
    fireEvent.change(input, { target: { value: "99999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Folio" })).toBeNull());
    expect(onActualizar).not.toHaveBeenCalled();
  });

  it("modo lectura: las celdas son gridcell sin aria-label y la columna del chevron dice 'Abrir ficha'", () => {
    const { container } = renderGrilla(vi.fn(async () => fake.egresoOk));
    expect(container.querySelector("table")).toHaveAttribute("role", "grid");
    const celdas = container.querySelectorAll('td[data-fila="1"]');
    expect(celdas.length).toBeGreaterThan(0);
    celdas.forEach((td) => {
      expect(td).toHaveAttribute("role", "gridcell");
      expect(td).not.toHaveAttribute("aria-label");
    });
    expect(container.querySelector('td[data-fila="1"][data-col="8"]')).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByText("Abrir ficha")).toHaveClass("sr-only");
  });
});
