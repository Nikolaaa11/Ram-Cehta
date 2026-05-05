"use client";

/**
 * ContableFilters — barra de filtros compartida para los 5 reportes contables.
 *
 * Maneja: empresa selector + fecha desde/hasta + opcional cuenta/proyecto.
 * Sincroniza con la URL via searchParams para que los reportes sean linkable.
 */
import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Building2, Filter, Printer } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface Empresa {
  codigo: string;
  razon_social: string;
}

interface Props {
  /** Si true, fuerza que empresa esté seleccionada antes de mostrar reporte. */
  requireEmpresa?: boolean;
  /** Children renderizados a la derecha de los filtros (ej: selector cuenta o proyecto). */
  extra?: React.ReactNode;
}

export function ContableFilters({ requireEmpresa = true, extra }: Props) {
  const { session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const empresa = params.get("empresa") ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const fechaDesde = params.get("fecha_desde") ?? monthAgo;
  const fechaHasta = params.get("fecha_hasta") ?? today;

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  // Si no hay empresa en URL y hay empresas disponibles, setear primera
  useEffect(() => {
    if (
      requireEmpresa &&
      !empresa &&
      empresas &&
      empresas.length > 0 &&
      !params.get("empresa")
    ) {
      const next = new URLSearchParams(params.toString());
      next.set("empresa", empresas[0]!.codigo);
      next.set("fecha_desde", fechaDesde);
      next.set("fecha_hasta", fechaHasta);
      router.replace(`${pathname}?${next}` as any);
    }
  }, [empresa, empresas, requireEmpresa, params, router, pathname, fechaDesde, fechaHasta]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (!next.get("fecha_desde")) next.set("fecha_desde", monthAgo);
    if (!next.get("fecha_hasta")) next.set("fecha_hasta", today);
    router.replace(`${pathname}?${next}` as any);
  };

  return (
    <div className="sticky top-0 z-30 -mx-6 mb-4 flex flex-wrap items-center gap-2 border-b border-hairline/60 bg-white/85 px-6 py-3 backdrop-blur-xl lg:-mx-10 lg:px-10 print:hidden print:static print:border-0">
      <Filter className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
      <div className="flex items-center gap-1">
        <Building2 className="h-3 w-3 text-ink-400" strokeWidth={1.75} />
        <select
          value={empresa}
          onChange={(e) => updateParam("empresa", e.target.value)}
          className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          {!empresa && <option value="">— Empresa —</option>}
          {(empresas ?? []).map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <Calendar className="h-3 w-3 text-ink-400" strokeWidth={1.75} />
        <input
          type="date"
          value={fechaDesde}
          onChange={(e) => updateParam("fecha_desde", e.target.value)}
          className="rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
        <span className="text-xs text-ink-400">→</span>
        <input
          type="date"
          value={fechaHasta}
          onChange={(e) => updateParam("fecha_hasta", e.target.value)}
          className="rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </div>
      {extra}
      <button
        type="button"
        onClick={() => window.print()}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:border-cehta-green/40 hover:text-cehta-green"
        title="Imprimir / Guardar como PDF"
      >
        <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
        Imprimir / PDF
      </button>
    </div>
  );
}

const fmtCLP = (v: number) => `$${Math.round(v).toLocaleString("es-CL")}`;
export { fmtCLP };
