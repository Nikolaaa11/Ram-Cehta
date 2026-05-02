"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus, ArrowUpDown } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { toCLP } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EmpresaCEOKPIs } from "@/lib/api/schema";

type SortKey =
  | "empresa_codigo"
  | "saldo_contable"
  | "flujo_neto_30d"
  | "oc_pendientes"
  | "f29_total"
  | "health_score";

type SortDir = "asc" | "desc";

interface Props {
  empresas: EmpresaCEOKPIs[];
}

function trendIcon(t: string) {
  if (t === "up") return <ArrowUp className="h-3.5 w-3.5 text-positive" strokeWidth={1.75} />;
  if (t === "down") return <ArrowDown className="h-3.5 w-3.5 text-negative" strokeWidth={1.75} />;
  return <Minus className="h-3.5 w-3.5 text-ink-500" strokeWidth={1.75} />;
}

function healthVariant(score: number): "success" | "warning" | "danger" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function ComparadorEmpresas({ empresas }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("health_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const arr = [...empresas];
    arr.sort((a, b) => {
      const aVal: number | string = (() => {
        switch (sortKey) {
          case "empresa_codigo":
            return a.empresa_codigo;
          case "saldo_contable":
            return Number(a.saldo_contable);
          case "flujo_neto_30d":
            return Number(a.flujo_neto_30d);
          case "oc_pendientes":
            return a.oc_pendientes;
          case "f29_total":
            return a.f29_proximas + a.f29_vencidas * 10;
          case "health_score":
          default:
            return a.health_score;
        }
      })();
      const bVal: number | string = (() => {
        switch (sortKey) {
          case "empresa_codigo":
            return b.empresa_codigo;
          case "saldo_contable":
            return Number(b.saldo_contable);
          case "flujo_neto_30d":
            return Number(b.flujo_neto_30d);
          case "oc_pendientes":
            return b.oc_pendientes;
          case "f29_total":
            return b.f29_proximas + b.f29_vencidas * 10;
          case "health_score":
          default:
            return b.health_score;
        }
      })();
      const cmp =
        typeof aVal === "string" && typeof bVal === "string"
          ? aVal.localeCompare(bVal)
          : Number(aVal) - Number(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [empresas, sortKey, sortDir]);

  function toggle(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-6 py-4">
        <Surface.Title>Comparador de empresas</Surface.Title>
        <Surface.Subtitle>
          {empresas.length} empresas activas · scoreboard del portafolio
        </Surface.Subtitle>
      </Surface.Header>
      {/* overflow-x-auto previene rotura de layout en mobile/tablet */}
      <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-hairline text-sm">
        <thead className="sticky top-0 z-10 bg-ink-100/60 text-xs uppercase tracking-wide text-ink-500 backdrop-blur">
          <tr>
            <Th onClick={() => toggle("empresa_codigo")} active={sortKey === "empresa_codigo"} dir={sortDir}>
              Empresa
            </Th>
            <Th
              onClick={() => toggle("saldo_contable")}
              active={sortKey === "saldo_contable"}
              dir={sortDir}
              align="right"
            >
              Saldo
            </Th>
            <Th
              onClick={() => toggle("flujo_neto_30d")}
              active={sortKey === "flujo_neto_30d"}
              dir={sortDir}
              align="right"
            >
              Flujo 30d
            </Th>
            <Th
              onClick={() => toggle("oc_pendientes")}
              active={sortKey === "oc_pendientes"}
              dir={sortDir}
              align="right"
            >
              OCs
            </Th>
            <Th
              onClick={() => toggle("f29_total")}
              active={sortKey === "f29_total"}
              dir={sortDir}
              align="right"
            >
              F29
            </Th>
            <Th
              onClick={() => toggle("health_score")}
              active={sortKey === "health_score"}
              dir={sortDir}
              align="right"
            >
              Health
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {sorted.map((e, idx) => (
            <tr
              key={e.empresa_codigo}
              className={cn(
                "transition-colors duration-150 hover:bg-cehta-green/5",
                idx % 2 === 1 && "bg-ink-50/30",
              )}
            >
              <td className="px-4 py-3 font-medium text-ink-900">
                <div className="flex items-center gap-2.5">
                  <EmpresaLogo
                    empresaCodigo={e.empresa_codigo}
                    size={28}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {trendIcon(e.trend)}
                      <span className="truncate">{e.empresa_codigo}</span>
                    </div>
                    <span className="block truncate text-xs font-normal text-ink-500">
                      {e.razon_social}
                    </span>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                {toCLP(e.saldo_contable)}
              </td>
              <td
                className={cn(
                  "px-4 py-3 text-right tabular-nums",
                  Number(e.flujo_neto_30d) >= 0 ? "text-ink-900" : "text-negative",
                )}
              >
                {toCLP(e.flujo_neto_30d)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                {e.oc_pendientes}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {e.f29_vencidas > 0 ? (
                  <span className="text-negative font-medium">
                    {e.f29_vencidas} venc · {e.f29_proximas} prox
                  </span>
                ) : e.f29_proximas > 0 ? (
                  <span className="text-warning">{e.f29_proximas} próximas</span>
                ) : (
                  <span className="text-ink-500">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <Badge variant={healthVariant(e.health_score)}>
                  {e.health_score}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Surface>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align?: "right";
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors duration-150 ease-apple",
          active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
        )}
      >
        {children}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" strokeWidth={2} />
          ) : (
            <ArrowDown className="h-3 w-3" strokeWidth={2} />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" strokeWidth={2} />
        )}
      </button>
    </th>
  );
}
