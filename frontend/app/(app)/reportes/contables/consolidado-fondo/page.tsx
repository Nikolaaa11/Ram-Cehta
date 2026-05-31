"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, Building2, Printer, ExternalLink } from "lucide-react";
import { useSession } from "@/hooks/use-session";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function ConsolidadoFondoPage() {
  const { session } = useSession();
  const [anio, setAnio] = useState(new Date().getFullYear());

  const buildUrl = (autoPrint: boolean): string => {
    const qs = new URLSearchParams({ anio: String(anio) });
    if (autoPrint) qs.set("print", "1");
    if (session?.access_token) qs.set("token", session.access_token);
    return `${API_BASE}/reportes/contables/consolidado-fondo.html?${qs}`;
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div>
        <Link
          href={"/reportes/contables" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Reportes contables
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Consolidado del Fondo
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Reporte agregado de las 9 empresas activas del portafolio FIP CEHTA.
          Ingresos / Gastos / Resultado por empresa + totales consolidados +
          Top 3 contribuyentes. Útil para reportería al fondo y comité de
          inversión.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Año
            </label>
            <input
              type="number"
              min={2020}
              max={2100}
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href={buildUrl(false)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            Abrir reporte
          </a>
          <a
            href={buildUrl(true)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Printer className="h-4 w-4" strokeWidth={1.5} />
            Abrir + imprimir / PDF
          </a>
        </div>

        <p className="mt-4 text-[11px] italic text-ink-500">
          <Building2 className="inline h-3 w-3" strokeWidth={1.5} /> Cifras
          son la suma simple de las cuentas 4-* y 5-* de cada empresa por
          separado. NO incluye eliminaciones de transacciones inter-company.
        </p>
      </div>
    </div>
  );
}
