"use client";

/**
 * /admin/informes-lp/[id] — Editor side-by-side con preview live.
 *
 * Layout split 50/50 en desktop:
 *   ┌──────────────────────┬──────────────────────┐
 *   │ EDITOR               │ PREVIEW (iframe)     │
 *   │ - hero titulo        │ /informe/[token]?    │
 *   │ - hero narrativa     │   preview=1          │
 *   │ - empresas (cards)   │                      │
 *   │ - CTA (3 inputs)     │                      │
 *   │ - workflow buttons   │                      │
 *   └──────────────────────┴──────────────────────┘
 *
 * Mobile: stack vertical con tabs Editor/Preview.
 *
 * Workflow:
 *   - Borrador: edit + Save + Regenerate AI + Publicar
 *   - Publicado: ver / Archivar (no permite edit por default — botón "Editar publicado")
 *   - Archivado: read-only
 */
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Sparkles,
  Loader2,
  Eye,
  Send,
  Archive,
  Trash2,
  ExternalLink,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { InformeLpRead } from "@/lib/api/schema";

interface HeroPayload {
  titulo?: string;
  subtitulo?: string;
  kpi_destacado?: { valor_numero?: number; valor_string?: string; label?: string } | null;
}
interface EmpresaNarrativa {
  headline?: string;
  parrafo?: string;
  metricas_destacadas?: { valor: string; label: string }[];
}
interface CtaPayload {
  cta_principal?: string;
  cta_secundario_1?: string;
  cta_secundario_2?: string;
}

// Mobile tab
type MobileTab = "edit" | "preview";

export default function InformeEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();

  const [draft, setDraft] = useState<Partial<InformeLpRead>>({});
  const [previewKey, setPreviewKey] = useState(0); // bump para refrescar iframe
  const [mobileTab, setMobileTab] = useState<MobileTab>("edit");

  const informeQ = useApiQuery<InformeLpRead>(
    ["informe", id],
    `/informes-lp/${id}`,
  );

  const saveMutation = useMutation({
    mutationFn: (changes: Partial<InformeLpRead>) =>
      apiClient.patch<InformeLpRead>(`/informes-lp/${id}`, changes, session),
    onSuccess: (data) => {
      toast.success("Cambios guardados");
      qc.setQueryData(["informe", id], data);
      setDraft({});
      setPreviewKey((k) => k + 1);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.detail : "Error guardando";
      toast.error(msg, { duration: 8_000 });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: () =>
      apiClient.post<InformeLpRead>(
        `/informes-lp/${id}/regenerate-narrative`,
        {},
        session,
      ),
    onSuccess: (data) => {
      toast.success("Narrativa regenerada con AI");
      qc.setQueryData(["informe", id], data);
      setDraft({});
      setPreviewKey((k) => k + 1);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error regenerando narrativa",
      );
    },
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiClient.patch<InformeLpRead>(
        `/informes-lp/${id}`,
        { estado: "publicado" },
        session,
      ),
    onSuccess: (data) => {
      toast.success(
        "🎉 Informe publicado. El LP recibe el link al instante.",
        { duration: 5_000 },
      );
      qc.setQueryData(["informe", id], data);
      setPreviewKey((k) => k + 1);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error publicando",
      );
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiClient.delete(`/informes-lp/${id}`, session),
    onSuccess: () => {
      toast.success("Informe archivado");
      router.push(`/admin/informes-lp` as never);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error archivando");
    },
  });

  if (informeQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-32" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[600px] rounded-2xl" />
          <Skeleton className="h-[600px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (informeQ.isError || !informeQ.data) {
    return (
      <Surface className="text-center">
        <p className="text-sm text-negative">
          No se pudo cargar el informe
        </p>
        <Link
          href={"/admin/informes-lp" as never}
          className="mt-2 inline-block text-sm text-cehta-green hover:underline"
        >
          Volver al listado
        </Link>
      </Surface>
    );
  }

  const informe = informeQ.data;
  const view: InformeLpRead = { ...informe, ...draft };
  const hasChanges = Object.keys(draft).length > 0;
  const isPublicado = view.estado === "publicado";
  const isArchivado = view.estado === "archivado";
  const readOnly = isArchivado;

  const heroPayload =
    ((view.secciones as Record<string, unknown> | null)?.hero as
      | { kind?: string; payload?: HeroPayload }
      | undefined)?.payload ?? null;

  const empresasSeccion = (view.secciones as Record<string, unknown> | null)
    ?.empresas as
    | { payload?: { destacadas?: string[]; narrativas?: Record<string, EmpresaNarrativa> } }
    | undefined;
  const empresasDestacadas = empresasSeccion?.payload?.destacadas ?? [];
  const empresasNarrativas = empresasSeccion?.payload?.narrativas ?? {};

  const ctaPayload =
    ((view.secciones as Record<string, unknown> | null)?.cta as
      | { kind?: string; payload?: CtaPayload }
      | undefined)?.payload ?? null;

  // Mutación helpers para editar secciones nested
  const updateHero = (changes: Partial<HeroPayload>) => {
    const newSecciones = JSON.parse(JSON.stringify(view.secciones ?? {}));
    if (!newSecciones.hero) newSecciones.hero = { kind: "hero", payload: {} };
    newSecciones.hero.payload = {
      ...(newSecciones.hero.payload ?? {}),
      ...changes,
    };
    setDraft({ ...draft, secciones: newSecciones });
  };

  const updateEmpresaNarrativa = (cod: string, changes: Partial<EmpresaNarrativa>) => {
    const newSecciones = JSON.parse(JSON.stringify(view.secciones ?? {}));
    if (!newSecciones.empresas)
      newSecciones.empresas = { kind: "empresas_showcase", payload: {} };
    if (!newSecciones.empresas.payload.narrativas)
      newSecciones.empresas.payload.narrativas = {};
    newSecciones.empresas.payload.narrativas[cod] = {
      ...(newSecciones.empresas.payload.narrativas[cod] ?? {}),
      ...changes,
    };
    setDraft({ ...draft, secciones: newSecciones });
  };

  const updateCta = (changes: Partial<CtaPayload>) => {
    const newSecciones = JSON.parse(JSON.stringify(view.secciones ?? {}));
    if (!newSecciones.cta) newSecciones.cta = { kind: "cta", payload: {} };
    newSecciones.cta.payload = {
      ...(newSecciones.cta.payload ?? {}),
      ...changes,
    };
    setDraft({ ...draft, secciones: newSecciones });
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={"/admin/informes-lp" as never}
            className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            Volver
          </Link>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                isPublicado
                  ? "success"
                  : isArchivado
                  ? "neutral"
                  : "warning"
              }
            >
              {view.estado}
            </Badge>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
              {view.tipo.replace("_", " ")}
            </span>
            {view.periodo && (
              <span className="text-xs text-ink-500">· {view.periodo}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Workflow actions */}
          {!readOnly && (
            <button
              type="button"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
              title="Re-genera narrativa con AI usando datos vivos del portafolio (~10s)"
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Regenerar AI
            </button>
          )}
          {hasChanges && !readOnly && (
            <button
              type="button"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Guardar cambios
            </button>
          )}
          {!isPublicado && !isArchivado && (
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "¿Publicar este informe? El LP destinatario recibe el link inmediatamente vía email.",
                  )
                ) {
                  publishMutation.mutate();
                }
              }}
              disabled={publishMutation.isPending || hasChanges}
              title={
                hasChanges
                  ? "Guarda los cambios antes de publicar"
                  : "Publicar y mandar email al LP"
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green disabled:opacity-60"
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Send className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Publicar y enviar
            </button>
          )}
          {isPublicado && (
            <a
              href={`/informe/${view.token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              Ver público
            </a>
          )}
          {/* Round 6: Descargar PDF del informe con branding FIP CEHTA ESG.
              Use case: mandar a inversores institucionales por mail/whatsapp. */}
          <button
            type="button"
            onClick={async () => {
              if (!session) return;
              const t = toast.loading("Generando PDF del informe...");
              try {
                const API_BASE =
                  process.env.NEXT_PUBLIC_API_URL ??
                  "https://cehta-backend.fly.dev/api/v1";
                const res = await fetch(
                  `${API_BASE}/informes-lp/${view.informe_id}/pdf`,
                  {
                    headers: {
                      Authorization: `Bearer ${session.access_token}`,
                    },
                  },
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `informe-lp-${view.informe_id}-${new Date().toISOString().slice(0, 10)}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                toast.success("PDF descargado", { id: t });
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? `No pude generar el PDF: ${err.message}`
                    : "Error desconocido",
                  { id: t },
                );
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-white px-3 py-1.5 text-xs font-medium text-cehta-green hover:bg-cehta-green/5"
            title="Descarga PDF con branding FIP CEHTA ESG para mandar al inversor"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
            Descargar PDF
          </button>
          {!isArchivado && (
            <button
              type="button"
              onClick={() => {
                if (confirm("¿Archivar este informe?")) {
                  archiveMutation.mutate();
                }
              }}
              disabled={archiveMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
              Archivar
            </button>
          )}
        </div>
      </div>

      {/* Header info */}
      <Surface variant="glass" className="border border-cehta-green/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              Editando
            </p>
            <h1 className="font-display text-xl font-semibold text-ink-900">
              {view.titulo}
            </h1>
            {view.lp_id && (
              <p className="mt-0.5 text-xs text-ink-500">
                Para LP{" "}
                <Link
                  href={`/admin/lps/${view.lp_id}` as never}
                  className="font-medium text-cehta-green hover:underline"
                >
                  #{view.lp_id}
                </Link>
              </p>
            )}
          </div>
          <div className="text-right text-xs text-ink-500">
            <p>
              Opens:{" "}
              <span className="font-mono font-bold tabular-nums text-ink-900">
                {view.veces_abierto}
              </span>
            </p>
            <p>
              Shares:{" "}
              <span className="font-mono font-bold tabular-nums text-ink-900">
                {view.veces_compartido}
              </span>
            </p>
          </div>
        </div>
      </Surface>

      {/* Tabs mobile */}
      <div className="flex gap-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("edit")}
          className={cn(
            "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
            mobileTab === "edit"
              ? "border-cehta-green bg-cehta-green text-white"
              : "border-hairline bg-white text-ink-700",
          )}
        >
          <Pencil className="mr-1 inline h-3.5 w-3.5" strokeWidth={1.75} />
          Editor
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("preview")}
          className={cn(
            "flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
            mobileTab === "preview"
              ? "border-cehta-green bg-cehta-green text-white"
              : "border-hairline bg-white text-ink-700",
          )}
        >
          <Eye className="mr-1 inline h-3.5 w-3.5" strokeWidth={1.75} />
          Preview
        </button>
      </div>

      {/* Split layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* EDITOR */}
        <div
          className={cn(
            "space-y-4",
            mobileTab !== "edit" && "hidden lg:block",
          )}
        >
          {/* Hero */}
          <Surface>
            <Surface.Header divider>
              <Surface.Title>Hero</Surface.Title>
              <Surface.Subtitle>
                Lo primero que ve el LP — saludo + número grande + 1 frase de
                contexto.
              </Surface.Subtitle>
            </Surface.Header>
            <Surface.Body className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Título
                </label>
                <input
                  type="text"
                  value={heroPayload?.titulo ?? ""}
                  onChange={(e) => updateHero({ titulo: e.target.value })}
                  disabled={readOnly}
                  placeholder="Sebastián, tu portafolio creció 23.4%."
                  className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-base font-display ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Subtítulo / narrativa
                </label>
                <textarea
                  value={heroPayload?.subtitulo ?? ""}
                  onChange={(e) => updateHero({ subtitulo: e.target.value })}
                  disabled={readOnly}
                  rows={2}
                  placeholder="Ganamos al benchmark FIP por 11 puntos."
                  className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                    KPI número
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={heroPayload?.kpi_destacado?.valor_numero ?? ""}
                    onChange={(e) =>
                      updateHero({
                        kpi_destacado: {
                          ...(heroPayload?.kpi_destacado ?? { label: "ROI YTD" }),
                          valor_numero: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        },
                      })
                    }
                    disabled={readOnly}
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                    Display
                  </label>
                  <input
                    type="text"
                    value={heroPayload?.kpi_destacado?.valor_string ?? ""}
                    onChange={(e) =>
                      updateHero({
                        kpi_destacado: {
                          ...(heroPayload?.kpi_destacado ?? { label: "ROI YTD" }),
                          valor_string: e.target.value,
                        },
                      })
                    }
                    disabled={readOnly}
                    placeholder="23.4%"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                    Label
                  </label>
                  <input
                    type="text"
                    value={heroPayload?.kpi_destacado?.label ?? ""}
                    onChange={(e) =>
                      updateHero({
                        kpi_destacado: {
                          ...(heroPayload?.kpi_destacado ?? {}),
                          label: e.target.value,
                        },
                      })
                    }
                    disabled={readOnly}
                    placeholder="ROI YTD"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                  />
                </div>
              </div>
            </Surface.Body>
          </Surface>

          {/* Empresas */}
          {empresasDestacadas.length > 0 && (
            <Surface>
              <Surface.Header divider>
                <Surface.Title>Storytelling por empresa</Surface.Title>
                <Surface.Subtitle>
                  Headline + párrafo + 3 métricas destacadas. Cada una es una
                  &quot;tarjeta editorial&quot; en el informe.
                </Surface.Subtitle>
              </Surface.Header>
              <Surface.Body className="space-y-4">
                {empresasDestacadas.map((cod) => {
                  const narr = empresasNarrativas[cod] ?? {};
                  return (
                    <div
                      key={cod}
                      className="rounded-2xl border border-hairline bg-ink-50/30 p-4"
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span className="rounded-md bg-cehta-green/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-cehta-green">
                          {cod}
                        </span>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                            Headline (8-12 palabras)
                          </label>
                          <input
                            type="text"
                            value={narr.headline ?? ""}
                            onChange={(e) =>
                              updateEmpresaNarrativa(cod, {
                                headline: e.target.value,
                              })
                            }
                            disabled={readOnly}
                            placeholder="Inauguramos 8MW en Panimávida un mes antes."
                            className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm font-display font-semibold ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                            Párrafo (2-3 oraciones, máx 60 palabras)
                          </label>
                          <textarea
                            value={narr.parrafo ?? ""}
                            onChange={(e) =>
                              updateEmpresaNarrativa(cod, {
                                parrafo: e.target.value,
                              })
                            }
                            disabled={readOnly}
                            rows={3}
                            className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
                            Métricas destacadas (3)
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {[0, 1, 2].map((idx) => {
                              const m = narr.metricas_destacadas?.[idx];
                              return (
                                <div key={idx} className="space-y-1">
                                  <input
                                    type="text"
                                    value={m?.valor ?? ""}
                                    onChange={(e) => {
                                      const arr = [
                                        ...(narr.metricas_destacadas ?? []),
                                      ];
                                      arr[idx] = {
                                        ...(arr[idx] ?? { label: "" }),
                                        valor: e.target.value,
                                      };
                                      updateEmpresaNarrativa(cod, {
                                        metricas_destacadas: arr,
                                      });
                                    }}
                                    disabled={readOnly}
                                    placeholder="8 MW"
                                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm font-display font-semibold ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                                  />
                                  <input
                                    type="text"
                                    value={m?.label ?? ""}
                                    onChange={(e) => {
                                      const arr = [
                                        ...(narr.metricas_destacadas ?? []),
                                      ];
                                      arr[idx] = {
                                        ...(arr[idx] ?? { valor: "" }),
                                        label: e.target.value,
                                      };
                                      updateEmpresaNarrativa(cod, {
                                        metricas_destacadas: arr,
                                      });
                                    }}
                                    disabled={readOnly}
                                    placeholder="instalados"
                                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-[10px] uppercase tracking-wider ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Surface.Body>
            </Surface>
          )}

          {/* CTA */}
          <Surface>
            <Surface.Header divider>
              <Surface.Title>Call to Action</Surface.Title>
              <Surface.Subtitle>
                Botones del cierre. El primario es el más importante (verde).
              </Surface.Subtitle>
            </Surface.Header>
            <Surface.Body className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  CTA principal (verde)
                </label>
                <input
                  type="text"
                  value={ctaPayload?.cta_principal ?? ""}
                  onChange={(e) =>
                    updateCta({ cta_principal: e.target.value })
                  }
                  disabled={readOnly}
                  placeholder="Agendá café con Guido (30 min)"
                  className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm font-medium ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Secundario 1
                  </label>
                  <input
                    type="text"
                    value={ctaPayload?.cta_secundario_1 ?? ""}
                    onChange={(e) =>
                      updateCta({ cta_secundario_1: e.target.value })
                    }
                    disabled={readOnly}
                    placeholder="Aumentar tu posición"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Secundario 2
                  </label>
                  <input
                    type="text"
                    value={ctaPayload?.cta_secundario_2 ?? ""}
                    onChange={(e) =>
                      updateCta({ cta_secundario_2: e.target.value })
                    }
                    disabled={readOnly}
                    placeholder="Compartir con un colega"
                    className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50"
                  />
                </div>
              </div>
            </Surface.Body>
          </Surface>
        </div>

        {/* PREVIEW iframe */}
        <div
          className={cn(
            "lg:sticky lg:top-4 lg:self-start",
            mobileTab !== "preview" && "hidden lg:block",
          )}
        >
          <Surface padding="none" className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
              <div className="flex items-center gap-2">
                <Eye className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
                <span className="text-xs font-medium text-ink-700">
                  Preview en vivo
                </span>
                {hasChanges && (
                  <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                    Cambios sin guardar
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewKey((k) => k + 1)}
                title="Refrescar preview"
                className="rounded-lg p-1 text-ink-500 hover:bg-ink-100/40"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
            <iframe
              key={previewKey}
              src={`/informe/${view.token}?preview=1`}
              title="Preview del informe"
              className="h-[800px] w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          </Surface>
        </div>
      </div>
    </div>
  );
}
