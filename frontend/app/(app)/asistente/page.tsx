"use client";

/**
 * AI Asistente · selector de empresa.
 *
 * El chat real vive scoped por empresa en `/empresa/{cod}/asistente` (cada
 * empresa tiene su propia knowledge base indexada). Esta página es un picker
 * editorial que muestra todas las empresas activas como cards linkeables.
 */
import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, Inbox, Sparkles } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { EMPRESA_COLOR } from "@/components/cartas-gantt/empresa-colors";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";

function colorFor(codigo: string): string {
  return EMPRESA_COLOR[codigo.toUpperCase()] ?? "#94a3b8";
}

export default function AsistentePickerPage() {
  const { data: empresas = [], isLoading, error } = useCatalogoEmpresas();

  const sorted = useMemo(
    () => [...empresas].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [empresas],
  );

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-6 py-6 lg:px-10">
      {/* Hero editorial premium con gradient mesh */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-emerald-50/40 ring-1 ring-cehta-green/15 p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 gradient-mesh opacity-60"
        />
        <Sparkles
          aria-hidden
          className="absolute right-8 top-8 h-4 w-4 text-amber-400/60 sparkle"
        />
        <Sparkles
          aria-hidden
          className="absolute right-24 top-16 h-3 w-3 text-cehta-green/50 sparkle"
          style={{ animationDelay: "0.5s" }}
        />
        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
            <span className="relative inline-flex h-1.5 w-1.5">
              <span className="absolute h-full w-full rounded-full bg-cehta-green/50 animate-pulse-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-cehta-green" />
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              AI Asistente · Powered by Claude
            </p>
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Tu <span className="text-gradient">copiloto</span> del portafolio
          </h1>
          <p className="max-w-2xl text-base text-ink-500">
            Tu Asistente AI tiene contexto financiero, legal y operativo de cada
            empresa. Elegí una para empezar la conversación.
          </p>
        </div>
      </header>

      {/* Hint card premium */}
      <Surface variant="glass" className="flex items-start gap-3">
        <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green ring-1 ring-cehta-green/20">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-900">
            Contexto por empresa
          </p>
          <p className="mt-0.5 text-sm text-ink-500">
            Cada asistente tiene memoria de movimientos, OCs, F29 y documentos
            legales de su empresa. Verificá decisiones financieras antes de
            actuar.
          </p>
        </div>
      </Surface>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-negative/10 text-negative">
            <Sparkles className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            No se pudo cargar el listado de empresas
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty */}
      {!isLoading && !error && sorted.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            No hay empresas activas
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Pedile a un admin que cargue al menos una empresa en el catálogo.
          </p>
        </Surface>
      )}

      {/* Grid */}
      {!isLoading && !error && sorted.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((emp, idx) => {
            const accent = colorFor(emp.codigo);
            return (
              <Link
                key={emp.codigo}
                href={`/empresa/${emp.codigo}/asistente`}
                style={{ animationDelay: `${Math.min(idx, 12) * 40}ms` }}
                className="group relative block overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-hairline shadow-card transition-all duration-300 ease-apple hover:-translate-y-1 hover:shadow-elevated-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green animate-slide-up-fade dark:bg-ink-900 dark:ring-ink-800"
              >
                {/* Accent border top */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${accent}80, transparent)`,
                  }}
                />
                {/* Wash on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background: `linear-gradient(135deg, ${accent}15 0%, transparent 60%)`,
                  }}
                />
                {/* Decorative blob on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-6 -bottom-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-80"
                  style={{ backgroundColor: `${accent}40` }}
                />
                <div className="relative flex items-start gap-3">
                  <div className="transition-transform duration-300 ease-apple group-hover:scale-110">
                    <EmpresaLogo empresaCodigo={emp.codigo} size={44} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-semibold tracking-tight text-ink-900 dark:text-ink-100 transition-colors group-hover:text-cehta-green">
                      {emp.codigo}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-ink-500 dark:text-ink-400">
                      {emp.razon_social ?? "—"}
                    </p>
                  </div>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-ink-300 transition-all duration-300 ease-apple group-hover:text-cehta-green group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="relative mt-4 flex items-center gap-2">
                  <span
                    className="relative inline-flex h-1.5 w-1.5 items-center justify-center"
                  >
                    <span
                      aria-hidden
                      className="absolute h-full w-full rounded-full opacity-50 animate-pulse-ring"
                      style={{ backgroundColor: accent }}
                    />
                    <span
                      className="relative h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500 transition-colors group-hover:text-cehta-green">
                    Abrir asistente
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
