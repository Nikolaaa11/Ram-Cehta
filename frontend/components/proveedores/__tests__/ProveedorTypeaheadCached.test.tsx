/**
 * Tests para ProveedorTypeaheadCached — Round 63.
 *
 * Cubre la renderización inicial del componente. Tests más profundos
 * (interacción con keyboard, selección, etc.) requerirían mockear
 * el endpoint /proveedores/cache via msw + QueryClientProvider wrapper.
 * Acá nos enfocamos en que el componente:
 *   1. Renderiza sin crashear con props mínimas
 *   2. Muestra el placeholder correcto cuando no hay cache
 *   3. Tiene los atributos a11y (aria-autocomplete, aria-expanded)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProveedorTypeaheadCached } from "../ProveedorTypeaheadCached";

// Mock del módulo session para no requerir auth context real.
import { vi } from "vitest";

vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ session: null, loading: false }),
}));

// Wrapper con QueryClient (useProveedoresCache lo necesita aunque devuelva []).
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

describe("ProveedorTypeaheadCached", () => {
  it("renderiza sin crashear con props mínimas", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    // Hay un input en el DOM
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("usa el placeholder default cuando no hay cache", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    // Sin session, useProveedoresCache no se enabled — cacheSize=0.
    // placeholder default cuando cacheSize===0 es "Escribí razón social o RUT…"
    expect(input.placeholder).toContain("razón social");
  });

  it("usa el placeholder custom si se proveyó", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
        placeholder="Test placeholder propio"
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.placeholder).toBe("Test placeholder propio");
  });

  it("incluye atributos a11y mínimos en el input", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("muestra valor inicial cuando value !== ''", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value="BANCO DE CHILE"
        rutValue="97.004.000-5"
        onSelect={() => {}}
        onClear={() => {}}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("BANCO DE CHILE");
  });

  it("respeta el required prop", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
        required
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it("respeta el disabled prop", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
        disabled
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it("usa el inputClassName custom cuando se pasa", () => {
    renderWithQuery(
      <ProveedorTypeaheadCached
        value=""
        rutValue=""
        onSelect={() => {}}
        onClear={() => {}}
        inputClassName="my-custom-class"
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input.className).toBe("my-custom-class");
  });
});
