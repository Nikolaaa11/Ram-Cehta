"use client";

/**
 * TuPosicionSection — datos del LP destinatario.
 *
 * Solo se renderiza si el LP tiene aporte registrado. Muestra:
 * - Aporte total comprometido vs aporte actual integrado
 * - Empresas en cartera con highlight
 * - Cálculo simple de % de avance del compromiso
 *
 * Si el LP es nuevo (estado='pipeline'), no se muestra esta sección
 * — en su lugar se muestra un "Bienvenida" en el flow.
 */
import { CountUp } from "./CountUp";
import { EMPRESA_COLOR } from "@/components/cartas-gantt/empresa-colors";
import type { InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

interface LpLiveData {
  nombre?: string;
  apellido?: string;
  nombre_completo?: string;
  empresa?: string;
  rol?: string;
  perfil_inversor?: string | null;
  aporte_total_clp?: number | null;
  aporte_actual_clp?: number | null;
  empresas_invertidas?: string[];
  estado?: string;
}

function formatCLP(amount: number | null | undefined): string {
  if (!amount) return "—";
  if (amount >= 1_000_000_000)
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${amount.toLocaleString("es-CL")}`;
}

export function TuPosicionSection({ informe }: Props) {
  const lp = informe.live_data?.lp as LpLiveData | undefined | null;
  if (!lp || !lp.aporte_total_clp) return null;

  const aporteTotal = lp.aporte_total_clp ?? 0;
  const aporteActual = lp.aporte_actual_clp ?? 0;
  const pctIntegrado =
    aporteTotal > 0 ? Math.round((aporteActual / aporteTotal) * 100) : 0;
  const pendiente = Math.max(0, aporteTotal - aporteActual);

  return (
    <section className="bg-white px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <p className="text-sm uppercase tracking-[0.2em] text-cehta-green">
            Tu posición
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {lp.nombre}, así va tu inversión
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Datos privados de tu cuenta como LP del FIP CEHTA ESG.
          </p>
        </header>

        {/* Cards de aporte */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PosicionCard
            label="Comprometido"
            value={formatCLP(aporteTotal)}
            sub="aporte total firmado"
            tone="cehta"
          />
          <PosicionCard
            label="Integrado"
            value={
              <>
                <CountUp
                  end={Math.round(aporteActual / 1_000_000)}
                  duration={1500}
                  prefix="$"
                  suffix="M"
                />
              </>
            }
            sub={`${pctIntegrado}% del compromiso`}
            tone="positive"
          />
          <PosicionCard
            label="Pendiente"
            value={formatCLP(pendiente)}
            sub={pendiente === 0 ? "✓ totalmente integrado" : "próximo call"}
            tone={pendiente === 0 ? "positive" : "ink"}
          />
        </div>

        {/* Progress bar de integración */}
        <div className="mt-8 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink-600">
              Capital integrado
            </span>
            <span className="font-mono font-bold tabular-nums text-cehta-green">
              {pctIntegrado}%
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cehta-green to-cehta-green-700 transition-all duration-1000"
              style={{ width: `${pctIntegrado}%` }}
            />
          </div>
        </div>

        {/* Empresas en cartera (si hay) */}
        {lp.empresas_invertidas && lp.empresas_invertidas.length > 0 && (
          <div className="mt-12">
            <p className="mb-4 text-sm font-medium text-ink-700">
              Tu capital está distribuido en estas empresas del portafolio:
            </p>
            <div className="flex flex-wrap gap-2">
              {lp.empresas_invertidas.map((cod) => {
                const color = EMPRESA_COLOR[cod] ?? "#94a3b8";
                return (
                  <span
                    key={cod}
                    className="inline-flex items-center gap-2 rounded-full border-2 px-4 py-1.5 text-sm font-semibold"
                    style={{
                      borderColor: color,
                      color: color,
                      background: color + "0F",
                    }}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: color }}
                    />
                    {cod}
                  </span>
                );
              })}
            </div>
            <p className="mt-3 text-xs italic text-ink-500">
              Ver el storytelling de cada una abajo ↓
            </p>
          </div>
        )}

        {/* Footer: perfil + relationship manager */}
        <div className="mt-12 rounded-2xl bg-ink-50/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-400">
                Tu perfil
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                {lp.perfil_inversor
                  ? perfilLabel(lp.perfil_inversor)
                  : "Sin clasificar"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-ink-400">
                Relationship Manager
              </p>
              <p className="mt-1 text-sm font-semibold text-ink-900">
                Camilo Salazar
              </p>
              <p className="text-xs text-ink-500">GP del fondo</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PosicionCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone: "cehta" | "positive" | "ink";
}) {
  const colors = {
    cehta: "border-cehta-green/30 text-cehta-green",
    positive: "border-positive/30 text-positive",
    ink: "border-hairline text-ink-700",
  }[tone];
  return (
    <div className={`rounded-2xl border ${colors} bg-white p-6`}>
      <p className="text-xs uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold tabular-nums sm:text-4xl">
        {value}
      </p>
      <p className="mt-2 text-xs text-ink-500">{sub}</p>
    </div>
  );
}

function perfilLabel(perfil: string): string {
  const map: Record<string, string> = {
    conservador: "Conservador (cobertura + estabilidad)",
    moderado: "Moderado (balance riesgo/retorno)",
    agresivo: "Agresivo (growth + upside)",
    esg_focused: "ESG-focused (impacto sostenible)",
  };
  return map[perfil] ?? perfil;
}
