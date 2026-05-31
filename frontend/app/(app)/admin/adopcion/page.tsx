"use client";

/**
 * /admin/adopcion — Round 152u
 *
 * Aplica "Mapeo de Actores del Proceso de Cambio" (Ray Gallegos · Clase 2 p41):
 *   Clasifica cada user en Aliado / Espectador / Detractor × impacto A/M/B
 *   para que el admin pueda intervenir donde corresponde.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  TrendingDown,
  Eye,
  AlertCircle,
  MailQuestion,
  Crown,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { AdoptionQuadrant } from "@/components/admin/AdoptionQuadrant";
// R152uu — Lazy DonutKPI (recharts ~80kB).
import { LazyDonutKPI as DonutKPI } from "@/components/charts/lazy";
import { useSession } from "@/hooks/use-session";

interface AdoptionRow {
  user_id: string;
  email: string;
  app_role: string;
  empresas: string | null;
  last_login: string | null;
  days_inactive: number | null;
  actions_30d: number;
  classification: "aliado" | "espectador" | "detractor" | "sin_activacion";
  impact_level: "A" | "M" | "B";
}

const CLASSIFICATION_CFG: Record<
  string,
  { label: string; color: string; bg: string; ico: typeof TrendingUp; suggestion: string }
> = {
  aliado: {
    label: "Aliado",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
    ico: TrendingUp,
    suggestion: "Convertilo en embajador del cambio. Pedí su feedback en decisiones.",
  },
  espectador: {
    label: "Espectador",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
    ico: Eye,
    suggestion: "Acercalo a un Aliado. Compartile micro-tutoriales del Centro de Aprendizaje.",
  },
  detractor: {
    label: "Detractor",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
    ico: TrendingDown,
    suggestion: "Escucha primero: ¿no sabe / no puede / no quiere? Reset clave + 1:1.",
  },
  sin_activacion: {
    label: "Sin activar",
    color: "text-ink-500",
    bg: "bg-ink-50 border-hairline",
    ico: MailQuestion,
    suggestion: "Nunca entró. Mandar email de bienvenida + setup de clave.",
  },
};

export default function AdopcionPage() {
  const { session } = useSession();

  const { data: rows, isLoading, error } = useQuery<AdoptionRow[]>({
    queryKey: ["admin", "adoption", "map"],
    queryFn: () =>
      apiClient.get<AdoptionRow[]>("/admin/adoption/map", session),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152ww — adopción cambia lentamente (5 min)
  });

  const stats = useMemo(() => {
    const items = rows ?? [];
    return {
      total: items.length,
      aliados: items.filter((r) => r.classification === "aliado").length,
      espectadores: items.filter((r) => r.classification === "espectador").length,
      detractores: items.filter((r) => r.classification === "detractor").length,
      sin_activar: items.filter((r) => r.classification === "sin_activacion").length,
      impactoA: items.filter((r) => r.impact_level === "A").length,
    };
  }, [rows]);

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
          <p className="font-semibold">No se pudo cargar el mapa de adopción.</p>
          <p className="mt-1 text-xs">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
          <p className="mt-2 text-xs">Verificá que tu rol sea admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <Users className="size-6" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Mapa de Adopción
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Clasificación de usuarios según el modelo de Mapeo de Actores del
            Proceso de Cambio. Ordenado por actividad real (últimos 30 días).
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Usuarios"
          value={stats.total}
          color="text-ink-900"
          bg="bg-ink-50"
        />
        <StatCard
          label="🟢 Aliados"
          value={stats.aliados}
          color="text-emerald-700"
          bg="bg-emerald-50"
        />
        <StatCard
          label="🔵 Espectadores"
          value={stats.espectadores}
          color="text-blue-700"
          bg="bg-blue-50"
        />
        <StatCard
          label="🔴 Detractores"
          value={stats.detractores}
          color="text-red-700"
          bg="bg-red-50"
        />
        <StatCard
          label="⚪ Sin activar"
          value={stats.sin_activar}
          color="text-ink-500"
          bg="bg-ink-50"
        />
      </div>

      {/* R152cc — Donuts de salud de adopción */}
      <div className="mt-6 flex flex-wrap items-center justify-around gap-4 rounded-2xl border border-hairline bg-gradient-to-br from-white to-ink-50/40 p-6 shadow-card">
        <div className="text-center">
          <DonutKPI
            value={stats.aliados}
            total={Math.max(stats.total, 1)}
            label="% Aliados"
            color="#10B981"
            size={130}
          />
        </div>
        <div className="text-center">
          <DonutKPI
            value={stats.total - stats.sin_activar}
            total={Math.max(stats.total, 1)}
            label="% Activos"
            color="#3B82F6"
            size={130}
          />
        </div>
        <div className="text-center">
          <DonutKPI
            value={stats.detractores}
            total={Math.max(stats.total, 1)}
            label="% Detractores"
            color="#DC2626"
            size={130}
          />
        </div>
        <div className="text-center">
          <DonutKPI
            value={stats.impactoA}
            total={Math.max(stats.total, 1)}
            label="% Alto impacto"
            color="#F59E0B"
            size={130}
          />
        </div>
      </div>

      {/* R152cc — Mapa cuadrante 2×2 */}
      <section className="mt-6 rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink-900">
              Mapa de cuadrantes · clasificación × impacto
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Cada punto es un usuario. Tu prioridad: <strong>Aliados-A</strong>{" "}
              (cultivar) y <strong>Detractores-A</strong> (intervenir ya).
            </p>
          </div>
        </header>
        {!isLoading && rows && <AdoptionQuadrant rows={rows} />}
      </section>

      {/* Concept card */}
      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-5 text-sm text-amber-900">
        <p className="font-semibold">
          🎓 Marco: Mapeo de Actores (Ray Gallegos · Liderazgo y Gestión del Cambio)
        </p>
        <p className="mt-1.5 text-xs leading-relaxed">
          Para hacer exitoso un cambio organizacional, identificá a tus{" "}
          <strong>Aliados</strong> (≥20 acciones/mes), tus{" "}
          <strong>Espectadores</strong> (5-19), tus <strong>Detractores</strong>{" "}
          (0 acciones en 30 días) y los <strong>Sin activar</strong> (nunca
          entraron). Las técnicas para abordar resistencia son distintas según
          la fase: información para "No sé", formación para "No puedo",
          motivación para "No quiero".
        </p>
      </div>

      {/* Tabla */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h3 className="text-base font-semibold text-ink-900">
            Tabla detallada · {rows?.length ?? 0} usuarios
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Ordenada por actividad descendente. Click en un user para ver
            sugerencia de acción.
          </p>
        </header>
        <div className="overflow-x-auto">
          {isLoading ? (
            <p className="py-12 text-center text-sm text-ink-400">Cargando…</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Rol</th>
                  <th className="px-4 py-3 text-center font-semibold">Clasificación</th>
                  <th className="px-4 py-3 text-center font-semibold">Impacto</th>
                  <th className="px-4 py-3 text-right font-semibold">Acciones 30d</th>
                  <th className="px-4 py-3 text-right font-semibold">Sin entrar (días)</th>
                  <th className="px-4 py-3 text-left font-semibold">Acción sugerida</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {(rows ?? []).map((r) => {
                  const cfg = CLASSIFICATION_CFG[r.classification] ?? CLASSIFICATION_CFG.espectador!;
                  const Ico = cfg.ico;
                  return (
                    <tr key={r.user_id} className="hover:bg-ink-50/40">
                      <td className="px-4 py-2.5 font-mono text-xs">{r.email}</td>
                      <td className="px-4 py-2.5">
                        {r.app_role === "admin" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            <Crown className="size-3" /> admin
                          </span>
                        )}
                        {r.app_role !== "admin" && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                            {r.app_role}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.bg} ${cfg.color}`}
                        >
                          <Ico className="size-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`inline-flex size-6 items-center justify-center rounded-full text-[10px] font-bold ${
                            r.impact_level === "A"
                              ? "bg-red-100 text-red-700"
                              : r.impact_level === "M"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-ink-100 text-ink-600"
                          }`}
                          title={
                            r.impact_level === "A"
                              ? "Alto impacto"
                              : r.impact_level === "M"
                                ? "Medio"
                                : "Bajo"
                          }
                        >
                          {r.impact_level}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                        {r.actions_30d}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-500">
                        {r.days_inactive == null ? (
                          <span className="text-ink-300">nunca</span>
                        ) : r.days_inactive > 30 ? (
                          <span className="font-medium text-red-700">{r.days_inactive}d</span>
                        ) : (
                          `${r.days_inactive}d`
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">
                        {cfg.suggestion}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={`rounded-2xl border border-hairline ${bg} p-4`}>
      <p className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 text-3xl font-bold ${color}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
    </div>
  );
}
