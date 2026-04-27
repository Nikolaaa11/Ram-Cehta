/**
 * DataQualityIssue — card presentational para una issue de calidad de datos.
 *
 * Server-component-friendly. Sin estado interno.
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { DataQualityIssue as DQIssue } from "@/lib/admin/queries";

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-negative",
  medium: "bg-warning",
  low: "bg-sf-blue",
};

const SEVERITY_LABEL: Record<string, string> = {
  high: "Crítica",
  medium: "Media",
  low: "Baja",
};

export function DataQualityIssue({ issue }: { issue: DQIssue }) {
  const dot = SEVERITY_DOT[issue.severity] ?? "bg-ink-300";
  const sevLabel = SEVERITY_LABEL[issue.severity] ?? issue.severity;
  const link = issue.link as Route | undefined | null;

  return (
    <Surface variant={link ? "interactive" : "default"} padding="default">
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full",
            dot,
          )}
          aria-label={`Severidad ${sevLabel}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
              {sevLabel}
            </span>
            <span className="text-xs text-ink-300">·</span>
            <span className="text-xs font-medium text-ink-700">
              {issue.category}
            </span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">
            {issue.count.toLocaleString("es-CL")}
          </p>
          <p className="mt-1 text-sm text-ink-500">{issue.description}</p>
          {link && (
            <Link
              href={link}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
            >
              Ver
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          )}
        </div>
      </div>
    </Surface>
  );
}
