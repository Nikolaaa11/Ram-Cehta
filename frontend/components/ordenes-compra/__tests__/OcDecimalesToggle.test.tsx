/**
 * El botón "con decimales / sin decimales" de la OC — la pantalla.
 *
 * Nicolás (2026-09-24). Es presentación del precio unitario: no mueve
 * plata, por eso el endpoint es `/formato` y funciona también en OC ya
 * firmadas o pagadas. Lo que se prueba acá es cuándo aparece, qué manda y
 * qué le dice al operador.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ patch: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const me = vi.hoisted(() => ({ scopes: ["oc:read", "oc:update"] as string[] }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/api/client", async () => {
  const real = await vi.importActual<typeof import("@/lib/api/client")>(
    "@/lib/api/client",
  );
  return { ...real, apiClient: api };
});
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ session: { access_token: "t" }, loading: false }),
}));
vi.mock("@/hooks/use-me", () => ({
  useMe: () => ({ data: { allowed_actions: me.scopes } }),
}));
vi.mock("@/components/ui/toast", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ApiError } from "@/lib/api/client";
import { OcDecimalesToggle } from "../OcDecimalesToggle";

function montar(props: Partial<React.ComponentProps<typeof OcDecimalesToggle>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OcDecimalesToggle
        ocId={96}
        numeroOc="OC0059-PAN001"
        moneda="CLP"
        estado="emitida"
        mostrarDecimales
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  me.scopes = ["oc:read", "oc:update"];
  api.patch.mockResolvedValue({});
});

describe("Con decimales / sin decimales", () => {
  it("marca la opción vigente y ofrece la otra", () => {
    montar();
    expect(screen.getByRole("button", { name: "Con decimales" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Sin decimales" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("apagarlos manda el PATCH al endpoint de formato y refresca la ficha", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Sin decimales" }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/ordenes-compra/96/formato",
        { mostrar_decimales: false },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      "OC OC0059-PAN001: el precio unitario sale redondeado a peso",
    );
  });

  it("volver a prenderlos manda true", async () => {
    montar({ mostrarDecimales: false });
    fireEvent.click(screen.getByRole("button", { name: "Con decimales" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/ordenes-compra/96/formato",
        { mostrar_decimales: true },
        expect.anything(),
      ),
    );
  });

  it("clickear la opción que ya está puesta no llama al backend", () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Con decimales" }));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("avisa que los montos no cambian, sólo cómo se imprime el precio", () => {
    montar({ mostrarDecimales: false });
    expect(
      screen.getByText(/Los montos no cambian, sólo cómo se imprime el precio/),
    ).toBeInTheDocument();
    expect(screen.getByText(/puede no dar el importe de la línea/)).toBeInTheDocument();
  });

  it("en una OC ya firmada avisa que el PDF se va a ver distinto", () => {
    montar({ estado: "firmada" });
    expect(screen.getByText(/esta OC ya salió/)).toBeInTheDocument();
  });

  it("en una OC emitida no mete ese susto", () => {
    montar();
    expect(screen.queryByText(/esta OC ya salió/)).not.toBeInTheDocument();
  });

  it("no aparece en UF ni en USD: ahí los centésimos son plata", () => {
    const { unmount } = montar({ moneda: "UF" });
    expect(screen.queryByRole("button", { name: "Sin decimales" })).not.toBeInTheDocument();
    unmount();
    montar({ moneda: "USD" });
    expect(screen.queryByRole("button", { name: "Sin decimales" })).not.toBeInTheDocument();
  });

  it("no aparece en una OC anulada (el backend devuelve 409)", () => {
    montar({ estado: "anulada" });
    expect(screen.queryByRole("button", { name: "Sin decimales" })).not.toBeInTheDocument();
  });

  it("no aparece sin permiso de edición", () => {
    me.scopes = ["oc:read"];
    montar();
    expect(screen.queryByRole("button", { name: "Sin decimales" })).not.toBeInTheDocument();
  });

  it("si el backend rechaza, lo dice con sus palabras", async () => {
    api.patch.mockRejectedValueOnce(
      new ApiError(409, "La OC OC0059-PAN001 está anulada: no se le cambia el formato."),
    );
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Sin decimales" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "La OC OC0059-PAN001 está anulada: no se le cambia el formato.",
      ),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
