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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-y border-hairline py-6">
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

        {/* Quote estilo editorial — el último hito completado es el "evento"
            que cuenta el encargado del proyecto */}
        {liveData.ultimo_hito_completado && (
          <CeoQuote
            empresaCodigo={empresaCodigo}
            empColor={empColor}
            hito={liveData.ultimo_hito_completado}
            encargadoTop={liveData.encargado_top}
          />
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

// ─── CeoQuote: quote estilo editorial con avatar + atribución ──────────────

function CeoQuote({
  empresaCodigo,
  empColor,
  hito,
  encargadoTop,
}: {
  empresaCodigo: string;
  empColor: string;
  hito: NonNullable<EmpresaLiveData["ultimo_hito_completado"]>;
  encargadoTop: string | null | undefined;
}) {
  // Quien es el "speaker" del quote: encargado del hito > encargado_top
  const speaker = hito.encargado || encargadoTop || "Equipo";
  const fechaFmt = hito.fecha
    ? new Date(hito.fecha + "T00:00:00").toLocaleDateString("es-CL", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  // Iniciales para el avatar
  const initials = (() => {
    const parts = speaker.trim().split(/\s+/);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  })();

  return (
    <figure
      className="relative overflow-hidden rounded-2xl border-l-4 bg-ink-50/40 p-6"
      style={{ borderLeftColor: empColor }}
    >
      {/* Comilla decorativa de fondo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-4 select-none font-display text-[120px] font-bold leading-none opacity-10"
        style={{ color: empColor }}
      >
        “
      </span>

      <blockquote className="relative z-10">
        <p className="font-display text-lg italic leading-snug text-ink-900 sm:text-xl">
          “Cerramos {hito.nombre}{fechaFmt ? ` en ${fechaFmt}` : ""}.”
        </p>

        {/* Atribución */}
        <figcaption className="mt-4 flex items-center gap-3">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: empColor }}
            aria-hidden
          >
            {initials}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">{speaker}</p>
            <p className="text-xs text-ink-500">
              {hito.proyecto} · {empresaCodigo}
            </p>
          </div>
        </figcaption>
      </blockquote>
    </figure>
  );
}
