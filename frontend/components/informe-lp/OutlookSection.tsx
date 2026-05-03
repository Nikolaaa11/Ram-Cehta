"use client";

/**
 * OutlookSection — qué viene en los próximos 6 meses.
 *
 * Pull de los hitos `pendiente`/`en_progreso` con fecha_planificada
 * en los próximos 180 días, top 8.
 */
import type { InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

const MES_NOMBRES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export function OutlookSection({ informe }: Props) {
  const hitos = informe.live_data?.hitos_proximos ?? [];
  if (hitos.length === 0) return null;

  return (
    <section className="bg-ink-50/40 px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <header className="mb-12 max-w-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-cehta-green">
            Outlook
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Lo que viene en los próximos 6 meses
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Hitos clave del roadmap consolidado del portafolio, ordenados
            por fecha. Cada uno con encargado responsable.
          </p>
        </header>

        <ol className="space-y-3">
          {hitos.map((h, idx) => (
            <li
              key={h.hito_id}
              className="group flex items-start gap-4 rounded-2xl border border-hairline bg-white p-4 transition-colors hover:bg-ink-50/40"
            >
              <FechaBlock fecha={h.fecha_planificada} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">
                  {h.nombre}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  <span className="font-mono font-medium uppercase">
                    {h.empresa_codigo}
                  </span>
                  <span> · {h.proyecto}</span>
                  {h.encargado && <span> · {h.encargado}</span>}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-600">
                #{idx + 1}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FechaBlock({ fecha }: { fecha: string | null | undefined }) {
  if (!fecha) {
    return (
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-ink-100 font-mono text-[10px] text-ink-500">
        sin
        <br />
        fecha
      </div>
    );
  }
  const date = new Date(fecha + "T00:00:00");
  const day = date.getDate();
  const month = MES_NOMBRES[date.getMonth()] ?? "";
  return (
    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-cehta-green/10 text-cehta-green">
      <span className="text-xs font-bold uppercase tracking-wider">
        {month}
      </span>
      <span className="font-display text-base font-bold leading-none">
        {day}
      </span>
    </div>
  );
}
