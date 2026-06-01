"use client";

/**
 * /sugerencias — Buzón de sugerencias estructurado (R152nnn).
 *
 * Reusa la tabla core.user_feedback (R152t) con un action_type especial
 * "sugerencia.platform" para distinguirlas del NPS de flujos puntuales.
 *
 * El usuario puede:
 *   - Enviar una sugerencia con título, categoría, descripción, impacto esperado
 *   - Ver sus sugerencias enviadas (timeline)
 *
 * Los admins ven todas las sugerencias agregadas en /admin/feedback.
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare,
  Sparkles,
  Bug,
  Zap,
  CheckCircle2,
  ArrowRight,
  Send,
  Lightbulb,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface SugerenciaForm {
  categoria: "feature" | "bug" | "ux" | "performance" | "otro";
  titulo: string;
  descripcion: string;
  impacto: string;
}

const CATEGORIAS = [
  {
    value: "feature",
    label: "Nueva funcionalidad",
    icon: Sparkles,
    desc: "Algo nuevo que la plataforma debería poder hacer",
    color: "emerald",
  },
  {
    value: "bug",
    label: "Bug / Error",
    icon: Bug,
    desc: "Algo no está funcionando como debería",
    color: "red",
  },
  {
    value: "ux",
    label: "Mejora de UX",
    icon: Lightbulb,
    desc: "Algo que existe pero podría ser más claro o fácil",
    color: "amber",
  },
  {
    value: "performance",
    label: "Performance",
    icon: Zap,
    desc: "Algo que está lento o pesado",
    color: "blue",
  },
  {
    value: "otro",
    label: "Otro",
    icon: MessageSquare,
    desc: "Otra cosa que no encaja en lo anterior",
    color: "purple",
  },
] as const;

export default function SugerenciasPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<SugerenciaForm>({
    categoria: "feature",
    titulo: "",
    descripcion: "",
    impacto: "",
  });

  const submitMut = useMutation({
    mutationFn: async (data: SugerenciaForm) => {
      // Score 3 para sugerencias positivas (el modelo NPS tiene 1-3,
      // donde 3 = positivo. Las sugerencias se guardan con 3 para que
      // no impacten el promedio NPS de flujos).
      // El title + descripción van concatenados en comment.
      const comment =
        `[${data.categoria.toUpperCase()}] ${data.titulo}\n\n` +
        `${data.descripcion}\n\n` +
        (data.impacto ? `Impacto esperado: ${data.impacto}` : "");

      return apiClient.post(
        "/me/feedback",
        {
          action_type: "sugerencia.platform",
          score: 3,
          comment,
          context: {
            categoria: data.categoria,
            titulo: data.titulo,
            impacto: data.impacto,
          },
        },
        session,
      );
    },
    onSuccess: () => {
      toast.success("¡Sugerencia enviada! Gracias por ayudarnos a mejorar.");
      setSubmitted(true);
      setForm({
        categoria: "feature",
        titulo: "",
        descripcion: "",
        impacto: "",
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "feedback", "summary"],
      });
    },
    onError: (e: Error) => {
      toast.error(`No se pudo enviar: ${e.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo.trim() || !form.descripcion.trim()) {
      toast.error("Completa al menos el título y la descripción");
      return;
    }
    submitMut.mutate(form);
  };

  const colorBg: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    purple: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      {/* Header */}
      <header>
        <div className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 ring-1 ring-purple-200">
          <MessageSquare className="size-3.5 text-purple-700" strokeWidth={2} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-purple-800">
            Mejora la plataforma
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Tus sugerencias mejoran la plataforma
        </h1>
        <p className="mt-2 max-w-2xl text-base text-ink-600">
          ¿Hay algo que falta, que se siente lento, que es confuso, o que
          simplemente no termina de convencerte? Cuéntanos. Cada sugerencia se
          revisa y prioriza en las próximas releases.
        </p>
      </header>

      {submitted ? (
        <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50/60 p-8 text-center shadow-card">
          <div className="mx-auto inline-flex size-16 items-center justify-center rounded-3xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-8" strokeWidth={1.5} />
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold text-emerald-900">
            ¡Recibida!
          </h2>
          <p className="mt-2 text-sm text-emerald-800">
            Tu sugerencia llegó al equipo de producto. La vamos a revisar y
            priorizar en las próximas iteraciones.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-purple-700"
            >
              Enviar otra sugerencia
            </button>
            <Link
              href={"/claudia" as never}
              className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Categoría */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-700">
              Tipo de sugerencia
            </label>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
              {CATEGORIAS.map((cat) => {
                const Icon = cat.icon;
                const isSelected = form.categoria === cat.value;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setForm({ ...form, categoria: cat.value })}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      isSelected
                        ? "border-purple-400 bg-purple-50/60 shadow-card ring-2 ring-purple-200"
                        : "border-hairline bg-white hover:border-purple-200 hover:bg-purple-50/30"
                    }`}
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${colorBg[cat.color]}`}
                    >
                      <Icon className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">
                        {cat.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-500">
                        {cat.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Título */}
          <div>
            <label
              htmlFor="titulo"
              className="text-xs font-semibold uppercase tracking-wider text-ink-700"
            >
              Título corto <span className="text-red-600">*</span>
            </label>
            <input
              id="titulo"
              type="text"
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              maxLength={120}
              placeholder="Ej: 'El botón Crear voucher debería estar más visible'"
              required
              className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm text-ink-900 ring-1 ring-transparent transition-all focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
            <p className="mt-1 text-[10px] text-ink-400">
              {form.titulo.length}/120 caracteres
            </p>
          </div>

          {/* Descripción */}
          <div>
            <label
              htmlFor="descripcion"
              className="text-xs font-semibold uppercase tracking-wider text-ink-700"
            >
              Descripción detallada <span className="text-red-600">*</span>
            </label>
            <textarea
              id="descripcion"
              value={form.descripcion}
              onChange={(e) =>
                setForm({ ...form, descripcion: e.target.value })
              }
              maxLength={2000}
              rows={5}
              placeholder="Cuéntanos en detalle qué te gustaría que cambie o se agregue. Mientras más específico mejor: dónde está, qué pasa, qué esperarías que pase."
              required
              className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-3 text-sm text-ink-900 ring-1 ring-transparent transition-all focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
            <p className="mt-1 text-[10px] text-ink-400">
              {form.descripcion.length}/2000 caracteres
            </p>
          </div>

          {/* Impacto */}
          <div>
            <label
              htmlFor="impacto"
              className="text-xs font-semibold uppercase tracking-wider text-ink-700"
            >
              Impacto esperado (opcional)
            </label>
            <input
              id="impacto"
              type="text"
              value={form.impacto}
              onChange={(e) => setForm({ ...form, impacto: e.target.value })}
              maxLength={300}
              placeholder="Ej: 'Me ahorraría 10 minutos cada mes', 'Evitaría errores de mapeo'"
              className="mt-2 w-full rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm text-ink-900 ring-1 ring-transparent transition-all focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
          </div>

          {/* Submit */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={
                submitMut.isPending ||
                !form.titulo.trim() ||
                !form.descripcion.trim()
              }
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-purple-700 disabled:opacity-60"
            >
              {submitMut.isPending ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Enviando…
                </>
              ) : (
                <>
                  <Send className="size-4" strokeWidth={1.8} />
                  Enviar sugerencia
                </>
              )}
            </button>
            <Link
              href={"/claudia" as never}
              className="text-xs font-medium text-ink-500 hover:text-ink-900"
            >
              Cancelar
            </Link>
          </div>
        </form>
      )}

      {/* Cómo usamos las sugerencias */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-sm">
        <p className="font-semibold text-blue-900">
          🎓 Qué pasa con tu sugerencia
        </p>
        <ol className="mt-3 space-y-2 text-xs leading-relaxed text-blue-900">
          <li>
            <strong>1. Recepción</strong> — Tu sugerencia llega al equipo de
            producto.
          </li>
          <li>
            <strong>2. Triaje semanal</strong> — Los lunes se priorizan según
            impacto + esfuerzo + cantidad de usuarios afectados.
          </li>
          <li>
            <strong>3. Backlog</strong> — Las prioritarias entran al backlog
            público en <code>docs/BACKLOG.md</code> del repo.
          </li>
          <li>
            <strong>4. Implementación</strong> — Los viernes se libera 1 mejora
            del backlog (schedule automático).
          </li>
          <li>
            <strong>5. Notificación</strong> — Cuando tu sugerencia se
            implementa, te avisamos via el banner "Novedades" en el dashboard.
          </li>
        </ol>
        <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-700">
          <ArrowRight className="size-3" />
          Mientras más detalle des, más rápido podemos actuar.
        </p>
      </div>
    </div>
  );
}
