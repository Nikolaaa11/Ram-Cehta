"use client";

/**
 * /reportes/contables/balance-prueba — wrapper que linkea al HTML server-side.
 *
 * El reporte real lo genera el backend en `/reportes/contables/balance-prueba.html`
 * — esta página solo arma el link con los filtros que el user elige.
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, FileText, Printer, ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function BalancePruebaPage() {
  const { session } = useSession();
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [empresa, setEmpresa] = useState("");
  const [fechaDesde, setFechaDesde] = useState(monthStart);
  const [fechaHasta, setFechaHasta] = useState(todayStr);

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
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
    if (autoPrint) qs.set("print", "1");
    if (session?.access_token) qs.set("token", session.access_token);
    return `${API_BASE}/reportes/contables/balance-prueba.html?${qs}`;
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
          Balance de Prueba
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Listado de saldos por cuenta del período. Verifica que Σ debe = Σ
          haber. Solo cuentas con movimiento. Generado server-side como HTML
          imprimible.
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
              Fecha desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Fecha hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
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
          <FileText className="inline h-3 w-3" strokeWidth={1.5} /> El reporte
          se abre en una pestaña nueva como HTML imprimible. Ctrl+P → Guardar
          como PDF para archivarlo.
        </p>
      </div>
    </div>
  );
}
