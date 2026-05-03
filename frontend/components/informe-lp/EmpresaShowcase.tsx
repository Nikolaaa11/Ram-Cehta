"use client";

/**
 * EmpresaShowcase — tarjeta editorial rica por empresa.
 *
 * Layout vertical full-bleed inspirado en TechCrunch / Stripe Atlas:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │ [gradient hero con iniciales empresa]            │
 *   │  RHO · Renovables                                │
 *   ├──────────────────────────────────────────────────┤
 *   │ "Inauguramos 8MW en Panimávida un mes antes."    │ ← headline AI
 *   │                                                  │
 *   │ Párrafo storytelling de 2-3 líneas con datos     │ ← párrafo AI
 *   │ específicos del trimestre.                       │
 *   │                                                  │
 *   │ [8 MW] [99.4%] [4.200]   ← métricas grandes      │
 *   │ instal  uptime  hogares                          │
 *   │                                                  │
 *   │ ▰▰▰▰▰▰▰░░░ 70% hitos del trimestre                │
 *   └──────────────────────────────────────────────────┘
 */
import { EMPRESA_COLOR } from "@/components/cartas-gantt/empresa-colors";
import type { InformeLpEmpresaShowcase, InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  empresaCodigo: string;
  informe: InformeLpPublicView;
}

interface EmpresaLiveData {
  codigo?: string;
  razon_social?: string;
  rut?: string;
  metricas?: {
    proyectos_count?: number;
    proyectos_en_progreso?: number;
    hitos_total?: number;
    hitos_completados?: number;
    pct_avance?: number;
  };
  encargado_top?: string | null;
  ultimo_hito_completado?: {
    nombre: string;
    fecha: string;
    proyecto: string;
    encargado?: string | null;
  } | null;
  proyectos?: Array<{
    codigo: string;
    nombre: string;
    estado: string;
    progreso_pct: number;
  }>;
}

export function EmpresaShowcase({ empresaCodigo, informe }: Props) {
  // Live data (KPIs reales) viene de live_data.empresas[codigo]
  const liveData = (informe.live_data?.empresas as Record<string, EmpresaLiveData> | undefined)?.[
    empresaCodigo
  ];
  // Narrativa AI viene de secciones.empresas.payload.narrativas[codigo]
  const empresasSeccion = (informe.secciones as Record<string, unknown> | null)?.empresas as
    | { payload?: { narrativas?: Record<string, InformeLpEmpresaShowcase> } }
    | undefined;
  const narrativa = empresasSeccion?.payload?.narrativas?.[empresaCodigo];

  if (!liveData) return null;

  const empColor = EMPRESA_COLOR[empresaCodigo] ?? "#94a3b8";
  const razonSocial = liveData.razon_social ?? empresaCodigo;
  const headline = narrativa?.headline || `${razonSocial} en el trimestre`;
  const parrafo =
    narrativa?.parrafo ||
    `Avance del portafolio de ${liveData.metricas?.proyectos_count ?? 0} proyectos.`;
  const metricas = narrativa?.metricas_destacadas || [];
  const pctAvance = liveData.metricas?.pct_avance ?? 0;

  return (
    <article className="overflow-hidden rounded-3xl border border-hairline bg-white shadow-sm">
      {/* Hero gradient con código + tipo */}
      <header
        className="relative h-48 overflow-hidden p-8"
        style={{
          background: `linear-gradient(135deg, ${empColor} 0%, ${darken(empColor, 25)} 100%)`,
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 90% 10%, rgba(255,255,255,0.18) 0%, transparent 50%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-end text-white">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-xl font-bold backdrop-blur-sm">
              {empresaCodigo.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/80">
                {empresaCodigo}
              </p>
              <h3 className="font-display text-2xl font-semibold leading-tight tracking-tight">
                {razonSocial}
              </h3>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="space-y-6 p-8">
        {/* Headline */}
        <p className="font-display text-2xl font-semibold leading-snug tracking-tight text-ink-900 sm:text-3xl">
          “{headline}”
        </p>

        {/* Párrafo storytelling */}
        <p className="text-base leading-relaxed text-ink-700">
          {parrafo}
        </p>

        {/* Métricas grandes (de AI) */}
        {metricas.length > 0 && (
          <div className="grid grid-cols-3 gap-3 border-y border-hairline py-6">
            {metricas.slice(0, 3).map((m, i) => (
              <div key={i} className="text-center">
                <p
                  className="font-display text-3xl font-bold tabular-nums sm:text-4xl"
                  style={{ color: empColor }}
                >
                  {m.valor}
                </p>
                <p className="mt-1 text-xs text-ink-500">{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Progress bar + KPIs operativos */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-600">Avance del trimestre</span>
            <span className="font-mono font-bold tabular-nums text-ink-900">
              {pctAvance}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{ width: `${pctAvance}%`, background: empColor }}
            />
          </div>
          <p className="text-xs text-ink-500">
            {liveData.metricas?.hitos_completados ?? 0}/{liveData.metricas?.hitos_total ?? 0} hitos
            cumplidos
            {liveData.metricas?.proyectos_count != null && (
              <> · {liveData.metricas.proyectos_count} proyectos en cartera</>
            )}
          </p>
        </div>

        {/* Quote del encargado top (último hito completado como proxy) */}
        {liveData.ultimo_hito_completado && (
          <div className="rounded-2xl bg-ink-50/60 p-5">
            <p className="text-sm leading-relaxed text-ink-700">
              <span className="text-ink-400">Último hito cerrado:</span>{" "}
              <span className="font-medium text-ink-900">
                {liveData.ultimo_hito_completado.nombre}
              </span>
            </p>
            <p className="mt-2 text-xs text-ink-500">
              {liveData.ultimo_hito_completado.proyecto}
              {liveData.ultimo_hito_completado.encargado && (
                <> · {liveData.ultimo_hito_completado.encargado}</>
              )}
              {liveData.ultimo_hito_completado.fecha && (
                <>
                  {" "}
                  ·{" "}
                  {new Date(
                    liveData.ultimo_hito_completado.fecha + "T00:00:00",
                  ).toLocaleDateString("es-CL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Oscurecer un color hex para gradientes. */
function darken(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00ff) - amt);
  const B = Math.max(0, (num & 0x0000ff) - amt);
  return `#${((R << 16) | (G << 8) | B).toString(16).padStart(6, "0")}`;
}

// ─── Wrapper con grid ──────────────────────────────────────────────────────

export function EmpresaShowcaseGrid({ informe }: { informe: InformeLpPublicView }) {
  const empresasSeccion = (informe.secciones as Record<string, unknown> | null)?.empresas as
    | { payload?: { destacadas?: string[] } }
    | undefined;
  const codigos = empresasSeccion?.payload?.destacadas ?? [];

  if (codigos.length === 0) return null;

  return (
    <section className="bg-ink-50/30 px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <header className="mb-12 max-w-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-cehta-green">
            El portafolio
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Las empresas que están moviendo el fondo
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Highlights del trimestre con datos vivos del Gantt + KPIs operativos.
          </p>
        </header>

        <div className="space-y-6">
          {codigos.map((cod) => (
            <EmpresaShowcase
              key={cod}
              empresaCodigo={cod}
              informe={informe}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
