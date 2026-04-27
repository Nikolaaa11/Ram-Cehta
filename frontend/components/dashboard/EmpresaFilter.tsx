"use client";

import { useMemo } from "react";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";

const CONSOLIDADO_VALUE = "__consolidado__";

export function EmpresaFilter() {
  const { data: empresas, isLoading } = useCatalogoEmpresas();
  const { filters, setEmpresa } = useDashboardFilters();

  const items = useMemo<ComboboxItem[]>(() => {
    const list: ComboboxItem[] = [
      { value: CONSOLIDADO_VALUE, label: "Consolidado (todas)" },
    ];
    for (const e of empresas ?? []) {
      list.push({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      });
    }
    return list;
  }, [empresas]);

  return (
    <Combobox
      items={items}
      value={filters.empresa ?? CONSOLIDADO_VALUE}
      onValueChange={(v) =>
        setEmpresa(v === CONSOLIDADO_VALUE ? null : v)
      }
      placeholder={isLoading ? "Cargando…" : "Empresa"}
      searchPlaceholder="Buscar empresa…"
      emptyText="Sin empresas."
      triggerClassName="w-56"
    />
  );
}
