"use client";

/**
 * /reportes/contables/cierre-mensual — checklist + KPIs operativos del mes.
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  CalendarCheck,
  Printer,
  ExternalLink,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export default function CierreMensualPage() {
  const { session } = useSession();
  const today = new Date();

  const [empresa, setEmpresa] = useState("");
  const [anio, setAnio] = useState(today.getFullYear());
  // Mes anterior por default — el cierre se hace POST mes terminado
  const [mes, setMes] = useState(today.getMonth() === 0 ? 12 : today.getMonth());

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const buildUrl = (autoPrint: boolean): string => {
    if (!empresa) return "";
    const qs = new URLSearchParams({
      empresa_codigo: empresa,
      anio: String(anio),
      mes: String(mes),
    });
    if (autoPrint) qs.set("print", "1");
    if (session?.access_token) qs.set("token", session.access_token);
    return `${API_BASE}/reportes/contables/cierre-mensual.html?${qs}`;
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
          Cierre Mensual
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Checklist + KPIs operativos del período: vouchers
          pendientes/firmados/aprobados, F29 status, cartolas importadas,
          movimientos cargados. Hoja de ruta para cerrar el mes y generar
          export Nubox.
        </p>
      </div>

      <div className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Empresa
            </label>
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">— Elige empresa —</option>
              {(empresas ?? []).map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo}
                </option>
              ))}
            </select>
          </div>
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
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Mes
            </label>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {MESES.map((label, i) => (
                <option key={i + 1} value={i + 1}>
                  {String(i + 1).padStart(2, "0")} · {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href={buildUrl(false)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!empresa) {
                e.preventDefault();
                alert("Elige una empresa primero");
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
            Abrir reporte
          </a>
          <a
            href={buildUrl(true)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!empresa) {
                e.preventDefault();
                alert("Elige una empresa primero");
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Printer className="h-4 w-4" strokeWidth={1.5} />
            Abrir + imprimir / PDF
          </a>
        </div>

        <p className="mt-4 text-[11px] italic text-ink-500">
          <CalendarCheck
            className="inline h-3 w-3"
            strokeWidth={1.5}
          />{" "}
          Tip: corré este reporte el primer día del mes siguiente para tener
          la foto del cierre completa.
        </p>
      </div>
    </div>
  );
}
