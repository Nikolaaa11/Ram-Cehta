"use client";

/**
 * EmpresaSelector — combo reutilizable para filtros por empresa.
 *
 * V5++ ola CB: muestra solo las empresas que el user puede ver
 * (basado en /me/empresas → scope multi-tenant).
 *
 * Si el user es admin global, muestra TODAS las empresas activas del
 * portfolio. Si es scoped, solo las suyas.
 *
 * Default: "Todas las empresas" (que en backend se resuelve a "todas las
 * permitidas" para el user).
 *
 * Uso:
 *   const [empresa, setEmpresa] = useState<string>("");
 *   <EmpresaSelector value={empresa} onChange={setEmpresa} />
 *
 * Si querés desactivar la opción "Todas":
 *   <EmpresaSelector value={empresa} onChange={setEmpresa} required />
 *
 * Si querés esconder el selector cuando solo hay 1 empresa accesible:
 *   <EmpresaSelector value={empresa} onChange={setEmpresa} hideIfSingle />
 */
import * as React from "react";
import { Combobox } from "@/components/ui/combobox";
import { useMyEmpresas } from "@/hooks/use-my-empresas";

export interface EmpresaSelectorProps {
  value: string;
  onChange: (codigo: string) => void;
  /** Si true, no muestra opción "Todas". Default false. */
  required?: boolean;
  /** Si true y user tiene 1 sola empresa, no rendera el componente.
   * Default false. */
  hideIfSingle?: boolean;
  /** Override del placeholder. Default "Empresa". */
  label?: string;
  /** Override del label de "Todas". Default "Todas mis empresas". */
  allLabel?: string;
  className?: string;
}

export function EmpresaSelector({
  value,
  onChange,
  required = false,
  hideIfSingle = false,
  label = "Empresa",
  allLabel = "Todas mis empresas",
  className,
}: EmpresaSelectorProps) {
  const { data, isLoading } = useMyEmpresas();
  const empresas = data?.empresas ?? [];

  // Si el user tiene 1 sola empresa y hideIfSingle=true → no renderear
  if (hideIfSingle && empresas.length === 1 && !data?.is_admin) {
    return null;
  }

  const items = React.useMemo(() => {
    const list = empresas.map((e) => ({
      value: e.codigo,
      label: e.razon_social
        ? `${e.codigo} · ${e.razon_social}`.slice(0, 50)
        : e.codigo,
    }));
    if (!required) {
      list.unshift({ value: "", label: allLabel });
    }
    return list;
  }, [empresas, required, allLabel]);

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={onChange}
      placeholder={isLoading ? "Cargando..." : label}
      className={className}
    />
  );
}
