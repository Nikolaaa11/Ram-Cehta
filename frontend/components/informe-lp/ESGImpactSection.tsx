"use client";

/**
 * ESGImpactSection — el "wow emocional" del informe.
 *
 * Convierte números abstractos (toneladas CO2, MWh) en EQUIVALENTES
 * concretos que el LP puede sentir:
 *   - 10.950 ton CO2 → 1.847 autos sacados de la calle por un año
 *   - 27.375 MWh → 9.125 hogares chilenos con energía renovable
 *
 * Diseño: layout vertical con 4 "filas" iconográficas. Cada una con
 * un icono grande, un número GIGANTE animado, y descripción breve.
 *
 * Si live_data.esg_impact viene vacío (sin MW reales en KB), no se
 * renderiza la sección.
 */
import { Car, Home, Leaf, Zap } from "lucide-react";
import { CountUp } from "./CountUp";
import type { InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

export function ESGImpactSection({ informe }: Props) {
  const esg = informe.live_data?.esg_impact;

  // No renderizar si no hay datos reales (todo es null = placeholder)
  const tieneDatos =
    esg &&
    (esg.mw_instalados ||
      esg.mwh_anuales ||
      esg.co2_evitado_ton_año ||
      esg.autos_equivalentes_año ||
      esg.hogares_chilenos_equivalentes);

  if (!tieneDatos) return null;

  const nombreLp =
    informe.lp_nombre ??
    (
      (informe.live_data?.lp as { nombre?: string } | null | undefined)
        ?.nombre
    ) ??
    "Vos";

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-positive/5 via-white to-cehta-green/5 px-6 py-20 sm:py-24">
      {/* Decoración: leaves sutiles */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(circle at 90% 20%, rgba(16,185,129,0.12) 0%, transparent 40%), radial-gradient(circle at 10% 80%, rgba(212,175,55,0.08) 0%, transparent 40%)",
        }}
      />

      <div className="relative mx-auto max-w-3xl">
        <header className="mb-12 max-w-2xl">
          <p className="inline-flex items-center gap-2 text-sm uppercase tracking-[0.2em] text-positive">
            <Leaf className="h-4 w-4" strokeWidth={1.75} />
            Impacto ESG
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {nombreLp}, tu inversión en CEHTA evita...
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Cálculo agregado del impacto ambiental del portafolio renovable
            del fondo. Equivalentes basados en factor de emisión grid Chile
            (CDE 2024) e indicadores IPCC.
          </p>
        </header>

        <div className="space-y-8">
          {esg.autos_equivalentes_año != null && esg.autos_equivalentes_año > 0 && (
            <ImpactRow
              Icon={Car}
              numero={esg.autos_equivalentes_año}
              suffix=" autos"
              label="sacados de la calle por un año"
              detail={`Equivale a ${(esg.co2_evitado_ton_año ?? 0).toLocaleString("es-CL")} ton CO₂ evitadas`}
              color="text-cehta-green"
            />
          )}

          {esg.hogares_chilenos_equivalentes != null &&
            esg.hogares_chilenos_equivalentes > 0 && (
              <ImpactRow
                Icon={Home}
                numero={esg.hogares_chilenos_equivalentes}
                suffix=" hogares"
                label="chilenos con energía renovable"
                detail={`Generación equivalente: ${(esg.mwh_anuales ?? 0).toLocaleString("es-CL")} MWh/año`}
                color="text-info"
              />
            )}

          {esg.mw_instalados != null && esg.mw_instalados > 0 && (
            <ImpactRow
              Icon={Zap}
              numero={Number(esg.mw_instalados.toFixed(1))}
              decimals={1}
              suffix=" MW"
              label="de capacidad renovable instalada"
              detail="Distribuidos en proyectos BESS + solar a lo largo de Chile"
              color="text-warning"
            />
          )}

          {esg.co2_evitado_ton_año != null && esg.co2_evitado_ton_año > 0 && (
            <ImpactRow
              Icon={Leaf}
              numero={esg.co2_evitado_ton_año}
              suffix=" ton CO₂"
              label="evitadas por año"
              detail="Factor de emisión grid Chile: 0.40 ton CO₂/MWh (CDE 2024)"
              color="text-positive"
            />
          )}
        </div>

        {/* Footer: nota de transparencia */}
        <p className="mt-10 rounded-2xl bg-white/80 px-5 py-4 text-xs italic text-ink-500 ring-1 ring-hairline">
          Cálculos basados en capacidad nominal del portafolio + factor de
          planta promedio 25% para solar fotovoltaico (conservador). Los
          equivalentes (autos, hogares) son estimaciones con metodología IPCC
          y CDE para uso comunicacional — no reemplazan reportes de huella
          de carbono auditados.
        </p>
      </div>
    </section>
  );
}

function ImpactRow({
  Icon,
  numero,
  suffix,
  label,
  detail,
  color,
  decimals = 0,
}: {
  Icon: React.ElementType;
  numero: number;
  suffix?: string;
  label: string;
  detail: string;
  color: string;
  decimals?: number;
}) {
  return (
    <div className="flex items-start gap-6 rounded-2xl border border-hairline bg-white p-6 sm:p-8">
      <span
        className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-current/10 ${color}`}
      >
        <Icon className="h-7 w-7" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`font-display text-4xl font-bold leading-tight tabular-nums ${color} sm:text-5xl`}
        >
          <CountUp end={numero} decimals={decimals} duration={1800} suffix={suffix} />
        </p>
        <p className="mt-1 text-base font-medium text-ink-900">{label}</p>
        <p className="mt-1 text-xs text-ink-500">{detail}</p>
      </div>
    </div>
  );
}
