"use client";

/**
 * /admin/health — visualización en tiempo real de /api/v1/health/detailed.
 *
 * Polling cada 30s. Útil para monitorear:
 *  - Database conectada
 *  - Alembic head (para detectar deploys con migrations pendientes)
 *  - Servicios externos configurados (IMAP, Anthropic, Dropbox, Resend, OpenAI)
 *  - Counts operativos (vouchers, inbox, F22, F29)
 *
 * Si algo aparece en rojo, da pista directa de qué setup falta.
 */
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Database,
  Clock,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface DetailedHealth {
  status: string;
  database: string;
  alembic_head: string | null;
  services: Record<string, string>;
  counts: Record<string, number>;
  version: string;
}

const SERVICE_LABELS: Record<string, string> = {
  imap_inbox: "Gmail IMAP (inbox processor)",
  anthropic: "Claude API (AI features)",
  dropbox: "Dropbox (sync archivos)",
  resend: "Resend (email outbound)",
  openai_embeddings: "OpenAI embeddings (AI Knowledge Base)",
};

const COUNT_LABELS: Record<string, string> = {
  empresas_activas: "Empresas activas",
  vouchers_total: "Vouchers totales",
  vouchers_pending: "Vouchers PENDING firma",
  inbox_total: "Emails inbox totales",
  inbox_pending_review: "Emails pendientes revisión",
  cartolas_runs_total: "Cartolas OCR runs",
  f29_pendientes: "F29 pendientes",
  f22_pendientes: "F22 pendientes",
};

export default function AdminHealthPage() {
  const { session } = useSession();

  const { data, isLoading, isError, refetch } = useQuery<DetailedHealth>({
    queryKey: ["admin-health-detailed"],
    queryFn: () =>
      apiClient.get<DetailedHealth>("/health/detailed", session),
    enabled: !!session,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900 dark:text-ink-100">
          Health del sistema
        </h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
          Status en tiempo real del backend, DB, servicios externos y counts
          operativos. Polling cada 30s.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-ink-500">Cargando health…</p>
      )}

      {isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-700">
            No se pudo conectar al backend
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-xs text-red-600 underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Hero status global */}
          <div
            className={`rounded-2xl border p-5 ${
              data.status === "ok"
                ? "border-cehta-green/30 bg-cehta-green/5 dark:bg-cehta-green/10"
                : "border-red-300 bg-red-50 dark:bg-red-950/20"
            }`}
          >
            <div className="flex items-center gap-3">
              {data.status === "ok" ? (
                <CheckCircle2
                  className="h-7 w-7 text-cehta-green"
                  strokeWidth={1.75}
                />
              ) : (
                <XCircle
                  className="h-7 w-7 text-red-600"
                  strokeWidth={1.75}
                />
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                  Status overall
                </p>
                <p className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-100">
                  {data.status === "ok" ? "Operativo" : "Degradado"}
                </p>
                <p className="text-xs text-ink-500">
                  Versión {data.version} · DB {data.database} · Alembic{" "}
                  {data.alembic_head ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Servicios externos */}
          <div className="rounded-2xl border border-hairline bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center gap-2 mb-3">
              <Activity
                className="h-4 w-4 text-ink-500"
                strokeWidth={1.75}
              />
              <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100">
                Servicios externos
              </h2>
            </div>
            <ul className="divide-y divide-hairline dark:divide-ink-800">
              {Object.entries(data.services).map(([key, status]) => (
                <li
                  key={key}
                  className="flex items-center justify-between py-2.5"
                >
                  <p className="text-sm text-ink-700 dark:text-ink-300">
                    {SERVICE_LABELS[key] ?? key}
                  </p>
                  {status === "configured" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs font-medium text-cehta-green">
                      <CheckCircle2
                        className="h-3 w-3"
                        strokeWidth={2}
                      />
                      Configurado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      <AlertTriangle
                        className="h-3 w-3"
                        strokeWidth={2}
                      />
                      Sin configurar
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Counts operativos */}
          <div className="rounded-2xl border border-hairline bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-center gap-2 mb-3">
              <Database
                className="h-4 w-4 text-ink-500"
                strokeWidth={1.75}
              />
              <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-ink-100">
                Counts operativos
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(data.counts).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-xl border border-hairline bg-ink-50/30 p-3 dark:border-ink-800 dark:bg-ink-800/30"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    {COUNT_LABELS[key] ?? key}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900 dark:text-ink-100">
                    {value.toLocaleString("es-CL")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Auto-refresh hint */}
          <p className="text-[11px] italic text-ink-400 inline-flex items-center gap-1">
            <Clock className="h-3 w-3" strokeWidth={1.75} />
            Refresh automático cada 30 segundos. Última actualización{" "}
            {new Date().toLocaleTimeString("es-CL")}.
          </p>
        </>
      )}
    </div>
  );
}
