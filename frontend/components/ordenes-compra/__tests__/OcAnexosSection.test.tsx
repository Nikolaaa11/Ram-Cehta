/**
 * Anexos de OC — la pantalla, no sólo la API (ver feedback "verificar la UI").
 *
 * Se simula el backend (apiClient) con el shape EXACTO de
 * app/api/v1/oc_anexos.py::OcAnexoRead y se prueba lo que el usuario ve y
 * lo que el componente manda.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  postForm: vi.fn(),
  delete: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const me = vi.hoisted(() => ({ allowed_actions: ["oc:read", "oc:update"] }));

vi.mock("@/lib/api/client", async () => {
  const real = await vi.importActual<typeof import("@/lib/api/client")>(
    "@/lib/api/client",
  );
  return { ...real, apiClient: api };
});
vi.mock("@/hooks/use-session", () => ({
  useSession: () => ({ session: { access_token: "t" }, loading: false }),
}));
vi.mock("@/hooks/use-me", () => ({ useMe: () => ({ data: me }) }));
vi.mock("@/components/ui/toast", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { OcAnexosSection } from "../OcAnexosSection";

const ANEXOS = [
  {
    attachment_id: 1,
    oc_id: 59,
    file_name: "cotizacion-proveedor.pdf",
    mime_type: "application/pdf",
    size_bytes: 250_000,
    source: "manual_upload",
    descripcion: "Cotización firmada",
    subido_por_email: "btoro@cenergy.cl",
    created_at: "2026-09-10T15:00:00Z",
    se_puede_quitar: false,
  },
  {
    attachment_id: 2,
    oc_id: 59,
    file_name: "foto-terreno.jpg",
    mime_type: "image/jpeg",
    size_bytes: 3_400_000,
    source: "inbox_email",
    descripcion: null,
    subido_por_email: null,
    created_at: "2026-09-20T15:00:00Z",
    se_puede_quitar: true,
  },
];

function montar(estado = "en_firma") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <OcAnexosSection ocId={59} estado={estado} />
    </QueryClientProvider>,
  );
}

function inputArchivo(): HTMLInputElement {
  const el = document.querySelector('input[type="file"]');
  if (!el) throw new Error("no hay input de archivo");
  return el as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  me.allowed_actions = ["oc:read", "oc:update"];
  api.get.mockResolvedValue(ANEXOS);
  api.postForm.mockResolvedValue({ ...ANEXOS[0], attachment_id: 3 });
  api.delete.mockResolvedValue(undefined);
});

describe("OcAnexosSection", () => {
  it("lista los anexos en orden, con descripción, quién y de dónde", async () => {
    montar();
    expect(await screen.findAllByText("cotizacion-proveedor.pdf")).not.toHaveLength(0);
    expect(api.get).toHaveBeenCalledWith("/ordenes-compra/59/anexos", expect.anything());
    expect(screen.getByText("Cotización firmada")).toBeInTheDocument();
    expect(screen.getByText(/subido por btoro@cenergy.cl/)).toBeInTheDocument();
    expect(screen.getByText(/llegó por correo/)).toBeInTheDocument();
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
  });

  it("lo que ya estaba cuando firmaron no tiene botón quitar", async () => {
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    expect(
      screen.queryByRole("button", { name: "Quitar cotizacion-proveedor.pdf" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Quitar foto-terreno.jpg" }),
    ).toBeInTheDocument();
  });

  it("sube el archivo con la descripción al endpoint de la OC", async () => {
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    fireEvent.change(screen.getByPlaceholderText(/Descripción \(opcional\)/), {
      target: { value: "  Especificación técnica  " },
    });
    const archivo = new File(["%PDF-1.4"], "espec.pdf", { type: "application/pdf" });
    fireEvent.change(inputArchivo(), { target: { files: [archivo] } });

    await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(1));
    const [ruta, fd] = api.postForm.mock.calls[0]!;
    expect(ruta).toBe("/ordenes-compra/59/anexos");
    expect((fd as FormData).get("file")).toBe(archivo);
    expect((fd as FormData).get("descripcion")).toBe("Especificación técnica");
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Anexo agregado a la OC"),
    );
  });

  it("varios archivos a la vez se suben uno por uno", async () => {
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    const a = new File(["a"], "a.pdf", { type: "application/pdf" });
    const b = new File(["b"], "b.png", { type: "image/png" });
    fireEvent.change(inputArchivo(), { target: { files: [a, b] } });
    await waitFor(() => expect(api.postForm).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("2 anexos agregados a la OC"),
    );
  });

  it("un archivo de más de 25 MB se rechaza antes de subirlo", async () => {
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    const grande = new File(["x"], "enorme.pdf", { type: "application/pdf" });
    Object.defineProperty(grande, "size", { value: 26 * 1024 * 1024 });
    fireEvent.change(inputArchivo(), { target: { files: [grande] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.postForm).not.toHaveBeenCalled();
  });

  it("si el backend rechaza, muestra el motivo del backend", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
    api.postForm.mockRejectedValueOnce(
      new ApiError(400, "Tipo de archivo no permitido (text/html)."),
    );
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    fireEvent.change(inputArchivo(), {
      target: { files: [new File(["x"], "x.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "No se pudo subir x.pdf",
        expect.objectContaining({
          description: "Tipo de archivo no permitido (text/html).",
        }),
      ),
    );
  });

  it("quitar pide confirmación y llama al DELETE del anexo", async () => {
    montar();
    await screen.findAllByText("foto-terreno.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Quitar foto-terreno.jpg" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar anexo" }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(
        "/ordenes-compra/59/anexos/2",
        expect.anything(),
      ),
    );
  });

  it("sin oc:update se ven los anexos pero no se puede subir ni quitar", async () => {
    me.allowed_actions = ["oc:read"];
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    expect(screen.queryByRole("button", { name: /Adjuntar anexo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it("una OC anulada no recibe anexos", async () => {
    montar("anulada");
    await screen.findAllByText("cotizacion-proveedor.pdf");
    expect(screen.queryByRole("button", { name: /Adjuntar anexo/ })).not.toBeInTheDocument();
  });

  it("si el backend todavía no tiene anexos (404), la sección no aparece", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
    api.get.mockRejectedValue(new ApiError(404, "Not Found"));
    const { container } = montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("sin anexos lo dice", async () => {
    api.get.mockResolvedValue([]);
    montar();
    expect(await screen.findByText("Esta OC no tiene anexos.")).toBeInTheDocument();
  });
});
