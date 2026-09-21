/**
 * "Marcar pagada" con firmas pendientes — la pantalla.
 *
 * Caso real: TECMAVIDA, OC en_firma porque un firmante nunca firmó en la
 * plataforma, pero el proveedor ya cobró. Quién decide si hace falta motivo
 * es el BACKEND (422): la pantalla intenta sin motivo y, si se lo piden,
 * abre el diálogo con ese mensaje. Así los externos que firman en papel
 * (que no cuentan como pendientes) no piden motivo por error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ patch: vi.fn(), delete: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

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
  useMe: () => ({ data: { allowed_actions: ["oc:read", "oc:mark_paid"] } }),
}));
vi.mock("@/components/ui/toast", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// DuplicateOcDialog no participa y arrastra dependencias pesadas.
vi.mock("@/components/ordenes-compra/DuplicateOcDialog", () => ({
  DuplicateOcDialog: () => null,
}));

import { ApiError } from "@/lib/api/client";
import { OcActions } from "../OcActions";

const PIDE_MOTIVO =
  "Esta OC tiene 1 firma pendiente (José Antonio Maturana). Para marcarla pagada igual, escribe el motivo (mínimo 10 caracteres): queda registrado en el historial de la OC.";

function montar(estado: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OcActions
        ocId={59}
        numeroOc="OC-T&E-0002"
        estado={estado}
        allowedActions={["download_pdf", "mark_paid"]}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.patch.mockResolvedValue({});
});

describe("Marcar pagada", () => {
  it("con firmas pendientes: el backend pide motivo, se abre el diálogo y se manda", async () => {
    api.patch.mockRejectedValueOnce(new ApiError(422, PIDE_MOTIVO));
    montar("en_firma");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));

    // Primer intento, sin motivo.
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/ordenes-compra/59/estado",
        { estado: "pagada" },
        expect.anything(),
      ),
    );
    // Se abre el diálogo con el mensaje del backend (dice quién falta), sin toast de error.
    const textarea = await screen.findByLabelText(/Por qué se marca pagada/);
    expect(screen.getByText(/José Antonio Maturana/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    const confirmar = screen.getByRole("button", { name: "Marcar pagada" });
    fireEvent.change(textarea, { target: { value: "corto" } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(textarea, {
      target: { value: "  Transferido el 15-09; José aprobó por correo  " },
    });
    await waitFor(() => expect(confirmar).not.toBeDisabled());
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(api.patch).toHaveBeenLastCalledWith(
        "/ordenes-compra/59/estado",
        { estado: "pagada", motivo: "Transferido el 15-09; José aprobó por correo" },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("OC OC-T&E-0002 marcada como pagada"),
    );
  });

  it("en_firma pero sin firmas pendientes que cuenten: marca pagada directo, sin diálogo", async () => {
    montar("en_firma");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("OC OC-T&E-0002 marcada como pagada"),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Por qué se marca pagada/)).not.toBeInTheDocument();
  });

  it("después de marcar pagada refresca la sección de firmas (no más 'Te toca firmar')", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <OcActions ocId={59} numeroOc="OC-T&E-0002" estado="firmada" allowedActions={["mark_paid"]} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["oc-firmas", "59"] }),
    );
  });

  it("OC firmada: marca pagada directo, sin motivo", async () => {
    montar("firmada");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/ordenes-compra/59/estado",
        { estado: "pagada" },
        expect.anything(),
      ),
    );
    expect(screen.queryByLabelText(/Por qué se marca pagada/)).not.toBeInTheDocument();
  });

  it("otros errores del backend se muestran como error, sin diálogo", async () => {
    api.patch.mockRejectedValueOnce(new ApiError(403, "No tienes permiso para cambiar estado a 'pagada'"));
    montar("emitida");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Por qué se marca pagada/)).not.toBeInTheDocument();
  });
});
