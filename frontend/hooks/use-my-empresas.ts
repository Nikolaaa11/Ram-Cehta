"use client";

/**
 * useMyEmpresas — V5++ ola BR.
 *
 * Devuelve las empresas a las que el current user tiene rol. Admin global
 * obtiene todas las empresas activas con rol 'admin'.
 *
 * Usa el endpoint /me/empresas (cached 5min en backend con Cache-Control).
 * React Query stale 2min, refetch on focus off.
 */
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

export interface MyEmpresa {
  codigo: string;
  razon_social: string;
  rut: string | null;
  activo: boolean;
  roles: string[];
}

export interface ScopeSummary {
  total: number;
  is_global: boolean;
  roles_summary: string[];
  display_label: string;
}

interface MyEmpresasResponse {
  is_admin: boolean;
  empresas: MyEmpresa[];
  /** V5++ ola CB: meta info para UI scope-aware. Opcional para back-compat. */
  scope_summary?: ScopeSummary;
}

export function useMyEmpresas() {
  const { session, loading } = useSession();

  return useQuery<MyEmpresasResponse, Error>({
    queryKey: ["me", "empresas"],
    queryFn: () => apiClient.get<MyEmpresasResponse>("/me/empresas", session),
    enabled: !loading && !!session,
    staleTime: 2 * 60_000,
    retry: 0,
    placeholderData: () => ({ is_admin: false, empresas: [] }),
  });
}

/**
 * Mapeo código → archivo de logo en /public/logos/.
 * Coincide con EmpresaLogo.tsx pero usado directamente para el brand sidebar.
 */
export const LOGO_MAP: Record<string, string> = {
  AFIS: "/logos/afis.jpg",
  CSL: "/logos/csl.png",
  DTE: "/logos/dte.png",
  EVOQUE: "/logos/evoque.png",
  REVTECH: "/logos/revtech.png",
  RHO: "/logos/rho.png",
  TRONGKAI: "/logos/trongkai.png",
  FIP_CEHTA: "/logos/cehta.png",
  CEHTA: "/logos/cehta.png",
  // CENERGY usa el logo Cehta por ahora (mismo grupo). Cuando hagan
  // logo propio, agregar archivo /public/logos/cenergy.png.
  CENERGY: "/logos/cehta.png",
};

/**
 * Resuelve la empresa "primaria" del user para mostrar como branding.
 *
 * - Si tiene 1 sola empresa → esa
 * - Si tiene varias → la primera por orden alfabético (excluyendo admin
 *   entities AFIS/FIP_CEHTA si tiene también una operativa)
 * - Si es admin global → null (sidebar muestra Cehta Capital default)
 */
export function pickPrimaryEmpresa(
  data: MyEmpresasResponse | undefined,
): MyEmpresa | null {
  if (!data || data.empresas.length === 0) return null;

  // Admin global con muchas empresas → no mostrar logo específico,
  // dejamos el default Cehta Capital
  if (data.is_admin && data.empresas.length > 3) {
    return null;
  }

  // Si tiene exactamente 1 empresa, esa es
  if (data.empresas.length === 1) {
    return data.empresas[0] ?? null;
  }

  // Si tiene varias, preferir las operativas (no AFIS/FIP_CEHTA/CENERGY)
  const ADMIN_EMPRESAS = new Set(["AFIS", "FIP_CEHTA", "CENERGY"]);
  const operativas = data.empresas.filter(
    (e) => !ADMIN_EMPRESAS.has(e.codigo),
  );

  // Devolver la primera operativa si hay, sino la primera de todas
  return operativas[0] ?? data.empresas[0] ?? null;
}
