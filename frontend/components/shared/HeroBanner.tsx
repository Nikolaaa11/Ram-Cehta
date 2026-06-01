"use client";

/**
 * HeroBanner — Round 100
 *
 * Componente compartido que encapsula el patrón de hero unificado de
 * las pantallas core (system-status, subsidios, proyectos, vouchers/corfo,
 * mis-pendientes, transferencias, aprobaciones).
 *
 * Inspirado en el patrón visual del prompt ULTRA_MEGA_PROMPT_V2 que
 * apuntaba al repo claude-cheatsheet/NIKOLAI, adaptado al brand
 * Cehta Capital. Beneficios de DRY-earlo:
 *
 *   - Una sola fuente de verdad para el estilo visual del hero.
 *   - Tweaks (tamaño del glow, opacity del grid, etc.) se propagan
 *     automáticamente a todas las pantallas.
 *   - Páginas nuevas que necesiten hero importan este componente
 *     en una línea en vez de copy-pastear ~25 líneas de CSS.
 *
 * Uso:
 *   <HeroBanner
 *     pillIcon={<Wallet className="size-3.5 text-cehta-green" />}
 *     pillText="Confirmar pagos · Planilla bancaria"
 *     title="Validar y pagar"
 *     subtitle="Vouchers APPROVED listos para pago. Revisa datos..."
 *   />
 *
 * Con extras (right slot para badges/buttons):
 *   <HeroBanner ... right={<span>3 pendientes</span>}>
 */
import type React from "react";

interface HeroBannerProps {
  /** Icon pequeño que va en el pill superior (típicamente lucide-react size-3.5). */
  pillIcon: React.ReactNode;
  /** Texto del pill superior. Se renderiza uppercase tracking-widest. */
  pillText: string;
  /** Título principal. Se renderiza font-display 4xl/5xl con gradient text. */
  title: React.ReactNode;
  /** Subtítulo. Puede tener bold/strong en palabras clave. */
  subtitle?: React.ReactNode;
  /** Slot opcional a la derecha del título (ej. badge contador, botón acción). */
  right?: React.ReactNode;
  /** Children opcional debajo del subtítulo (ej. stats grid). */
  children?: React.ReactNode;
  /** Si true, no agrega `space-y` ni mb (cuando el siguiente bloque tiene su propio espaciado). */
  flushBottom?: boolean;
}

export function HeroBanner({
  pillIcon,
  pillText,
  title,
  subtitle,
  right,
  children,
  flushBottom = false,
}: HeroBannerProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-3xl bg-ink-50/40 ring-1 ring-hairline p-8 shadow-card ${flushBottom ? "" : ""}`}
    >
      {/* Grid SVG background con maskImage radial */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at top, black 30%, transparent 70%)",
        }}
      />
      {/* Glow radial cehta-green/20 en top center */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
      />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
              {pillIcon}
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                {pillText}
              </p>
            </div>
            <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm md:text-base text-ink-500 mt-2 max-w-2xl">
                {subtitle}
              </p>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
