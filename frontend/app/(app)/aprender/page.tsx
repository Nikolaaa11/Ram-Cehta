"use client";

/**
 * /aprender — Round 152v Centro de Aprendizaje.
 *
 * Aplica "Formación continua" (Ray Gallegos · Clase 1 p22):
 *   "Clave la FORMACION CONTINUA, FEEDBACK".
 *
 * Lista todos los módulos con su difficulty + duration + tu progreso.
 * Click en uno → /aprender/[slug] (módulo + quiz).
 */
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  Clock,
  CheckCircle2,
  ArrowRight,
  Trophy,
  Sparkles,
  Star,
  Award,
  Medal,
  Lock,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ModuleItem {
  module_id: number;
  slug: string;
  title: string;
  description: string | null;
  difficulty: string;
  duration_min: number;
  sort_order: number;
  completed: boolean;
  my_score: number | null;
}

const DIFFICULTY_CFG: Record<string, { label: string; bg: string; color: string }> = {
  principiante: { label: "Principiante", bg: "bg-emerald-50", color: "text-emerald-700" },
  intermedio: { label: "Intermedio", bg: "bg-amber-50", color: "text-amber-700" },
  avanzado: { label: "Avanzado", bg: "bg-red-50", color: "text-red-700" },
};

export default function AprenderPage() {
  const { session } = useSession();

  const { data: modules, isLoading } = useQuery<ModuleItem[]>({
    queryKey: ["training", "modules"],
    queryFn: () => apiClient.get<ModuleItem[]>("/training/modules", session),
    enabled: !!session,
  });

  const completed = modules?.filter((m) => m.completed).length ?? 0;
  const total = modules?.length ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const perfectScore = modules?.filter((m) => m.completed && m.my_score === 100).length ?? 0;
  const avgScore = (() => {
    const scored = modules?.filter((m) => m.completed && m.my_score !== null) ?? [];
    if (scored.length === 0) return 0;
    return Math.round(scored.reduce((s, m) => s + (m.my_score ?? 0), 0) / scored.length);
  })();

  // R152aa — Badges gamification (Formación Continua + recompensa por progreso)
  const badges = [
    {
      key: "first-step",
      label: "Primer paso",
      icon: Sparkles,
      unlocked: completed >= 1,
      desc: "Completaste tu primer módulo",
    },
    {
      key: "halfway",
      label: "A mitad de camino",
      icon: Star,
      unlocked: total > 0 && completed >= Math.ceil(total / 2),
      desc: `Completaste al menos ${Math.ceil(total / 2)} módulos`,
    },
    {
      key: "champion",
      label: "Campeón",
      icon: Award,
      unlocked: total > 0 && completed === total,
      desc: "Completaste todos los módulos",
    },
    {
      key: "perfectionist",
      label: "Perfeccionista",
      icon: Medal,
      unlocked: perfectScore >= 1,
      desc: "Sacaste 100% en al menos un quiz",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <GraduationCap className="size-7" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Centro de Aprendizaje
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Micro-módulos prácticos para dominar la plataforma. Cada uno tiene
            un quiz al final.
          </p>
        </div>
      </div>

      {/* Progress overall */}
      <div className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Tu progreso
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-900">
              {completed} de {total} módulos completados
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-bold text-cehta-green">{pct}%</p>
            {completed === total && total > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-800">
                <Trophy className="size-3.5" />
                Certificación completa
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full bg-cehta-green transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {completed > 0 && (
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
            <span>
              Promedio de quizzes: <strong className="text-ink-900">{avgScore}%</strong>
            </span>
            <span>
              Quizzes perfectos: <strong className="text-ink-900">{perfectScore}</strong>
            </span>
          </div>
        )}
      </div>

      {/* R152aa — Badges desbloqueables */}
      <div className="mt-6 rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-amber-500" strokeWidth={2} />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-700">
            Logros
          </h2>
          <span className="text-[10px] text-ink-400">
            ({badges.filter((b) => b.unlocked).length}/{badges.length})
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {badges.map((b) => {
            const Icon = b.unlocked ? b.icon : Lock;
            return (
              <div
                key={b.key}
                className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-all ${
                  b.unlocked
                    ? "border-amber-200 bg-gradient-to-br from-amber-50 to-white"
                    : "border-hairline bg-ink-50/30 opacity-50"
                }`}
                title={b.desc}
              >
                <Icon
                  className={`size-5 ${b.unlocked ? "text-amber-500" : "text-ink-400"}`}
                  strokeWidth={1.8}
                />
                <span
                  className={`text-[11px] font-semibold ${
                    b.unlocked ? "text-ink-900" : "text-ink-400"
                  }`}
                >
                  {b.label}
                </span>
                <span className="text-[9px] leading-tight text-ink-500">
                  {b.desc}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Módulos */}
      <h2 className="mt-10 mb-4 text-xs font-semibold uppercase tracking-wider text-ink-400">
        Módulos disponibles
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {isLoading && (
          <p className="col-span-2 py-12 text-center text-sm text-ink-400">
            Cargando módulos…
          </p>
        )}
        {(modules ?? []).map((m) => {
          const dCfg = DIFFICULTY_CFG[m.difficulty] ?? DIFFICULTY_CFG.principiante!;
          return (
            <Link
              key={m.slug}
              href={`/aprender/${m.slug}` as Route}
              className="group rounded-2xl border border-hairline bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg"
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dCfg.bg} ${dCfg.color}`}
                >
                  {dCfg.label}
                </span>
                {m.completed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-[10px] font-semibold text-cehta-green">
                    <CheckCircle2 className="size-3" />
                    {m.my_score}%
                  </span>
                )}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-ink-900 group-hover:text-cehta-green">
                {m.title}
              </h3>
              {m.description && (
                <p className="mt-1 text-sm leading-relaxed text-ink-600">
                  {m.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {m.duration_min} min
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-cehta-green group-hover:gap-2 group-hover:transition-all">
                  {m.completed ? "Repasar" : "Empezar"}
                  <ArrowRight className="size-3.5" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* R152qq — Tips de uso al final del Centro */}
      {!isLoading && (modules ?? []).length > 0 && (
        <div className="mt-10 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
            💡 Tips para sacarle más jugo
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-ink-700 md:grid-cols-2">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                Hacé los quizzes en orden — cada uno asume conceptos del anterior.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                Si no estás seguro de una respuesta, revisá el contenido antes de
                marcar — los badges premian la calidad, no la velocidad.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                Necesitás 70% para aprobar un módulo. 100% desbloquea el badge{" "}
                <strong>Perfeccionista</strong>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                Podés repasar un módulo cuando quieras — el progreso queda
                guardado.
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
