/**
 * Anexos de OC — la pantalla, no sólo la API (ver feedback "verificar la UI").
 *
 * Se simula el backend (apiClient) con el shape EXACTO de
 * app/api/v1/oc_anexos.py::OcAnexosResponse y se prueba lo que el usuario ve
 * y lo que el componente manda.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  postForm: vi.fn(),
  delete: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
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

const MB = 1024 * 1024;

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
    en_el_pdf: true,
  },
  {
    attachment_id: 2,
    oc_id: 59,
    file_name: "presupuesto.xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: 40_000,
    source: "inbox_email",
    descripcion: null,
    subido_por_email: null,
    created_at: "2026-09-20T15:00:00Z",
    en_el_pdf: false,
  },
];

function respuesta(extra: Record<string, unknown> = {}) {
  return {
    anexos: ANEXOS,
    se_pueden_modificar: true,
    motivo_bloqueo: null,
    usado_bytes: 290_000,
    limite_total_bytes: 20 * MB,
    limite_archivo_bytes: 10 * MB,
    max_anexos: 15,
    ...extra,
  };
}

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
  api.get.mockResolvedValue(respuesta());
  api.postForm.mockResolvedValue({ ...ANEXOS[0], attachment_id: 3 });
  api.delete.mockResolvedValue(undefined);
});

describe("OcAnexosSection", () => {
  it("lista los anexos en orden, con descripción, quién, de dónde y el uso", async () => {
    montar();
    expect(await screen.findAllByText("cotizacion-proveedor.pdf")).not.toHaveLength(0);
    expect(api.get).toHaveBeenCalledWith("/ordenes-compra/59/anexos", expect.anything());
    expect(screen.getByText("Cotización firmada")).toBeInTheDocument();
    expect(screen.getByText(/subido por btoro@cenergy.cl/)).toBeInTheDocument();
    expect(screen.getByText(/llegó por correo/)).toBeInTheDocument();
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText(/de 20 MB/)).toBeInTheDocument();
  });

  it("un Excel avisa que no va dentro del PDF", async () => {
    montar();
    await screen.findAllByText("presupuesto.xlsx");
    expect(screen.getAllByText("no va dentro del PDF")).toHaveLength(1);
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

  it("un archivo más grande que el límite por archivo no se sube", async () => {
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    const grande = new File(["x"], "enorme.pdf", { type: "application/pdf" });
    Object.defineProperty(grande, "size", { value: 11 * MB });
    fireEvent.change(inputArchivo(), { target: { files: [grande] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.postForm).not.toHaveBeenCalled();
  });

  it("si no cabe en el total de la OC, no se sube y lo explica", async () => {
    api.get.mockResolvedValue(respuesta({ usado_bytes: 19.5 * MB }));
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    const archivo = new File(["x"], "otro.pdf", { type: "application/pdf" });
    Object.defineProperty(archivo, "size", { value: 1 * MB });
    fireEvent.change(inputArchivo(), { target: { files: [archivo] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/No caben/), expect.anything()),
    );
    expect(api.postForm).not.toHaveBeenCalled();
  });

  it("si el backend rechaza, muestra el motivo del backend", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
    api.postForm.mockRejectedValueOnce(
      new ApiError(400, "x.pdf: el PDF está protegido con contraseña."),
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
          description: "x.pdf: el PDF está protegido con contraseña.",
        }),
      ),
    );
  });

  it("quitar pide confirmación y llama al DELETE del anexo", async () => {
    montar();
    await screen.findAllByText("presupuesto.xlsx");
    fireEvent.click(screen.getByRole("button", { name: "Quitar presupuesto.xlsx" }));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar anexo" }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(
        "/ordenes-compra/59/anexos/2",
        expect.anything(),
      ),
    );
  });

  it("con la OC ya firmada: se ven, no se tocan, y dice por qué", async () => {
    const motivo =
      "La OC ya tiene 1 firma puesta: los anexos son parte de lo que se firma, así que ya no se pueden agregar ni quitar.";
    api.get.mockResolvedValue(respuesta({ se_pueden_modificar: false, motivo_bloqueo: motivo }));
    montar("en_firma");
    await screen.findAllByText("cotizacion-proveedor.pdf");
    expect(screen.getByText(motivo)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adjuntar anexo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
  });

  it("sin oc:update se ven los anexos pero no se puede subir ni quitar", async () => {
    me.allowed_actions = ["oc:read"];
    montar();
    await screen.findAllByText("cotizacion-proveedor.pdf");
    expect(screen.queryByRole("button", { name: /Adjuntar anexo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Quitar/ })).not.toBeInTheDocument();
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

  it("mientras carga no dice 'no tiene anexos'", async () => {
    api.get.mockReturnValue(new Promise(() => {}));
    montar();
    expect(screen.queryByText("Esta OC no tiene anexos.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cargando anexos")).toBeInTheDocument();
  });

  it("sin anexos lo dice", async () => {
    api.get.mockResolvedValue(respuesta({ anexos: [], usado_bytes: 0 }));
    montar();
    expect(await screen.findByText("Esta OC no tiene anexos.")).toBeInTheDocument();
  });
});
