import { Receipt, CalendarClock } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { EmpresaSwitcher } from "@/components/empresa/EmpresaSwitcher";
import type { ResumenCC } from "@/lib/api/schema";

/**
 * Hero del Dashboard rico — razón social, contador de transacciones y
 * pills de UF/USD (placeholder hasta integrar APIs externas).
 */
export interface ResumenHeroProps {
  data: ResumenCC;
  /** Pills opcionales de UF/USD. Si no se pasan, no se renderizan. */
  uf?: string;
  usd?: string;
}

export function ResumenHero({ data, uf, usd }: ResumenHeroProps) {
  return (
    <Surface variant="glass">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <EmpresaLogo
            empresaCodigo={data.empresa_codigo}
            size={56}
          />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-display font-semibold tracking-tight text-ink-900">
                {data.razon_social}
              </h2>
              <Badge variant="info">{data.empresa_codigo}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Receipt className="h-3.5 w-3.5" strokeWidth={1.5} />
                {data.transaction_count.toLocaleString("es-CL")} transacciones
              </span>
              {data.periodo_filtro && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Periodo {data.periodo_filtro}
                </span>
              )}
              {data.real_proyectado_filtro && (
                <Badge variant="neutral">{data.real_proyectado_filtro}</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {/* V4 fase 7.16 — switcher para saltar entre empresas sin volver al sidebar */}
          <EmpresaSwitcher currentCodigo={data.empresa_codigo} />
          {(uf || usd) && (
            <div className="flex items-center gap-2 text-xs">
              {uf && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-ink-100/60 px-3 py-1.5 tabular-nums text-ink-700">
                  <span className="font-semibold">UF</span>
                  {uf}
                </span>
              )}
              {usd && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-ink-100/60 px-3 py-1.5 tabular-nums text-ink-700">
                  <span className="font-semibold">USD</span>
                  {usd}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Surface>
  );
}
