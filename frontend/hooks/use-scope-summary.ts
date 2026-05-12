"use client";

/**
 * useScopeSummary — V5++ ola CB.
 *
 * Hook reactivo que devuelve info del scope multi-tenant del current user.
 * Basado en /me/empresas (endpoint backend), con cache de React Query.
 *
 * Devuelve:
 *   - isAdmin: si el user tiene app_role='admin' (acceso global)
 *   - total: cantidad de empresas accesibles
 *   - empresas: lista completa con roles
 *   - roles: roles únicos a través de todas las empresas
 *   - displayLabel: string listo para UI ("EVOQUE · DIRECTOR", "Admin global", etc.)
 *   - canAccess(codigo): predicado para guards UI
 *
 * Uso típico:
 *   const scope = useScopeSummary();
 *   if (scope.isAdmin) return <AdminPanel />;
 *   if (!scope.canAccess("EVOQUE")) return <Forbidden />;
 *
 * Stale 2min, cached en backend 5min. No requiere setup adicional —
 * automáticamente usa el cache compartido con useMyEmpresas.
 */
import { useMemo } from "react";
import { useMyEmpresas } from "@/hooks/use-my-empresas";

export interface ScopeSummary {
  /** True si app_role === 'admin'. */
  isAdmin: boolean;
  /** Cantidad de empresas a las que el user tiene acceso. */
  total: number;
  /** True mientras carga (data === undefined). */
  isLoading: boolean;
  /** Códigos de empresa accesibles (sorted). */
  empresaCodes: string[];
  /** Roles únicos del user (ej: ['admin'], ['director', 'gg']). */
  roles: string[];
  /** Label friendly para UI (ej: "EVOQUE · DIRECTOR"). */
  displayLabel: string;
  /** Predicado: ¿puede el user acceder a esta empresa? */
  canAccess: (codigo: string) => boolean;
}

export function useScopeSummary(): ScopeSummary {
  const { data, isLoading } = useMyEmpresas();

  return useMemo(() => {
    if (!data) {
      return {
        isAdmin: false,
        total: 0,
        isLoading: true,
        empresaCodes: [],
        roles: [],
        displayLabel: "Cargando...",
        canAccess: () => false,
      };
    }

    const empresaCodes = data.empresas.map((e) => e.codigo).sort();
    const codesSet = new Set(empresaCodes);

    // Roles únicos a través de todas las empresas
    const rolesSet = new Set<string>();
    for (const e of data.empresas) {
      for (const r of e.roles ?? []) rolesSet.add(r);
    }

    // Display label
    let displayLabel: string;
    if (data.scope_summary?.display_label) {
      displayLabel = data.scope_summary.display_label;
    } else if (data.is_admin) {
      displayLabel = `Admin global · ${data.empresas.length} empresas`;
    } else if (data.empresas.length === 0) {
      displayLabel = "Sin empresas asignadas";
    } else if (data.empresas.length === 1) {
      const e = data.empresas[0]!;
      const role = (e.roles ?? [])[0] ?? "user";
      displayLabel = `${e.codigo} · ${role.toUpperCase()}`;
    } else {
      const top = empresaCodes.slice(0, 3).join(", ");
      const more =
        empresaCodes.length > 3 ? ` (+${empresaCodes.length - 3} más)` : "";
      displayLabel = `${top}${more}`;
    }

    return {
      isAdmin: data.is_admin,
      total: data.empresas.length,
      isLoading: false,
      empresaCodes,
      roles: Array.from(rolesSet).sort(),
      displayLabel,
      canAccess: (codigo: string) => {
        if (data.is_admin) return true;
        return codesSet.has(codigo);
      },
    };
  }, [data]);
}
