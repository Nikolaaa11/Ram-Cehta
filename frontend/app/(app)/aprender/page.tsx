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
    </div>
  );
}
