"use client";

/**
 * Compliance Board — Tab "Compliance" del Dashboard Director.
 * Round 152 — OPIM (Operating Principles for Impact Management) + CMF + CORFO.
 *
 * Status board institucional con framework filter y badges de severidad.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  ShieldAlert,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ComplianceItem {
  framework: string;
  principle_or_item: string;
  status: string;
  last_review_date: string | null;
  next_review_date: string | null;
  notes: string | null;
}

interface ComplianceResponse {
  fund_codigo: string;
  items: ComplianceItem[];
}

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; icon: typeof CheckCircle2 }
> = {
  compliant: { label: "Compliant", bg: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  in_progress: { label: "In progress", bg: "bg-amber-100 text-amber-700", icon: AlertCircle },
  non_compliant: { label: "Non compliant", bg: "bg-red-100 text-red-700", icon: ShieldAlert },
  not_applicable: { label: "N/A", bg: "bg-ink-100 text-ink-500", icon: CircleHelp },
  pending: { label: "Pending", bg: "bg-amber-100 text-amber-700", icon: AlertTriangle },
};

const FRAMEWORK_COLORS: Record<string, string> = {
  OPIM: "border-l-cehta-green",
  CMF: "border-l-blue-500",
  CORFO: "border-l-purple-500",
  ILPA: "border-l-amber-500",
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${cfg.bg}`}
    >
      <Icon className="size-3.5" />
      {cfg.label}
    </span>
  );
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("es-CL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d;
  }
}

export default function CompliancePage() {
  const { session } = useSession();
  const [filter, setFilter] = useState<string>("ALL");

  const { data: compliance, isLoading } = useQuery<ComplianceResponse>({
    queryKey: ["dashboard", "compliance"],
    queryFn: () =>
      apiClient.get<ComplianceResponse>("/dashboard/compliance", session),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152zz: datos institucionales cambian lentamente
  });

  const filtered = useMemo(() => {
    if (!compliance?.items) return [];
    if (filter === "ALL") return compliance.items;
    return compliance.items.filter((i) => i.framework === filter);
  }, [compliance, filter]);

  const frameworks = useMemo(() => {
    if (!compliance?.items) return [];
    return Array.from(new Set(compliance.items.map((i) => i.framework))).sort();
  }, [compliance]);

  // Stats por framework
  const stats = useMemo(() => {
    if (!compliance?.items) return {};
    const out: Record<string, { total: number; compliant: number }> = {};
    for (const it of compliance.items) {
      const cur = out[it.framework] ?? (out[it.framework] = { total: 0, compliant: 0 });
      cur.total += 1;
      if (it.status === "compliant") cur.compliant += 1;
    }
    return out;
  }, [compliance]);

  return (
    <main className="mx-auto max-w-[1440px] px-6 py-6 space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-900 flex items-center gap-2">
            <ClipboardCheck className="size-6 text-cehta-green" />
            Compliance Board
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            OPIM (Operating Principles for Impact Management) · CMF · CORFO · ILPA
          </p>
        </div>
      </header>

      {/* Stats por framework */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(stats).map(([fw, s]) => {
          const pct = s.total > 0 ? (s.compliant / s.total) * 100 : 0;
          return (
            <div
              key={fw}
              className={`rounded-2xl border-l-4 border border-hairline bg-card p-5 shadow-1 ${
                FRAMEWORK_COLORS[fw] ?? "border-l-ink-400"
              }`}
            >
              <div className="text-xs uppercase tracking-wide text-ink-500">
                {fw}
              </div>
              <div
                className="mt-2 text-3xl font-semibold text-ink-900"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {s.compliant}
                <span className="text-base text-ink-500 font-medium">
                  {" "}
                  / {s.total}
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
                <div
                  className={`h-full ${pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-cehta-green" : "bg-amber-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div
                className="mt-1 text-xs text-ink-500"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {pct.toFixed(0)}% compliant
              </div>
            </div>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setFilter("ALL")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filter === "ALL"
              ? "bg-cehta-green text-white"
              : "bg-ink-100 text-ink-700 hover:bg-ink-200"
          }`}
        >
          Todos
        </button>
        {frameworks.map((fw) => (
          <button
            key={fw}
            onClick={() => setFilter(fw)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === fw
                ? "bg-cehta-green text-white"
                : "bg-ink-100 text-ink-700 hover:bg-ink-200"
            }`}
          >
            {fw}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <section className="rounded-2xl bg-card border border-hairline shadow-1 overflow-hidden">
        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-ink-500">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-500">
            Sin items para el filtro seleccionado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/50 text-xs text-ink-500 uppercase">
                <tr>
                  <th className="px-5 py-3 text-left font-medium w-24">Framework</th>
                  <th className="px-5 py-3 text-left font-medium">Principio / Item</th>
                  <th className="px-5 py-3 text-left font-medium w-36">Status</th>
                  <th className="px-5 py-3 text-left font-medium w-28">Last review</th>
                  <th className="px-5 py-3 text-left font-medium w-28">Next review</th>
                  <th className="px-5 py-3 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it, idx) => (
                  <tr
                    key={`${it.framework}-${idx}`}
                    className="border-t border-hairline hover:bg-ink-50/30"
                  >
                    <td className="px-5 py-3">
                      <span className="inline-flex rounded px-2 py-0.5 text-xs font-mono font-semibold bg-ink-100 text-ink-700">
                        {it.framework}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-900 font-medium">
                      {it.principle_or_item}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={it.status} />
                    </td>
                    <td
                      className="px-5 py-3 text-ink-500 text-xs"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtDate(it.last_review_date)}
                    </td>
                    <td
                      className="px-5 py-3 text-ink-500 text-xs"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtDate(it.next_review_date)}
                    </td>
                    <td className="px-5 py-3 text-ink-500 text-xs max-w-md">
                      {it.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer info OPIM */}
      <div className="rounded-xl border border-hairline bg-ink-50/50 p-4 text-xs text-ink-500">
        <strong className="text-ink-700">Frameworks aplicables:</strong> OPIM (9
        principles, signatory desde 2023) · CMF (Norma 380/385/461) · CORFO LP
        side-letter · ILPA Reporting Template v2.0.
      </div>
    </main>
  );
}
