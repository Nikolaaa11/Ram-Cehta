import Link from "next/link";
import type { Route } from "next";
import { AlertCircle, AlertTriangle, Info, ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CeoAlert } from "@/lib/api/schema";

interface Props {
  alerts: CeoAlert[];
}

function iconFor(severity: string) {
  if (severity === "critical")
    return <AlertCircle className="h-4 w-4 text-negative" strokeWidth={1.75} />;
  if (severity === "warning")
    return <AlertTriangle className="h-4 w-4 text-warning" strokeWidth={1.75} />;
  return <Info className="h-4 w-4 text-sf-blue" strokeWidth={1.75} />;
}

function variantFor(severity: string): "danger" | "warning" | "info" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

export function TopAlerts({ alerts }: Props) {
  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-6 py-4">
        <Surface.Title>Top alertas</Surface.Title>
        <Surface.Subtitle>
          {alerts.length === 0
            ? "Todo bajo control"
            : `${alerts.length} ${alerts.length === 1 ? "issue" : "issues"} priorizado(s)`}
        </Surface.Subtitle>
      </Surface.Header>

      {alerts.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-ink-500">
          Sin alertas activas. El portafolio está saludable.
        </div>
      ) : (
        <ul className="divide-y divide-hairline">
          {alerts.map((a, idx) => {
            const Wrapper = (a.href ? Link : "div") as React.ElementType;
            const wrapperProps = a.href
              ? { href: a.href as Route }
              : ({} as Record<string, unknown>);
            return (
              <li key={`${a.empresa_codigo ?? "global"}-${idx}`}>
                <Wrapper
                  {...wrapperProps}
                  className={cn(
                    "flex items-start gap-3 px-6 py-3 transition-colors duration-150 ease-apple",
                    a.href && "hover:bg-ink-100/40",
                  )}
                >
                  <span className="mt-0.5">{iconFor(a.severity)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={variantFor(a.severity)}>{a.severity}</Badge>
                      <p className="text-sm font-medium text-ink-900">{a.title}</p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">{a.detail}</p>
                  </div>
                  {a.href && (
                    <ChevronRight
                      className="mt-1 h-4 w-4 shrink-0 text-ink-300"
                      strokeWidth={1.75}
                    />
                  )}
                </Wrapper>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
