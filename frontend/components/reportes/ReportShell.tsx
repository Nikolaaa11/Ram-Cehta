"use client";

/**
 * ReportShell — chassis Apple-tier para los 4 reportes formales.
 *
 * Estructura:
 *   [Breadcrumb minimalista]
 *   [Eyebrow + Hero title + subtitle + actions (right)]
 *   [Filtros opcionales — sticky en scroll desktop]
 *   [Contenido del reporte]
 *   [Signature Cehta — formal footer]
 *
 * Optimizado para print: el breadcrumb + eyebrow se ocultan; el footer
 * se mantiene; cards no rompen entre páginas.
 */
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

interface ReportShellProps {
  /** Eyebrow text — short label arriba del title. Default: "Reportes formales". */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Acciones (botones) a la derecha del header. */
  actions?: ReactNode;
  /** Filtros — barra horizontal entre header y body. Sticky en scroll. */
  filters?: ReactNode;
  /** Contenido principal del reporte. */
  children: ReactNode;
  /** Texto de footer custom. Default: signature Cehta. */
  footerNote?: ReactNode;
}

export function ReportShell({
  eyebrow = "Reporte formal · FIP CEHTA ESG",
  title,
  subtitle,
  actions,
  filters,
  children,
  footerNote,
}: ReportShellProps) {
  return (
    <div className="relative">
      {/* Mesh gradient muy sutil — Apple-tier ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px] overflow-hidden print:hidden"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20">
        {/* Breadcrumb minimalista — oculto en print */}
        <Link
          href="/reportes"
          className="group inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-400 transition-colors hover:text-cehta-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green rounded-md print:hidden"
        >
          <ChevronLeft
            className="h-3.5 w-3.5 transition-transform duration-200 ease-apple group-hover:-translate-x-0.5"
            strokeWidth={2}
          />
          Volver a Reportes
        </Link>

        {/* Hero header */}
        <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              {eyebrow}
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-600">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {actions}
            </div>
          ) : null}
        </header>

        {/* Filtros — sticky en scroll */}
        {filters ? (
          <div className="sticky top-0 z-30 -mx-6 mt-8 border-b border-hairline/60 bg-white/80 px-6 py-3 backdrop-blur-xl lg:-mx-10 lg:px-10 print:hidden print:static print:border-0">
            {filters}
          </div>
        ) : (
          <div className="mt-8" />
        )}

        {/* Contenido */}
        <div className="space-y-6">{children}</div>

        {/* Signature Cehta */}
        <ReportSignature note={footerNote} />
      </div>
    </div>
  );
}

function ReportSignature({ note }: { note?: ReactNode }) {
  return (
    <footer className="mt-20 border-t border-hairline pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3 text-[11px] text-ink-400">
        <div className="space-y-1">
          <p className="font-semibold uppercase tracking-[0.18em] text-ink-500">
            Cehta Capital · FIP CEHTA ESG
          </p>
          <p>
            {note ?? (
              <>
                Documento confidencial. Generado en tiempo real desde la base
                operativa consolidada · GP: Guido Rietta.
              </>
            )}
          </p>
        </div>
        <p className="font-mono tabular-nums">
          {new Date().toLocaleDateString("es-CL", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })}
        </p>
      </div>
    </footer>
  );
}
