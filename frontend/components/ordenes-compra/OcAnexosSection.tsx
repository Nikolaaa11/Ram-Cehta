"use client";

/**
 * Anexos de la OC — subir, ver y quitar (2026-09-21).
 *
 * Nicolás: "que se pueda adjuntar anexo a las oc". Los anexos viven en
 * Dropbox (01-Empresas/{COD}/06-Adjuntos-OCs/{año}/{OC}/). Los PDF e
 * imágenes se agregan al final del PDF de la OC, en el orden de esta lista —
 * el de "Descargar PDF", el de la invitación a firmar y el que se le manda al
 * proveedor. Excel y Word quedan guardados; en el PDF aparece una hoja que
 * los nombra.
 *
 * Un anexo es parte del documento que se firma: se agregan y se quitan sólo
 * mientras nadie firmó. El backend dice si se puede y por qué no
 * (`se_pueden_modificar` / `motivo_bloqueo`); la pantalla lo muestra tal cual.
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
  Info,
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
  /** PDF e imágenes: sí. Excel/Word: aparecen sólo como una hoja que los nombra. */
  en_el_pdf: boolean;
}

interface OcAnexosResponse {
  anexos: OcAnexo[];
  se_pueden_modificar: boolean;
  motivo_bloqueo: string | null;
  usado_bytes: number;
  limite_total_bytes: number;
  limite_archivo_bytes: number;
  max_anexos: number;
}

interface OcAnexoLink {
  attachment_id: number;
  file_name: string;
  url: string;
}

// Espejo de _TIPOS del backend (que igual verifica el contenido).
const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc,application/pdf,image/jpeg,image/png,image/webp";
const MB = 1024 * 1024;

function iconoPara(mime: string | null) {
  if (mime?.startsWith("image/")) return ImageIcon;
  if (mime?.includes("sheet") || mime?.includes("excel")) return FileSpreadsheet;
  return FileText;
}

function mb(bytes: number): string {
  return `${(bytes / MB).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

function tamano(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return mb(bytes);
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

  const queryKey = ["oc-anexos", String(ocId), estado];
  const q = useApiQuery<OcAnexosResponse>(queryKey, `/ordenes-compra/${ocId}/anexos`);
  const datos = q.data;
  const anexos = datos?.anexos ?? [];

  // Permiso (scope global oc:update; la empresa la valida el endpoint con
  // 403) Y regla del documento (nadie firmó), que decide el backend.
  const tienePermiso = me?.allowed_actions?.includes("oc:update") ?? false;
  const puedeEditar = tienePermiso && (datos?.se_pueden_modificar ?? false);

  const refrescar = async () => {
    await qc.invalidateQueries({ queryKey: ["oc-anexos", String(ocId)] });
    // El PDF de la OC y su historial cambian con cada anexo.
    router.refresh();
  };

  const subir = async (archivos: File[]) => {
    if (!session || !datos || archivos.length === 0) return;
    const limiteArchivo = datos.limite_archivo_bytes;
    const grandes = archivos.filter((f) => f.size > limiteArchivo);
    if (grandes.length > 0) {
      toast.error(
        `${grandes.map((f) => f.name).join(", ")} pesa más de ${mb(limiteArchivo)}. Comprímelo o divídelo: el PDF de la OC viaja por correo.`,
        { duration: 10_000 },
      );
      return;
    }
    const total = archivos.reduce((s, f) => s + f.size, 0);
    if (datos.usado_bytes + total > datos.limite_total_bytes) {
      toast.error(
        `No caben: la OC ya usa ${mb(datos.usado_bytes)} de ${mb(datos.limite_total_bytes)} en anexos. Comprime los archivos o quita alguno.`,
        { duration: 10_000 },
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
            duration: 12_000,
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
    }
    // Aunque haya fallado: un 409 (alguien firmó mientras tanto) cambia lo
    // que la sección debe mostrar.
    await refrescar();
  };

  const quitarMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(`/ordenes-compra/${ocId}/anexos/${id}`, session),
    onSuccess: async () => {
      toast.success("Anexo quitado de la OC");
      await refrescar();
    },
    onError: async (err) => {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo quitar el anexo", {
        duration: 10_000,
      });
      await refrescar();
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
              Cotizaciones, especificaciones técnicas, contratos, planos… Los PDF e imágenes se
              agregan al final del PDF de la OC, en este orden. Todo queda guardado en la carpeta
              de Dropbox de la empresa.
            </p>
          </div>
          {datos && anexos.length > 0 && (
            <p className="text-[11px] tabular-nums text-ink-500">
              {mb(datos.usado_bytes)} de {mb(datos.limite_total_bytes)}
            </p>
          )}
        </div>

        {!datos && !q.isError ? (
          <div className="space-y-2" aria-label="Cargando anexos">
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
                      {!a.en_el_pdf && (
                        <span className="ml-1 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700">
                          no va dentro del PDF
                        </span>
                      )}
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
                  {puedeEditar && (
                    <ConfirmDeleteDialog
                      trigger={
                        <button
                          type="button"
                          aria-label={`Quitar ${a.file_name}`}
                          disabled={quitarMut.isPending || subiendo !== null}
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
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {tienePermiso && datos && !datos.se_pueden_modificar && datos.motivo_bloqueo && (
          <p className="flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-700 ring-1 ring-hairline">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            {datos.motivo_bloqueo}
          </p>
        )}

        {puedeEditar && datos && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!subiendo) setArrastrando(true);
              }}
              onDragLeave={(e) => {
                // Pasar sobre el input o el botón (hijos) no es "salir".
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setArrastrando(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                setArrastrando(false);
                if (subiendo) {
                  toast.info("Espera a que termine la subida en curso y vuelve a soltar el archivo.");
                  return;
                }
                void subir(Array.from(e.dataTransfer.files));
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
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-ink-500">
              <Info className="mt-px h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span>
                Arrastra archivos al recuadro o usa el botón. PDF o imagen (JPG, PNG, WebP) — van
                dentro del PDF de la OC; Excel o Word — quedan guardados aquí. Hasta{" "}
                {mb(datos.limite_archivo_bytes)} por archivo y {mb(datos.limite_total_bytes)} en
                total. Una vez que alguien firma, los anexos ya no se pueden cambiar.
              </span>
            </p>
          </>
        )}
      </section>
    </Surface>
  );
}
