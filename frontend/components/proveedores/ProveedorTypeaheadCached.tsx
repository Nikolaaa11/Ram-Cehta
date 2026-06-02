"use client";

/**
 * ProveedorTypeaheadCached — Round 61
 *
 * Componente compartido que reemplaza los typeaheads inline de proveedor
 * en todos los forms (vouchers/nubox, vouchers/nuevo, vouchers/importar,
 * vouchers/desde-mensaje, ordenes-compra/nueva, etc.).
 *
 * Características (heredadas de Rounds 44-52):
 * - Catálogo client-side precargado vía useProveedoresCache (~228
 *   proveedores en memoria + browser cache 5min).
 * - Búsqueda instantánea client-side: sin debounce, sin round-trip.
 * - Match por razón social O RUT (normaliza puntos/guiones).
 * - Focus sin tipear → muestra primeros 8 alfabético (descubrimiento).
 * - Navegación con teclado: ↑↓ mueve highlight, Enter selecciona, Esc cierra.
 * - Highlight visual del match con <mark> verde.
 * - Footer "Mostrando 8 de N — afiná la búsqueda" si totalMatches > limit.
 * - Display de dirección bajo el RUT cuando está disponible (desambiguación).
 *
 * Si el operador tipea un proveedor que NO está en el catálogo, el padre
 * asume "nuevo" y el backend lo auto-crea al guardar (path existente).
 */
import { useEffect, useState } from "react";
import type React from "react";
import {
  useProveedoresCache,
  useFilterProveedores,
  highlightMatch,
} from "@/hooks/use-proveedores-cache";

export interface ProveedorSelectionHit {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
}

interface Props {
  /** Razón social actual seleccionada (controlado externamente). */
  value: string;
  /** RUT actual (lo gestiona el padre; lo usamos para detectar "edit"). */
  rutValue: string;
  /** Callback al elegir un proveedor del dropdown. */
  onSelect: (hit: ProveedorSelectionHit) => void;
  /** Callback cuando el operador vacía el input. */
  onClear: () => void;
  placeholder?: string;
  /** ClassName custom del <input>. Default: form-input. */
  inputClassName?: string;
  /** Prefix único para los IDs de las opciones (a11y aria-activedescendant). */
  idPrefix?: string;
  /** Required HTML attr (para forms con validación nativa). */
  required?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** auto-focus al montar (útil para form veloz). */
  autoFocus?: boolean;
  /**
   * R152xxx — MEJORAS IA #4b: callback opcional para crear inteligente.
   * Si está definido, el dropdown muestra "+ Crear: '{query}'" como
   * última opción cuando hay query no vacía. El padre se encarga de
   * llamar al backend (`POST /proveedores/quick-create`) con
   * { razon_social: query, rut?: rutValue } y luego setear los datos.
   */
  onCreate?: (query: string) => void;
  /** Si onCreate provista, este flag deshabilita el botón mientras se crea. */
  isCreating?: boolean;
}

export function ProveedorTypeaheadCached({
  value,
  rutValue,
  onSelect,
  onClear,
  placeholder,
  inputClassName,
  idPrefix = "prov-cache",
  required = false,
  disabled = false,
  autoFocus = false,
  onCreate,
  isCreating = false,
}: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const { isLoading: cacheLoading } = useProveedoresCache();

  // Si el query es exactamente el nombre ya seleccionado, no resultados.
  const searchQuery = query.trim() === value.trim() ? "" : query;
  const { results, cacheSize, totalMatches } = useFilterProveedores(
    searchQuery,
    8,
  );

  // Sync exterior → interior cuando el padre setea el nombre programáticamente.
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Reset del highlight al cambiar query/resultados (siempre resalta primero).
  useEffect(() => {
    setHighlightedIdx(0);
  }, [searchQuery, results.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[highlightedIdx];
      if (hit) {
        onSelect({
          proveedor_id: hit.proveedor_id,
          razon_social: hit.razon_social,
          rut: hit.rut,
        });
        setQuery(hit.razon_social);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={query}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim() === "") {
            onClear();
          } else if (rutValue && e.target.value !== value) {
            onClear();
          }
          if (e.target.value.trim()) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          placeholder ??
          (cacheLoading
            ? "Cargando catálogo…"
            : cacheSize > 0
              ? `Buscar entre ${cacheSize} proveedores…`
              : "Escribí razón social o RUT…")
        }
        className={
          inputClassName ??
          "w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        }
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-activedescendant={
          open && results[highlightedIdx]
            ? `${idPrefix}-${results[highlightedIdx]?.proveedor_id}`
            : undefined
        }
      />
      {/* R152xxx — mostrar SOLO el botón "Crear" cuando no hay match, query
          no vacío y onCreate fue provista. Esto cubre el caso típico: el
          operador escribe un proveedor nuevo, no aparece, clickea Crear. */}
      {open
        && results.length === 0
        && searchQuery.trim().length >= 2
        && onCreate && (
        <ul
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-hairline bg-white shadow-lg"
          role="listbox"
        >
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!isCreating) onCreate(searchQuery.trim());
            }}
            className={`flex items-center gap-2 cursor-pointer px-3 py-3 text-sm ${
              isCreating ? "opacity-60" : "hover:bg-cehta-green/10"
            }`}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cehta-green/15 text-cehta-green font-semibold">
              +
            </span>
            <div className="flex-1">
              <div className="font-medium text-ink-900">
                {isCreating ? "Creando…" : `Crear proveedor "${searchQuery.trim()}"`}
              </div>
              <div className="text-[11px] text-ink-500">
                {rutValue
                  ? `Se creará con RUT ${rutValue}. Podés completar el resto luego.`
                  : "Se creará con datos mínimos (sólo nombre). Completá RUT y banco luego desde /admin/proveedores."}
              </div>
            </div>
          </li>
        </ul>
      )}
      {open && results.length > 0 && (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-hairline bg-white shadow-lg"
          role="listbox"
        >
          {results.map((hit, idx) => {
            const isHighlighted = idx === highlightedIdx;
            return (
              <li
                key={hit.proveedor_id}
                id={`${idPrefix}-${hit.proveedor_id}`}
                role="option"
                aria-selected={hit.razon_social === value}
                onMouseEnter={() => setHighlightedIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect({
                    proveedor_id: hit.proveedor_id,
                    razon_social: hit.razon_social,
                    rut: hit.rut,
                  });
                  setQuery(hit.razon_social);
                  setOpen(false);
                }}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  isHighlighted
                    ? "bg-cehta-green/15"
                    : "hover:bg-cehta-green/10"
                }`}
              >
                <div className="font-medium text-ink-900">
                  {highlightMatch(hit.razon_social, searchQuery).map(
                    (seg, i) =>
                      seg.highlight ? (
                        <mark
                          key={i}
                          className="bg-cehta-green/30 text-ink-900 rounded-sm px-0.5"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={i}>{seg.text}</span>
                      ),
                  )}
                </div>
                <div className="flex items-baseline gap-2 text-xs text-ink-500">
                  {hit.rut && (
                    <span className="font-mono">{hit.rut}</span>
                  )}
                  {hit.direccion && (
                    <span className="truncate text-ink-400">
                      · {hit.direccion}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {totalMatches > results.length && (
            <li className="border-t border-hairline bg-ink-50/60 px-3 py-1.5 text-[11px] text-ink-500">
              Mostrando {results.length} de {totalMatches} — afiná la búsqueda
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
