"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Building2,
  FileText,
  Users,
  Receipt,
  Briefcase,
  PieChart,
  Wallet,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import { useSearch } from "@/hooks/use-search";
import type { SearchHit, SearchEntityType } from "@/lib/api/schema";

const ICON_BY_ENTITY: Record<SearchEntityType, React.ElementType> = {
  empresa: Building2,
  orden_compra: FileText,
  proveedor: Briefcase,
  f29: Receipt,
  trabajador: Users,
  legal_document: FileText,
  fondo: PieChart,
  suscripcion: Wallet,
};

const LABEL_BY_ENTITY: Record<SearchEntityType, string> = {
  empresa: "Empresas",
  orden_compra: "Órdenes de compra",
  proveedor: "Proveedores",
  f29: "F29",
  trabajador: "Trabajadores",
  legal_document: "Legal",
  fondo: "Fondos",
  suscripcion: "Suscripciones",
};

const ENTITY_ORDER: SearchEntityType[] = [
  "empresa",
  "orden_compra",
  "trabajador",
  "f29",
  "legal_document",
  "proveedor",
  "fondo",
  "suscripcion",
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+K command palette. Modal centrado con input y resultados agrupados por
 * entidad. Navegación por teclado con ↑/↓/Enter; Esc cierra.
 *
 * Decisiones UX:
 * - El input recibe focus al abrir (autoFocus + setTimeout para hidratación).
 * - Backdrop con blur para enfatizar foco; no oscurece demasiado para no
 *   esconder el contexto detrás.
 * - Resultados agrupados por entidad con icono + label distintivo.
 * - Lista plana de hits para navegación con teclado (índice global).
 * - Click o Enter → router.push(link) y onClose().
 */
export function CommandPalette({ open, onClose }: Props) {
  const router = useRouter();
  const { query, setQuery, results, isLoading } = useSearch();
  const [activeIdx, setActiveIdx] = useState(0);

  // Lista plana de hits ordenada igual que la UI
  const flatHits = useMemo<SearchHit[]>(() => {
    if (!results) return [];
    return ENTITY_ORDER.flatMap((entity) => results.by_entity[entity] ?? []);
  }, [results]);

  // Reset estado al abrir/cerrar
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open, setQuery]);

  // Reset índice al cambiar resultados
  useEffect(() => {
    setActiveIdx(0);
  }, [flatHits.length]);

  // Atajos de teclado dentro del palette
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, flatHits.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const hit = flatHits[activeIdx];
        if (hit) {
          e.preventDefault();
          // hit.link es string dinámico del backend; el typedRoutes de Next no
          // puede inferirlo en compile-time, así que casteamos al tipo bruto.
          router.push(hit.link as never);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flatHits, activeIdx, onClose, router]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda global"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/30 px-4 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white/95 shadow-card ring-1 ring-hairline backdrop-blur-md transition-all duration-200 ease-apple"
      >
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
          <Search className="h-5 w-5 text-ink-400" strokeWidth={1.75} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar empresas, OCs, trabajadores, F29, fondos…"
            className="flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
          )}
          <kbd className="hidden rounded border border-hairline bg-ink-100/40 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 sm:inline-block">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
          {query.trim().length < 2 && (
            <div className="px-3 py-12 text-center text-sm text-ink-400">
              Empezá a escribir para buscar (mín. 2 caracteres)
            </div>
          )}

          {query.trim().length >= 2 && !isLoading && flatHits.length === 0 && (
            <div className="px-3 py-12 text-center text-sm text-ink-400">
              Sin resultados para “{query}”
            </div>
          )}

          {ENTITY_ORDER.map((entity) => {
            const hits = results?.by_entity[entity];
            if (!hits || hits.length === 0) return null;
            const Icon = ICON_BY_ENTITY[entity];
            return (
              <div key={entity} className="mb-2">
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                  <Icon className="h-3 w-3" strokeWidth={2} />
                  {LABEL_BY_ENTITY[entity]}
                </div>
                {hits.map((hit) => {
                  const globalIdx = flatHits.findIndex(
                    (h) => h.entity_id === hit.entity_id && h.entity_type === hit.entity_type,
                  );
                  const isActive = globalIdx === activeIdx;
                  return (
                    <button
                      key={`${hit.entity_type}-${hit.entity_id}`}
                      onClick={() => {
                        router.push(hit.link as never);
                        onClose();
                      }}
                      onMouseEnter={() => setActiveIdx(globalIdx)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-100 ease-apple ${
                        isActive
                          ? "bg-cehta-green/10 text-ink-900"
                          : "hover:bg-ink-100/40"
                      }`}
                    >
                      <div className="flex-1 truncate">
                        <div className="truncate text-sm font-medium text-ink-900">
                          {hit.title}
                        </div>
                        {hit.subtitle && (
                          <div className="truncate text-xs text-ink-500">
                            {hit.subtitle}
                          </div>
                        )}
                      </div>
                      {hit.badge && (
                        <span className="shrink-0 rounded-md bg-ink-100/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                          {hit.badge}
                        </span>
                      )}
                      {isActive && (
                        <CornerDownLeft
                          className="h-3.5 w-3.5 shrink-0 text-cehta-green"
                          strokeWidth={2}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-hairline bg-ink-50/50 px-4 py-2 text-[11px] text-ink-500">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="rounded border border-hairline bg-white px-1 py-0.5 text-[10px]">
                ↑↓
              </kbd>{" "}
              navegar
            </span>
            <span>
              <kbd className="rounded border border-hairline bg-white px-1 py-0.5 text-[10px]">
                ↵
              </kbd>{" "}
              abrir
            </span>
          </div>
          {results && results.total > 0 && (
            <span>{results.total} resultado{results.total !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}
