"use client";

/**
 * ScopeIndicator — chip informativo del scope actual del user.
 *
 * V5++ ola CB: para que el user siempre sepa qué datos está viendo.
 *
 * Casos:
 * - Admin global → "Vista global · 10 empresas"
 * - User con 1 empresa → "EVOQUE"
 * - User con N empresas → "Mis empresas · 3"
 * - Empresa activa elegida → "EVOQUE (activa)"
 *
 * Lightweight: solo lee del cache de /me/empresas y useActiveEmpresa.
 * No hace fetch propio.
 */
import * as React from "react";
import { Building2, Globe, Shield } from "lucide-react";
import { useMyEmpresas } from "@/hooks/use-my-empresas";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { cn } from "@/lib/utils";

export interface ScopeIndicatorProps {
  className?: string;
  /** Compact = sin texto, solo icon + count. Default false. */
  compact?: boolean;
}

export function ScopeIndicator({ className, compact }: ScopeIndicatorProps) {
  const { data } = useMyEmpresas();
  const { active: activeCodigo } = useActiveEmpresa();

  if (!data) return null;

  const empresas = data.empresas;
  const isAdmin = data.is_admin;

  // Caso 1: Admin con empresa activa elegida
  if (isAdmin && activeCodigo) {
    return (
      <span
        title={`Vista filtrada por ${activeCodigo}. Eres admin global.`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-1 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/20",
          className,
        )}
      >
        <Building2 className="size-3" strokeWidth={2} />
        {!compact && <span>Filtrado:</span>}
        <span className="font-semibold">{activeCodigo}</span>
      </span>
    );
  }

  // Caso 2: Admin sin filtro
  if (isAdmin) {
    return (
      <span
        title="Eres admin global. Estás viendo datos de todas las empresas."
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-amber-100/80 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-300/40",
          className,
        )}
      >
        <Shield className="size-3" strokeWidth={2} />
        {!compact && <span>Admin global</span>}
        {compact && <span className="font-semibold">{empresas.length}</span>}
      </span>
    );
  }

  // Caso 3: User con 1 empresa
  if (empresas.length === 1) {
    return (
      <span
        title={`Tu única empresa: ${empresas[0]!.codigo}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-1 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/20",
          className,
        )}
      >
        <Building2 className="size-3" strokeWidth={2} />
        <span className="font-semibold">{empresas[0]!.codigo}</span>
      </span>
    );
  }

  // Caso 4: User con N empresas, activa elegida
  if (activeCodigo && empresas.some((e) => e.codigo === activeCodigo)) {
    return (
      <span
        title={`Filtrado a ${activeCodigo}. Total empresas accesibles: ${empresas.length}.`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-1 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/20",
          className,
        )}
      >
        <Building2 className="size-3" strokeWidth={2} />
        <span className="font-semibold">{activeCodigo}</span>
        {!compact && (
          <span className="text-ink-500">/ {empresas.length}</span>
        )}
      </span>
    );
  }

  // Caso 5: User con N empresas, sin filtro
  return (
    <span
      title={`Ves datos de ${empresas.length} empresas: ${empresas.map((e) => e.codigo).join(", ")}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-hairline",
        className,
      )}
    >
      <Globe className="size-3" strokeWidth={2} />
      {!compact && <span>Mis empresas</span>}
      <span className="font-semibold">{empresas.length}</span>
    </span>
  );
}
