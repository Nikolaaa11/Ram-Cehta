"use client";

/**
 * /admin/informes-lp — dashboard interno de Informes LP virales.
 *
 * Tres áreas:
 * 1. KPIs globales (tasa apertura, share, viral 1→N)
 * 2. Tabla de informes generados con search + estado
 * 3. Top 5 advocates leaderboard
 */
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  TrendingUp,
  Eye,
  Share2,
  Trophy,
  ExternalLink,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  InformesAnalytics,
  InformeLpListItem,
} from "@/lib/api/schema";

export default function AdminInformesLpPage() {
  const [search, setSearch] = useState("");

  const informesQ = useApiQuery<InformeLpListItem[]>(
    ["informes-lp", "list"],
    "/informes-lp",
  );
  const analyticsQ = useApiQuery<InformesAnalytics>(
    ["informes-lp", "analytics"],
    "/informes-lp/admin/analytics",
  );

  const informes = informesQ.data ?? [];
  const filtered = search.trim()
    ? informes.filter(
        (i) =>
          i.titulo.toLowerCase().includes(search.toLowerCase()) ||
          (i.lp_nombre ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : informes;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Surface variant="glass">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
              Informes a Inversionistas
            </h1>
            <p className="mt-1 text-sm text-ink-600">
              Gestión y analytics de reportes LP. Cada informe trackea
              opens, time spent, shares y conversions.
            </p>
          </div>
          <Link
            href={"/admin/informes-lp/nuevo" as never}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Generar nuevo informe
          </Link>
        </div>
      </Surface>

      {/* KPIs */}
      {analyticsQ.isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : analyticsQ.data ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <KpiCard
            label="Generados"
            value={analyticsQ.data.total_generados}
            sub={`${analyticsQ.data.total_publicados} publicados`}
            Icon={Eye}
            tone="cehta"
          />
          <KpiCard
            label="Aperturas"
            value={analyticsQ.data.total_aperturas}
            sub={`${(analyticsQ.data.tasa_apertura * 100).toFixed(0)}% tasa`}
            Icon={Eye}
            tone="info"
          />
          <KpiCard
            label="Compartidos"
            value={analyticsQ.data.total_compartidos}
            sub={`${(analyticsQ.data.tasa_share * 100).toFixed(0)}% tasa share`}
            Icon={Share2}
            tone="positive"
          />
          <KpiCard
            label="Tiempo promedio"
            value={
              analyticsQ.data.tiempo_promedio_segundos != null
                ? `${Math.round(
                    analyticsQ.data.tiempo_promedio_segundos / 60,
                  )}min`
                : "—"
            }
            sub="por sesión"
            Icon={Clock}
            tone="ink"
          />
          <KpiCard
            label="Viral 1→N"
            value={
              analyticsQ.data.tasa_viral > 0
                ? `${analyticsQ.data.tasa_viral.toFixed(2)}x`
                : "—"
            }
            sub="downstream / opens"
            Icon={TrendingUp}
            tone={analyticsQ.data.tasa_viral >= 1 ? "positive" : "ink"}
          />
        </div>
      ) : null}

      {/* Top advocates */}
      {analyticsQ.data && analyticsQ.data.top_advocates.length > 0 && (
        <Surface>
          <Surface.Header divider>
            <Surface.Title>
              <span className="inline-flex items-center gap-2">
                <Trophy
                  className="h-5 w-5 text-warning"
                  strokeWidth={1.75}
                />
                Top advocates
              </span>
            </Surface.Title>
            <Surface.Subtitle>
              LPs que más comparten + traen aperturas downstream + conversions
            </Surface.Subtitle>
          </Surface.Header>
          <Surface.Body>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="text-left text-[10px] uppercase tracking-wider text-ink-400">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">LP</th>
                    <th className="px-3 py-2 text-right">Compartió a</th>
                    <th className="px-3 py-2 text-right">Aperturas</th>
                    <th className="px-3 py-2 text-right">Convertidos</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsQ.data.top_advocates.map((a, i) => (
                    <tr
                      key={a.lp_id}
                      className="border-t border-hairline text-sm hover:bg-ink-50/40"
                    >
                      <td className="px-3 py-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-warning/15 text-xs font-bold text-warning">
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-medium text-ink-900">
                        {a.lp_nombre}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {a.compartio_count}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {a.aperturas_downstream}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {a.convertidos > 0 ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-positive">
                            <ArrowUpRight
                              className="h-3 w-3"
                              strokeWidth={2}
                            />
                            {a.convertidos}
                          </span>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface.Body>
        </Surface>
      )}

      {/* Lista de informes */}
      <Surface>
        <Surface.Header divider>
          <Surface.Title>Todos los informes</Surface.Title>
          <Surface.Subtitle>{informes.length} en total</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título o LP…"
              className="w-full max-w-md rounded-xl border-0 bg-ink-50 px-4 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {informesQ.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              {search
                ? "Sin resultados para tu búsqueda"
                : "Aún no generaste informes"}
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((i) => (
                <InformeRow key={i.informe_id} informe={i} />
              ))}
            </ul>
          )}
        </Surface.Body>
      </Surface>
    </div>
  );
}

function InformeRow({ informe }: { informe: InformeLpListItem }) {
  return (
    <li className="flex items-center gap-4 rounded-xl border border-hairline bg-white px-4 py-3 transition-colors hover:bg-ink-50/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              informe.estado === "publicado"
                ? "success"
                : informe.estado === "borrador"
                ? "warning"
                : "neutral"
            }
          >
            {informe.estado}
          </Badge>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
            {informe.tipo.replace("_", " ")}
          </span>
          {informe.periodo && (
            <span className="text-xs text-ink-500">· {informe.periodo}</span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-ink-900">{informe.titulo}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {informe.lp_nombre || "Sin LP vinculado"}
          <span className="mx-1">·</span>
          {new Date(informe.created_at).toLocaleDateString("es-CL", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-4 text-xs">
        <div className="text-right">
          <p className="font-mono font-semibold tabular-nums text-ink-900">
            {informe.veces_abierto}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            opens
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono font-semibold tabular-nums text-ink-900">
            {informe.veces_compartido}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            shares
          </p>
        </div>

        {informe.estado === "publicado" && (
          <a
            href={`/informe/${informe.token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            Ver
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
          </a>
        )}
      </div>
    </li>
  );
}

function KpiCard({
  label,
  value,
  sub,
  Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  Icon: React.ElementType;
  tone: "cehta" | "info" | "positive" | "ink";
}) {
  const colors = {
    cehta: "bg-cehta-green/10 text-cehta-green",
    info: "bg-info/10 text-info",
    positive: "bg-positive/10 text-positive",
    ink: "bg-ink-100 text-ink-600",
  }[tone];
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-lg", colors)}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      <p className="text-[11px] text-ink-500">{sub}</p>
    </div>
  );
}
