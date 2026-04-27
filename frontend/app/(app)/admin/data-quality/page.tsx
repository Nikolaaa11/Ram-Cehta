import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ShieldCheck, ShieldAlert, PlugZap } from "lucide-react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { DataQualityIssue } from "@/components/admin/DataQualityIssue";
import { ApiError } from "@/lib/api/client";
import {
  ADMIN_ENDPOINTS,
  type DataQualityReport,
  type IssueSeverity,
} from "@/lib/admin/queries";

const SEVERITY_ORDER: IssueSeverity[] = ["high", "medium", "low"];
const SEVERITY_LABELS: Record<string, string> = {
  high: "Críticas",
  medium: "Medias",
  low: "Bajas",
};

interface FetchResult {
  report: DataQualityReport | null;
  endpointMissing: boolean;
  errorMessage: string | null;
}

async function fetchReport(): Promise<FetchResult> {
  try {
    const report = await serverApiGet<DataQualityReport>(
      ADMIN_ENDPOINTS.dataQuality(),
    );
    return { report, endpointMissing: false, errorMessage: null };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
      return { report: null, endpointMissing: true, errorMessage: null };
    }
    return {
      report: null,
      endpointMissing: false,
      errorMessage: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export default async function DataQualityPage() {
  const { report, endpointMissing, errorMessage } = await fetchReport();
  const issues = report?.issues ?? [];

  // Group por severity
  const grouped = new Map<string, typeof issues>();
  for (const sev of SEVERITY_ORDER) grouped.set(sev, []);
  for (const issue of issues) {
    const key = grouped.has(issue.severity) ? issue.severity : "low";
    const arr = grouped.get(key);
    if (arr) arr.push(issue);
  }

  const counts = {
    high: grouped.get("high")?.length ?? 0,
    medium: grouped.get("medium")?.length ?? 0,
    low: grouped.get("low")?.length ?? 0,
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Data Quality
          </h1>
          {report && (
            <span className="text-sm text-ink-500 tabular-nums">
              {issues.length} issue{issues.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {!endpointMissing && !errorMessage && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-negative/10 px-2.5 py-0.5 font-medium text-negative">
              <span className="h-1.5 w-1.5 rounded-full bg-negative" />
              {counts.high} críticas
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-0.5 font-medium text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              {counts.medium} medias
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sf-blue/10 px-2.5 py-0.5 font-medium text-sf-blue">
              <span className="h-1.5 w-1.5 rounded-full bg-sf-blue" />
              {counts.low} bajas
            </span>
          </div>
        )}
      </div>

      {/* Endpoint not available */}
      {endpointMissing && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <PlugZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Endpoint Data Quality no disponible
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El backend aún no expone{" "}
              <code className="font-mono text-xs">/audit/data-quality</code>.
            </p>
          </div>
        </Surface>
      )}

      {/* Error */}
      {errorMessage && (
        <Surface className="bg-negative/5 ring-negative/20">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="h-5 w-5 flex-shrink-0 text-negative"
              strokeWidth={1.5}
            />
            <div>
              <p className="text-sm font-medium text-negative">
                Error al cargar reporte
              </p>
              <p className="mt-1 text-xs text-negative/80">{errorMessage}</p>
            </div>
          </div>
        </Surface>
      )}

      {/* Empty (todo bien) */}
      {report && issues.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-positive/10">
              <ShieldCheck
                className="h-6 w-6 text-positive"
                strokeWidth={1.5}
              />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Todo en orden
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              No se detectaron issues de calidad de datos en el último análisis.
            </p>
          </div>
        </Surface>
      )}

      {/* Grouped issues */}
      {report && issues.length > 0 && (
        <div className="space-y-8">
          {SEVERITY_ORDER.map((sev) => {
            const list = grouped.get(sev) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={sev} className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  {SEVERITY_LABELS[sev]} · {list.length}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {list.map((issue, idx) => (
                    <DataQualityIssue
                      key={`${sev}-${issue.category}-${idx}`}
                      issue={issue}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
