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
      {/* Hero editorial */}
      <header className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
          AI Asistente · Cehta
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Tu copiloto del portafolio
        </h1>
        <p className="max-w-2xl text-base text-ink-500">
          Tu Asistente AI tiene contexto financiero, legal y operativo de cada
          empresa. Elegí una para empezar la conversación.
        </p>
      </header>

      {/* Hint card */}
      <Surface variant="glass" className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
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
          {sorted.map((emp) => {
            const accent = colorFor(emp.codigo);
            return (
              <Link
                key={emp.codigo}
                href={`/empresa/${emp.codigo}/asistente`}
                className="group relative block overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-hairline shadow-card transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
              >
                {/* Wash on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{
                    background: `linear-gradient(135deg, ${accent}10 0%, transparent 60%)`,
                  }}
                />
                <div className="relative flex items-start gap-3">
                  <EmpresaLogo empresaCodigo={emp.codigo} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base font-semibold tracking-tight text-ink-900">
                      {emp.codigo}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">
                      {emp.razon_social ?? "—"}
                    </p>
                  </div>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-ink-300 transition-colors group-hover:text-cehta-green"
                    strokeWidth={1.75}
                  />
                </div>
                <div className="relative mt-4 flex items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
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
