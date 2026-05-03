"use client";

/**
 * /admin/informes-lp/nuevo — generar nuevo informe.
 *
 * Form de 4 campos: LP destinatario, tipo, período, tono.
 * Después del submit, redirige a la vista admin del informe creado
 * para que el GP pueda revisar la narrativa AI y publicar.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import type {
  InformeLpGenerateRequest,
  InformeLpRead,
  LpRead,
} from "@/lib/api/schema";

export default function NuevoInformePage() {
  const router = useRouter();
  const { session } = useSession();

  const lpsQ = useApiQuery<LpRead[]>(["lps", "list"], "/lps");

  const [form, setForm] = useState<InformeLpGenerateRequest>({
    lp_id: null,
    tipo: "periodico",
    titulo: null,
    periodo: defaultPeriodo(),
    incluir_empresas: null,
    tono: "ejecutivo",
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<InformeLpRead>("/informes-lp/generate", form, session),
    onSuccess: (data) => {
      toast.success("Informe generado — revisá narrativa AI antes de publicar");
      router.push(`/admin/informes-lp` as never);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error generando el informe.",
      );
    },
  });

  const lpsList = lpsQ.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={"/admin/informes-lp" as never}
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Volver
        </Link>
      </div>

      <Surface>
        <Surface.Header divider>
          <Surface.Title>
            <span className="inline-flex items-center gap-2">
              <Sparkles
                className="h-5 w-5 text-cehta-green"
                strokeWidth={1.75}
              />
              Generar nuevo informe
            </span>
          </Surface.Title>
          <Surface.Subtitle>
            La AI va a usar datos vivos del portafolio para personalizarlo.
            Después podés editar la narrativa antes de publicar.
          </Surface.Subtitle>
        </Surface.Header>

        <Surface.Body>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="space-y-5"
          >
            {/* LP destinatario */}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                LP destinatario
              </label>
              <select
                value={form.lp_id ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lp_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
                className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="">Sin LP (pitch genérico)</option>
                {lpsList.map((lp) => (
                  <option key={lp.lp_id} value={lp.lp_id}>
                    {lp.nombre}
                    {lp.apellido ? ` ${lp.apellido}` : ""}
                    {lp.empresa ? ` · ${lp.empresa}` : ""}
                    {lp.estado !== "activo" ? ` (${lp.estado})` : ""}
                  </option>
                ))}
              </select>
              {lpsList.length === 0 && (
                <p className="mt-1 text-xs text-ink-500">
                  Aún no hay LPs registrados.{" "}
                  <Link
                    href={"/admin/informes-lp/lps/nuevo" as never}
                    className="text-cehta-green hover:underline"
                  >
                    Crear el primero
                  </Link>
                </p>
              )}
            </div>

            {/* Tipo */}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Tipo de informe
              </label>
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tipo: e.target
                      .value as InformeLpGenerateRequest["tipo"],
                  })
                }
                className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="periodico">Periódico (trimestral)</option>
                <option value="update_mensual">Update mensual</option>
                <option value="memoria_anual">Memoria anual</option>
                <option value="tear_sheet">Tear sheet (1 página)</option>
                <option value="pitch_inicial">Pitch inicial (LP nuevo)</option>
              </select>
            </div>

            {/* Período */}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Período (ej: Q1 2026)
              </label>
              <input
                type="text"
                value={form.periodo ?? ""}
                onChange={(e) => setForm({ ...form, periodo: e.target.value })}
                placeholder="Q1 2026"
                className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>

            {/* Tono */}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Tono de la narrativa AI
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["ejecutivo", "narrativo", "tecnico"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, tono: t })}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      form.tono === t
                        ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                        : "border-hairline text-ink-600 hover:bg-ink-50"
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-2 border-t border-hairline pt-5">
              <Link
                href={"/admin/informes-lp" as never}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40"
              >
                Cancelar
              </Link>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      strokeWidth={2}
                    />
                    Generando con AI…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                    Generar informe
                  </>
                )}
              </button>
            </div>
          </form>
        </Surface.Body>
      </Surface>

      <p className="text-center text-xs text-ink-500">
        💡 La generación toma ~10-15 segundos (Claude redacta hero + empresas + CTA).
      </p>
    </div>
  );
}

function defaultPeriodo(): string {
  const now = new Date();
  const year = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  return `Q${quarter} ${year}`;
}
