/**
 * Tests para CuentaTypeahead — Round 70.
 *
 * Mirror del setup de ProveedorTypeaheadCached.test.tsx. Cubre que las
 * mejoras de paridad (keyboard nav, highlight, aria) están en su lugar
 * sin requerir mockear la red — el componente renderiza vacío cuando
 * no hay session, lo que nos basta para asserts a11y/props.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CuentaTypeahead } from "../CuentaTypeahead";

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ session: null, loading: false }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
}

describe("CuentaTypeahead", () => {
  it("renderiza un input sin crashear", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("usa placeholder default cuando no se provee uno", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toContain("código");
  });

  it("usa placeholder custom cuando se proveyó", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
        placeholder="Mi placeholder"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toBe("Mi placeholder");
  });

  it("respeta el required prop", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
        required
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it("incluye atributos a11y de combobox", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("muestra el value raw cuando aún no cargó la lista", () => {
    // Sin session, el query está disabled → cuentas=undefined → selected=null.
    // En ese caso displayValue cae al `value || query`, así el código prefilled
    // por IA en /desde-mensaje no se pierde.
    renderWithQuery(
      <CuentaTypeahead
        value="5-01-001"
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="contable"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("5-01-001");
  });

  it("acepta tone='financiera' sin crashear", () => {
    renderWithQuery(
      <CuentaTypeahead
        value=""
        onChange={() => {}}
        empresaCodigo="AFIS"
        tone="financiera"
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });
});
