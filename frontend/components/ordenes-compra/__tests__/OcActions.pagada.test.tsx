/**
 * "Marcar pagada" con firmas pendientes — la pantalla.
 *
 * Caso real: TECMAVIDA, OC en_firma porque un firmante nunca firmó en la
 * plataforma, pero el proveedor ya cobró. El botón tiene que pedir el
 * motivo (mín. 10 caracteres) y mandarlo; el backend lo exige y lo audita.
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
  it("OC en_firma: pide el motivo y lo manda", async () => {
    montar("en_firma");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));

    // No se manda nada hasta escribir el motivo.
    expect(api.patch).not.toHaveBeenCalled();
    const confirmar = await screen.findByRole("button", { name: "Marcar pagada" , hidden: false });
    const textarea = screen.getByLabelText(/Por qué se marca pagada/);
    expect(screen.getByText(/Faltan 10 caracteres/)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "corto" } });
    expect(confirmar).toBeDisabled();

    fireEvent.change(textarea, {
      target: { value: "  Transferido el 15-09; José aprobó por correo  " },
    });
    await waitFor(() => expect(confirmar).not.toBeDisabled());
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/ordenes-compra/59/estado",
        { estado: "pagada", motivo: "Transferido el 15-09; José aprobó por correo" },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("OC OC-T&E-0002 marcada como pagada"),
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

  it("si el backend contesta que faltan firmas, abre el motivo en vez de un error", async () => {
    api.patch.mockRejectedValueOnce(
      new ApiError(
        422,
        "Esta OC tiene 1 firma pendiente (José Maturana). Para marcarla pagada igual, escribe el motivo…",
      ),
    );
    montar("emitida");
    fireEvent.click(screen.getByRole("button", { name: /Marcar pagada/ }));
    expect(await screen.findByLabelText(/Por qué se marca pagada/)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
