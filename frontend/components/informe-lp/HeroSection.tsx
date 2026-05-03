"use client";

/**
 * HeroSection — el primer 30% del informe. La impresión inicial.
 *
 * Layout:
 *   [Header sutil: logo Cehta + período]
 *   [Saludo grande con nombre del LP]
 *   [Número GIGANTE animado (count-up) + label]
 *   [Subtitulo narrativo de 1-2 líneas]
 *   [LiveDataBadge]
 *
 * Background: gradient mesh sutil cehta-green → ink-900 con glow dorado.
 */
import { CountUp } from "./CountUp";
import { LiveDataBadge } from "./LiveDataBadge";
import type { InformeLpHero, InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

export function HeroSection({ informe }: Props) {
  const heroSeccion = (informe.secciones as Record<string, unknown> | null)?.hero as
    | { kind?: string; payload?: InformeLpHero }
    | undefined;
  const hero: InformeLpHero | undefined = heroSeccion?.payload;

  // Fallbacks: si no hay narrativa AI, usar lo que vino en hero_titulo/narrativa
  const titulo = hero?.titulo || informe.hero_titulo || "Tu informe del trimestre";
  const subtitulo =
    hero?.subtitulo ||
    informe.hero_narrativa ||
    "Estamos preparando tu informe personalizado.";
  const kpi = hero?.kpi_destacado;

  const generatedAt = informe.live_data?.generated_at;

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-cehta-green via-cehta-green-700 to-ink-900 px-6 py-20 text-white sm:py-28 md:py-32">
      {/* Mesh gradient overlay con glow dorado sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 20% 30%, rgba(212,175,55,0.18) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.08) 0%, transparent 50%)",
        }}
      />

      <div className="relative mx-auto max-w-3xl">
        {/* Header sutil: logo + período */}
        <div className="mb-12 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/70">
          <span className="font-semibold">Cehta Capital · FIP CEHTA ESG</span>
          {informe.periodo && <span>{informe.periodo}</span>}
        </div>

        {/* Saludo */}
        <h1 className="text-3xl font-light leading-tight tracking-tight text-white/90 sm:text-4xl md:text-5xl">
          {titulo}
        </h1>

        {/* KPI gigante (si hay) */}
        {kpi && kpi.valor_numero != null && (
          <div className="mt-10 sm:mt-12">
            <p className="font-display text-7xl font-bold leading-none tracking-tight text-white sm:text-8xl md:text-9xl">
              <CountUp
                end={kpi.valor_numero}
                duration={1800}
                decimals={Number.isInteger(kpi.valor_numero) ? 0 : 1}
                suffix={
                  kpi.valor_string?.endsWith("%")
                    ? "%"
                    : kpi.valor_string?.startsWith("$")
                    ? ""
                    : ""
                }
                prefix={kpi.valor_string?.startsWith("$") ? "$" : ""}
              />
            </p>
            <p className="mt-3 text-sm uppercase tracking-[0.2em] text-white/60">
              {kpi.label}
            </p>
          </div>
        )}

        {/* Subtítulo narrativo */}
        <p className="mt-8 max-w-2xl text-lg font-light leading-relaxed text-white/85 sm:text-xl">
          {subtitulo}
        </p>

        {/* Footer del hero */}
        <div className="mt-12 flex flex-wrap items-center gap-3">
          <LiveDataBadge generatedAt={generatedAt} className="!bg-white/10 !text-white" />
          {informe.parent_lp_nombre && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
              Te recomendó <strong className="font-semibold text-white">{informe.parent_lp_nombre}</strong>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
