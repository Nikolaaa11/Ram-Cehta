import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReporteCardProps {
  /** Número de orden, ej. "01". Editorial. */
  number?: string;
  icon: ReactNode;
  title: string;
  description: string;
  href: Route | string;
  /** Color de acento del icon container y la línea editorial. Default: cehta-green. */
  accent?: "cehta-green" | "sf-blue" | "sf-purple" | "sf-teal";
  /** Etiqueta corta para reportes nuevos (ej: "V5++"). */
  badge?: string;
}

const ACCENT_MAP: Record<NonNullable<ReporteCardProps["accent"]>, string> = {
  "cehta-green":
    "bg-cehta-green/8 text-cehta-green ring-cehta-green/15",
  "sf-blue": "bg-sf-blue/8 text-sf-blue ring-sf-blue/15",
  "sf-purple": "bg-sf-purple/8 text-sf-purple ring-sf-purple/15",
  "sf-teal": "bg-sf-teal/8 text-sf-teal ring-sf-teal/15",
};

const ACCENT_LINE: Record<NonNullable<ReporteCardProps["accent"]>, string> = {
  "cehta-green": "before:bg-cehta-green",
  "sf-blue": "before:bg-sf-blue",
  "sf-purple": "before:bg-sf-purple",
  "sf-teal": "before:bg-sf-teal",
};

export function ReporteCard({
  number,
  icon,
  title,
  description,
  href,
  accent = "cehta-green",
  badge,
}: ReporteCardProps) {
  return (
    <Link
      href={href as Route}
      className={cn(
        "group relative isolate flex h-full min-h-[240px] flex-col justify-between overflow-hidden rounded-3xl bg-white p-7 ring-1 ring-hairline transition-all duration-300 ease-apple",
        "before:absolute before:left-0 before:top-0 before:h-0 before:w-1 before:transition-all before:duration-500 before:ease-apple",
        "hover:-translate-y-1 hover:shadow-card-hover hover:ring-ink-900/10",
        "hover:before:h-full",
        ACCENT_LINE[accent],
      )}
    >
      {/* Subtle hover wash — Apple Card vibe */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 ease-apple group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(80% 100% at 100% 0%, rgba(0,0,0,0.025) 0%, transparent 60%)",
        }}
      />

      {/* Top row: número + icon + arrow */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {number && (
            <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wider text-ink-300">
              {number}
            </span>
          )}
          <div
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform duration-300 ease-apple group-hover:scale-110 group-hover:rotate-[-4deg]",
              ACCENT_MAP[accent],
            )}
          >
            {icon}
          </div>
        </div>
        <ArrowUpRight
          className="h-5 w-5 text-ink-300 transition-all duration-300 ease-apple group-hover:translate-x-1 group-hover:-translate-y-1 group-hover:text-ink-900"
          strokeWidth={1.5}
        />
      </div>

      {/* Bottom: title + description */}
      <div className="mt-10 space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-xl font-semibold tracking-tight text-ink-900">
            {title}
          </h3>
          {badge && (
            <span className="rounded-full bg-cehta-green/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cehta-green">
              {badge}
            </span>
          )}
        </div>
        <p className="text-[13.5px] leading-relaxed text-ink-500 sm:text-sm">
          {description}
        </p>
      </div>

      {/* Bottom-right CTA hint, aparece en hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-5 right-5 translate-y-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-400 opacity-0 transition-all duration-300 ease-apple group-hover:translate-y-0 group-hover:opacity-100"
      >
        Abrir →
      </span>
    </Link>
  );
}
