"use client";

/**
 * AdminEmptyState — empty state Apple-tier reutilizable para páginas
 * /admin/{policies-fondo,fondo-actas,estados-financieros,lp-documents,...}.
 *
 * Diseño:
 *   - Icono grande con tinte sutil cehta-green
 *   - Eyebrow editorial
 *   - Title + subtitle de bienvenida
 *   - CTA principal (Crear primer X) con animación hover
 *   - Hint secundario explicando qué va a aparecer cuando haya datos
 *
 * Distinto de "no hay resultados con esos filtros" — eso es otro caso
 * (para eso usar `<AdminFilteredEmpty />` o un mensaje minimalista).
 */
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

interface AdminEmptyStateProps {
  /** Icono lucide-react grande (h-12 w-12 dentro). */
  icon: ReactNode;
  /** Eyebrow uppercase tracking, ej. "Vault de políticas". */
  eyebrow: string;
  /** Título grande, ej. "Empezá tu compliance documental". */
  title: string;
  /** Body explicando qué se carga aquí, max ~2-3 líneas. */
  body: string;
  /** Texto del botón CTA. */
  ctaLabel: string;
  /** Handler del botón CTA. */
  onCta: () => void;
  /** Hint secundario opcional (texto chico abajo del CTA). */
  hint?: string;
}

export function AdminEmptyState({
  icon,
  eyebrow,
  title,
  body,
  ctaLabel,
  onCta,
  hint,
}: AdminEmptyStateProps) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-hairline bg-white">
      {/* Gradient mesh decorativo Apple-tier */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 60%)",
        }}
      />

      <div className="relative px-6 py-14 text-center sm:py-20">
        {/* Icon container */}
        <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-cehta-green/8 text-cehta-green ring-1 ring-cehta-green/15">
          <div className="[&>svg]:h-8 [&>svg]:w-8">{icon}</div>
        </div>

        {/* Eyebrow */}
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
          {eyebrow}
        </p>

        {/* Title */}
        <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
          {title}
        </h2>

        {/* Body */}
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-ink-600">
          {body}
        </p>

        {/* CTA */}
        <button
          type="button"
          onClick={onCta}
          className="group mt-7 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:bg-cehta-green-700 hover:shadow-card-hover"
        >
          <Plus
            className="h-4 w-4 transition-transform duration-200 ease-apple group-hover:rotate-90"
            strokeWidth={2.25}
          />
          {ctaLabel}
        </button>

        {hint && (
          <p className="mx-auto mt-5 max-w-md text-[11px] italic text-ink-400">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * AdminFilteredEmpty — caso "hay datos pero los filtros no devolvieron
 * nada". Más minimalista, no es un onboarding moment.
 */
export function AdminFilteredEmpty({
  message = "Sin resultados con esos filtros.",
  onClear,
}: {
  message?: string;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
      <p>{message}</p>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
