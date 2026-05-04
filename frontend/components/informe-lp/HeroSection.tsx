"use client";

/**
 * HeroSection — el primer 30% del informe LP. La impresión inicial.
 *
 * Layout (Apple-tier editorial):
 *   [Header sutil: Cehta marca + período]
 *   [Saludo grande con nombre del LP — fade-up stagger]
 *   [KPI GIGANTE animado (count-up) + label]
 *   [Subtitulo narrativo de 1-2 líneas]
 *   [LiveDataBadge + atribución parent LP si vino vía share]
 *
 * Background: gradient mesh sutil cehta-green → ink-900 con glow dorado +
 * grain noise muy sutil (textura editorial premium).
 *
 * Motion: stagger 80ms en mount. Respeta prefers-reduced-motion.
 */
import { useEffect, useState } from "react";
import { CountUp } from "./CountUp";
import { LiveDataBadge } from "./LiveDataBadge";
import type { InformeLpHero, InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

export function HeroSection({ informe }: Props) {
  const heroSeccion = (
    informe.secciones as Record<string, unknown> | null
  )?.hero as { kind?: string; payload?: InformeLpHero } | undefined;
  const hero: InformeLpHero | undefined = heroSeccion?.payload;

  // Fallbacks: si no hay narrativa AI, usar lo que vino en hero_titulo/narrativa
  const titulo =
    hero?.titulo || informe.hero_titulo || "Tu informe del trimestre";
  const subtitulo =
    hero?.subtitulo ||
    informe.hero_narrativa ||
    "Estamos preparando tu informe personalizado.";
  const kpi = hero?.kpi_destacado;

  const generatedAt = informe.live_data?.generated_at;

  // Mount-fade in con stagger. Respeta prefers-reduced-motion.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setMounted(true);
      return;
    }
    const t = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  const fadeBase =
    "transition-all duration-700 ease-apple motion-reduce:transition-none";
  const fadeFromInit = (delayMs: number) =>
    `${fadeBase} ${
      mounted
        ? "translate-y-0 opacity-100"
        : "translate-y-3 opacity-0"
    }`.trim() + ` [transition-delay:${delayMs}ms]`;

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-cehta-green via-cehta-green-700 to-ink-900 px-6 py-20 text-white sm:py-28 md:py-32">
      {/* Mesh gradient overlay con glow dorado sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 20% 30%, rgba(212,175,55,0.18) 0%, transparent 40%)," +
            "radial-gradient(circle at 80% 70%, rgba(255,255,255,0.08) 0%, transparent 50%)",
        }}
      />
      {/* Grain noise muy sutil — textura editorial premium */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
        }}
      />

      <div className="relative mx-auto max-w-3xl">
        {/* Header sutil: marca + período */}
        <div
          style={{ transitionDelay: mounted ? "0ms" : "0ms" }}
          className={`mb-12 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.22em] text-white/70 ${fadeBase} ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <span>Cehta Capital · FIP CEHTA ESG</span>
          {informe.periodo && (
            <span className="font-mono tabular-nums tracking-[0.18em]">
              {informe.periodo}
            </span>
          )}
        </div>

        {/* Saludo / título principal — light weight editorial */}
        <h1
          style={{ transitionDelay: mounted ? "120ms" : "0ms" }}
          className={`text-3xl font-light leading-[1.1] tracking-tight text-white/90 sm:text-4xl md:text-5xl ${fadeBase} ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          {titulo}
        </h1>

        {/* KPI gigante con halo radial sutil */}
        {kpi && kpi.valor_numero != null && (
          <div
            style={{ transitionDelay: mounted ? "260ms" : "0ms" }}
            className={`relative mt-10 sm:mt-12 ${fadeBase} ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
          >
            {/* Halo radial detrás del número */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-x-12 -inset-y-6 -z-10 opacity-50"
              style={{
                background:
                  "radial-gradient(closest-side, rgba(212,175,55,0.18) 0%, transparent 70%)",
              }}
            />
            <p className="font-display text-7xl font-bold leading-none tracking-tight text-white sm:text-8xl md:text-9xl">
              <CountUp
                end={kpi.valor_numero}
                duration={1800}
                decimals={Number.isInteger(kpi.valor_numero) ? 0 : 1}
                prefix={kpi.valor_string?.startsWith("$") ? "$" : ""}
                suffix={kpi.valor_string?.endsWith("%") ? "%" : ""}
              />
            </p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/60">
              {kpi.label}
            </p>
          </div>
        )}

        {/* Subtítulo narrativo — pull-quote editorial */}
        <p
          style={{ transitionDelay: mounted ? "400ms" : "0ms" }}
          className={`mt-8 max-w-2xl text-lg font-light leading-relaxed text-white/85 sm:text-xl ${fadeBase} ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          {subtitulo}
        </p>

        {/* Footer del hero: badges */}
        <div
          style={{ transitionDelay: mounted ? "520ms" : "0ms" }}
          className={`mt-12 flex flex-wrap items-center gap-3 ${fadeBase} ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <LiveDataBadge
            generatedAt={generatedAt}
            className="!bg-white/10 !text-white"
          />
          {informe.parent_lp_nombre && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 backdrop-blur-sm">
              Te recomendó{" "}
              <strong className="font-semibold text-white">
                {informe.parent_lp_nombre}
              </strong>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
