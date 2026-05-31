import Link from "next/link";
import type { Route } from "next";
import { DatabaseZap, Sparkles } from "lucide-react";

/**
 * DashboardEmptyState — V5++ ola CA premium redesign.
 *
 * Hero centrado con gradient mesh sutil de fondo + decoración floating
 * sparkles + CTA con magnetic hover. Server component (sin "use client").
 */
export function DashboardEmptyState() {
  return (
    <div className="relative flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* Gradient mesh decoration */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh-animated opacity-60"
      />

      {/* Floating sparkles decorations */}
      <Sparkles
        aria-hidden
        className="absolute left-1/4 top-1/3 h-3 w-3 text-cehta-green/40 sparkle"
        style={{ animationDelay: "0s" }}
      />
      <Sparkles
        aria-hidden
        className="absolute right-1/3 top-1/2 h-4 w-4 text-amber-400/50 sparkle"
        style={{ animationDelay: "0.6s" }}
      />
      <Sparkles
        aria-hidden
        className="absolute left-1/3 bottom-1/3 h-3 w-3 text-sf-blue/40 sparkle"
        style={{ animationDelay: "1.2s" }}
      />

      <div className="relative slide-up-fade">
        <div className="relative inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cehta-green/10 via-emerald-50 to-teal-50 ring-1 ring-cehta-green/20 shadow-glow-green float-slow">
          <DatabaseZap
            className="h-9 w-9 text-cehta-green"
            strokeWidth={1.5}
          />
        </div>
        <h2 className="mt-8 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Aún no hay datos disponibles
        </h2>
        <p className="mt-3 max-w-md text-sm text-ink-500">
          El ETL todavía no ha corrido. Cuando se ejecute por primera vez, los
          datos del dashboard aparecerán aquí.
        </p>
        <Link
          href={"/admin/etl" as Route}
          className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white shadow-glow-green transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-elevated-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
        >
          Ver estado del ETL
          <span className="transition-transform duration-200 group-hover:translate-x-1">
            →
          </span>
        </Link>
      </div>
    </div>
  );
}
