"use client";

/**
 * Anexos de la OC — subir, ver y quitar (2026-09-21).
 *
 * Nicolás: "que se pueda adjuntar anexo a las oc". Los anexos viven en
 * Dropbox (01-Empresas/{COD}/06-Adjuntos-OCs/{año}/{OC}/) y salen al final
 * del PDF de la OC, en el orden de esta lista — el mismo PDF de "Descargar
 * PDF" y el que se le manda al proveedor.
 *
 * Lo firmado no se toca: un anexo que ya estaba cuando alguien firmó muestra
 * un candado en vez del botón quitar (el backend igual lo bloquea con 409).
 *
 * Los tipos se declaran acá (espejo de app/api/v1/oc_anexos.py):
 * `types/api.ts` se regenera aparte.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  Mail,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";

interface OcAnexo {
  attachment_id: number;
  oc_id: number;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  source: string | null;
  descripcion: string | null;
  subido_por_email: string | null;
  created_at: string;
  se_puede_quitar: boolean;
}

interface OcAnexoLink {
  attachment_id: number;
  file_name: string;
  url: string;
}

// Espejo de _MAX_BYTES / _MIME_PERMITIDOS del backend: avisar antes de subir
// ahorra esperar 25 MB para recibir un 413.
const MAX_MB = 25;
const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,application/pdf,image/jpeg,image/png,image/webp";

function iconoPara(mime: string | null) {
  if (mime?.startsWith("image/")) return ImageIcon;
  if (mime?.includes("sheet") || mime?.includes("excel")) return FileSpreadsheet;
  return FileText;
}

function tamano(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

function fecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface Props {
  ocId: number;
  estado: string;
}

export function OcAnexosSection({ ocId, estado }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const { data: me } = useMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const [descripcion, setDescripcion] = useState("");
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const queryKey = ["oc-anexos", String(ocId)];
  const q = useApiQuery<OcAnexo[]>(queryKey, `/ordenes-compra/${ocId}/anexos`);
  const anexos = q.data ?? [];

  // Mismo criterio que el backend: scope global oc:update (la empresa la
  // valida el endpoint con 403) y OC no anulada.
  const puedeEditar = (me?.allowed_actions?.includes("oc:update") ?? false) && estado !== "anulada";

  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey });
    // El PDF de la OC y su historial cambian con cada anexo.
    router.refresh();
  };

  const subir = async (archivos: File[]) => {
    if (!session || archivos.length === 0) return;
    const grandes = archivos.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (grandes.length > 0) {
      toast.error(
        `${grandes.map((f) => f.name).join(", ")} pesa más de ${MAX_MB} MB. Comprímelo o divídelo.`,
        { duration: 8000 },
      );
      return;
    }
    const desc = descripcion.trim();
    let ok = 0;
    try {
      for (const archivo of archivos) {
        setSubiendo(archivo.name);
        const fd = new FormData();
        fd.append("file", archivo);
        if (desc) fd.append("descripcion", desc);
        try {
          await apiClient.postForm<OcAnexo>(`/ordenes-compra/${ocId}/anexos`, fd, session);
          ok += 1;
        } catch (err) {
          toast.error(`No se pudo subir ${archivo.name}`, {
            description:
              err instanceof ApiError
                ? err.detail
                : err instanceof Error
                  ? err.message
                  : "Error desconocido",
            duration: 10_000,
          });
        }
      }
    } finally {
      setSubiendo(null);
      if (fileRef.current) fileRef.current.value = "";
    }
    if (ok > 0) {
      toast.success(ok === 1 ? "Anexo agregado a la OC" : `${ok} anexos agregados a la OC`);
      setDescripcion("");
      await refrescar();
    }
  };

  const quitarMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(`/ordenes-compra/${ocId}/anexos/${id}`, session),
    onSuccess: async () => {
      toast.success("Anexo quitado de la OC");
      await refrescar();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo quitar el anexo", {
        duration: 10_000,
      });
    },
  });

  const abrir = async (anexo: OcAnexo) => {
    if (!session) return;
    // La ventana se abre ANTES del await: abierta después, el bloqueador de
    // ventanas emergentes la trata como no pedida por el usuario.
    const ventana = window.open("about:blank", "_blank");
    try {
      const link = await apiClient.get<OcAnexoLink>(
        `/ordenes-compra/${ocId}/anexos/${anexo.attachment_id}/url`,
        session,
      );
      if (ventana) ventana.location.href = link.url;
      else window.location.href = link.url;
    } catch (err) {
      ventana?.close();
      toast.error(err instanceof ApiError ? err.detail : "No se pudo abrir el anexo");
    }
  };

  // Backend sin los endpoints todavía (el frontend puede publicarse antes que
  // Fly): no mostrar una sección rota en cada OC, simplemente no mostrarla.
  if (q.error instanceof ApiError && q.error.status === 404) return null;

  // El Surface va adentro (no en la página) para que, al devolver null,
  // tampoco quede una tarjeta vacía.
  return (
    <Surface>
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900">
              <Paperclip className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
              Anexos
              {anexos.length > 0 && (
                <span className="text-sm font-normal text-ink-500">({anexos.length})</span>
              )}
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              Cotizaciones, especificaciones técnicas, contratos, planos… Se agregan al final del
              PDF de la OC, en este orden, y se guardan en la carpeta de Dropbox de la empresa.
            </p>
          </div>
        </div>

        {q.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : q.isError ? (
          <p className="rounded-xl bg-negative/5 p-3 text-sm text-negative ring-1 ring-negative/20">
            No se pudieron cargar los anexos: {q.error?.message}
          </p>
        ) : anexos.length === 0 ? (
          <p className="bg-ink-50/40 rounded-xl border border-dashed border-hairline p-4 text-center text-sm text-ink-500">
            Esta OC no tiene anexos.
          </p>
        ) : (
          <ol className="space-y-2">
            {anexos.map((a, i) => {
              const Icono = iconoPara(a.mime_type);
              return (
                <li
                  key={a.attachment_id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2.5"
                >
                  <span className="text-ink-400 w-5 shrink-0 text-right text-xs tabular-nums">
                    {i + 1}.
                  </span>
                  <Icono className="text-ink-400 h-5 w-5 shrink-0" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => abrir(a)}
                      className="block max-w-full truncate text-left text-sm font-medium text-ink-900 hover:text-cehta-green hover:underline"
                      title={`Abrir ${a.file_name}`}
                    >
                      {a.file_name}
                    </button>
                    {a.descripcion && (
                      <p className="truncate text-xs text-ink-700">{a.descripcion}</p>
                    )}
                    <p className="text-[11px] text-ink-500">
                      {tamano(a.size_bytes)} ·{" "}
                      {a.source === "inbox_email" ? (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" strokeWidth={1.5} />
                          llegó por correo
                        </span>
                      ) : a.subido_por_email ? (
                        <>subido por {a.subido_por_email}</>
                      ) : (
                        <>subido</>
                      )}{" "}
                      el {fecha(a.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => abrir(a)}
                    aria-label={`Abrir ${a.file_name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-cehta-green/10 hover:text-cehta-green"
                  >
                    <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                  {puedeEditar &&
                    (a.se_puede_quitar ? (
                      <ConfirmDeleteDialog
                        trigger={
                          <button
                            type="button"
                            aria-label={`Quitar ${a.file_name}`}
                            disabled={quitarMut.isPending}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-negative hover:bg-negative/10 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                          </button>
                        }
                        title="¿Quitar este anexo de la OC?"
                        description={
                          <>
                            <span className="font-medium text-ink-900">{a.file_name}</span> deja de
                            salir en el PDF de la OC. El archivo no se borra de Dropbox y el cambio
                            queda en el historial.
                          </>
                        }
                        confirmText="Quitar anexo"
                        onConfirm={() => quitarMut.mutateAsync(a.attachment_id)}
                      />
                    ) : (
                      <SimpleTooltip content="Ya estaba cuando firmaron la OC: es parte de lo firmado y no se puede quitar.">
                        <span className="text-ink-400 inline-flex h-8 w-8 items-center justify-center">
                          <Lock className="h-4 w-4" strokeWidth={1.5} />
                        </span>
                      </SimpleTooltip>
                    ))}
                </li>
              );
            })}
          </ol>
        )}

        {puedeEditar && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              if (!subiendo) void subir(Array.from(e.dataTransfer.files));
            }}
            className={`flex flex-col gap-3 rounded-2xl border border-dashed p-4 transition-colors sm:flex-row sm:items-center ${
              arrastrando ? "border-cehta-green bg-cehta-green/5" : "bg-ink-50/30 border-hairline"
            }`}
          >
            <input
              type="text"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={300}
              placeholder="Descripción (opcional) — ej: Cotización firmada del proveedor"
              disabled={subiendo !== null}
              className="border-ink-200 placeholder:text-ink-400 focus:border-ink-400 min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:opacity-60"
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => void subir(Array.from(e.target.files ?? []))}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={subiendo !== null}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {subiendo ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  <span className="max-w-[12rem] truncate">Subiendo {subiendo}…</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" strokeWidth={1.5} />
                  Adjuntar anexo
                </>
              )}
            </button>
            <p className="text-[11px] text-ink-500 sm:hidden">
              PDF, imagen, Excel o Word · hasta {MAX_MB} MB
            </p>
          </div>
        )}
        {puedeEditar && (
          <p className="hidden text-[11px] text-ink-500 sm:block">
            Arrastra archivos al recuadro o usa el botón · PDF, imagen (JPG/PNG), Excel o Word ·
            hasta {MAX_MB} MB cada uno.
          </p>
        )}
      </section>
    </Surface>
  );
}
