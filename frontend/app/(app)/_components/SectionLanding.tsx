/**
 * SectionLanding — landing "coming soon" elegante para secciones V3 en desarrollo.
 *
 * Estilo Apple consistente con el dashboard:
 *  - Hero con `Surface variant="glass"` (ring-hairline + backdrop-blur)
 *  - Icono grande verde Cehta con `rounded-3xl bg-cehta-green/10`
 *  - Pulse dot warning para indicar "en desarrollo"
 *  - Grid de feature preview cards con `opacity-75` para sugerir preview
 *
 * Server component (sin estado, render puro).
 */
import type { LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";

export interface SectionLandingFeature {
  title: string;
  description: string;
  Icon: LucideIcon;
}

export interface SectionLandingProps {
  /** Título principal H1 (ej. "Dashboard CEO"). */
  title: string;
  /** Subtítulo descriptivo bajo el H1. */
  subtitle: string;
  /** Icono grande del hero. */
  Icon: LucideIcon;
  /** Número de fase del roadmap (2, 3, 4...). */
  phase: number;
  /** Título del estado en el hero card (ej. "Fase 2 — Ejecutivo"). */
  phaseTitle: string;
  /** Descripción dentro del hero card. */
  phaseDescription: string;
  /** Features preview que se mostrarán en grid de cards. */
  features: SectionLandingFeature[];
}

export function SectionLanding({
  title,
  subtitle,
  Icon,
  phase,
  phaseTitle,
  phaseDescription,
  features,
}: SectionLandingProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6 lg:px-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-base text-ink-500">{subtitle}</p>
      </header>

      <Surface variant="glass" className="p-12 text-center">
        <span className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-cehta-green/10 text-cehta-green">
          <Icon className="h-8 w-8" strokeWidth={1.5} />
        </span>
        <h2 className="font-display text-2xl font-semibold text-ink-900">
          {phaseTitle}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-500">
          {phaseDescription}
        </p>
        <div className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-wide text-ink-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
          <span>En desarrollo · Fase {phase}</span>
        </div>
      </Surface>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const FeatureIcon = feature.Icon;
          return (
            <Surface key={feature.title} className="opacity-75">
              <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
                <FeatureIcon className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <h3 className="font-display font-semibold text-ink-900">
                {feature.title}
              </h3>
              <p className="mt-1 text-sm text-ink-500">{feature.description}</p>
            </Surface>
          );
        })}
      </div>
    </div>
  );
}
