"use client";

/**
 * CuentaTypeahead — AJUSTE 10 + Round 70.
 *
 * Combobox typeahead para seleccionar "Plan de Cuenta" en las líneas de
 * voucher. Reemplaza el `<input>` plano por uno con búsqueda por código o
 * nombre y sugerencias filtradas según el contexto (DEBE vs HABER).
 *
 * Fetch: GET /plan-cuentas?empresa_codigo=...&imputable=true&activa=true
 * Cache: 5 min (`staleTime`) — la lista cambia rara vez.
 *
 * Reglas de sugerencia (no bloquean):
 *   - tone="contable" (DEBE):  prioriza 5-* (gastos) y 4-* (ingresos)
 *   - tone="financiera" (HABER): prioriza 1-01-* / 1-1-* / 1-* (caja/banco)
 *                                y 2-02-* / 2-2-* / 2-* (CxP/proveedores)
 *
 * Si el usuario elige una cuenta fuera de la lista priorizada, mostramos un
 * warning amber NO bloqueante. Sigue siendo válido enviar el voucher.
 *
 * Round 70 — paridad con ProveedorTypeaheadCached:
 *   - Navegación con teclado: ↑↓ mueve highlight, Enter selecciona, Esc cierra.
 *   - Highlight visual del match (<mark>) en código y nombre.
 *   - Footer "Mostrando N de M — afiná la búsqueda" cuando el cap recorta.
 *   - aria-activedescendant para lectores de pantalla.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { highlightMatch } from "@/hooks/use-proveedores-cache";
import type { PlanCuenta } from "@/lib/api/schema";

interface Props {
  value: string; // codigo seleccionado actual
  onChange: (codigo: string) => void;
  empresaCodigo: string;
  tone: "contable" | "financiera";
  placeholder?: string;
  required?: boolean;
  /** Prefix único para los IDs de las opciones (a11y aria-activedescendant). */
  idPrefix?: string;
}

const VISIBLE_LIMIT = 50;

/**
 * Devuelve true si el código encaja con los prefijos prioritarios para el
 * tono dado. La lista replica los prefijos del prompt maestro (AJUSTE 10).
 */
function isPriorityCuenta(
  codigo: string,
  tone: "contable" | "financiera",
): boolean {
  if (tone === "contable") {
    // Gastos (5-*) e Ingresos (4-*)
    return /^5(-|$)/.test(codigo) || /^4(-|$)/.test(codigo);
  }
  // financiera (HABER): caja/banco (1-*) y CxP/proveedores (2-*)
  return /^1(-|$)/.test(codigo) || /^2(-|$)/.test(codigo);
}

export function CuentaTypeahead({
  value,
  onChange,
  empresaCodigo,
  tone,
  placeholder,
  required,
  idPrefix = "cuenta-typeahead",
}: Props) {
  const { session } = useSession();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  // R152rrr — posición del dropdown calculada via getBoundingClientRect().
  // Necesario para renderizar via portal en document.body y evitar que el
  // overflow-x-auto del padre lo recorte. Se recalcula al scroll/resize.
  const [dropdownPos, setDropdownPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Recalcular posición cuando el dropdown abre o cambia el viewport.
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const calcPos = () => {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setDropdownPos({
        top: r.bottom + 4, // 4px de gap visual
        left: r.left,
        width: r.width,
      });
    };
    calcPos();
    window.addEventListener("scroll", calcPos, true); // capture para scroll del padre
    window.addEventListener("resize", calcPos);
    return () => {
      window.removeEventListener("scroll", calcPos, true);
      window.removeEventListener("resize", calcPos);
    };
  }, [open]);

  // Fetch cuentas imputables/activas para esta empresa. Cache 5 min.
  const { data: cuentas, isLoading } = useQuery<PlanCuenta[]>({
    queryKey: ["plan-cuentas-imputables-typeahead", empresaCodigo],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("imputable", "true");
      qs.set("activa", "true");
      if (empresaCodigo) qs.set("empresa_codigo", empresaCodigo);
      return apiClient.get<PlanCuenta[]>(`/plan-cuentas?${qs}`, session);
    },
    enabled: !!session && !!empresaCodigo,
    staleTime: 5 * 60_000,
  });

  // Cuenta actualmente seleccionada (para mostrar label completo cuando no
  // hay foco en el input).
  const selected = useMemo(
    () => cuentas?.find((c) => c.codigo === value) ?? null,
    [cuentas, value],
  );

  // Display value: si el user no esta tipeando, mostramos el label completo
  // de la cuenta seleccionada (o el `value` raw si las cuentas aun no cargan
  // pero ya hay un codigo prefilled, ej. desde IA en /desde-mensaje).
  const displayValue = open
    ? query
    : selected
      ? `${selected.codigo} — ${selected.nombre}`
      : value || query;

  // Filtrado + ordenamiento por prioridad. Match contra codigo o nombre.
  // `totalMatches` mide el universo filtrado antes de aplicar el cap
  // visible — habilita el footer "Mostrando N de M".
  const { filtered, totalMatches } = useMemo(() => {
    if (!cuentas) return { filtered: [] as PlanCuenta[], totalMatches: 0 };
    const q = query.trim().toLowerCase();
    const base = q
      ? cuentas.filter(
          (c) =>
            c.codigo.toLowerCase().includes(q) ||
            c.nombre.toLowerCase().includes(q),
        )
      : cuentas;
    const sorted = [...base].sort((a, b) => {
      const pa = isPriorityCuenta(a.codigo, tone) ? 0 : 1;
      const pb = isPriorityCuenta(b.codigo, tone) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.codigo.localeCompare(b.codigo);
    });
    return {
      filtered: sorted.slice(0, VISIBLE_LIMIT),
      totalMatches: sorted.length,
    };
  }, [cuentas, query, tone]);

  // Reset del highlight al cambiar query/resultados (siempre resalta primero).
  useEffect(() => {
    setHighlightedIdx(0);
  }, [query, filtered.length]);

  // Cerrar dropdown al click fuera.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[highlightedIdx];
      if (hit) {
        onChange(hit.codigo);
        setQuery("");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showWarning = !!selected && !isPriorityCuenta(selected.codigo, tone);
  const activeDescId =
    open && filtered[highlightedIdx]
      ? `${idPrefix}-${filtered[highlightedIdx]?.codigo}`
      : undefined;

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        required={required}
        value={displayValue}
        onFocus={() => {
          // al focusear, abrimos en modo edicion (limpiamos query si venia
          // mostrando el label)
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // delay para permitir click en el dropdown
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Buscar código o nombre…"}
        className="form-input font-mono"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-activedescendant={activeDescId}
      />
      {open && dropdownPos && typeof window !== "undefined" &&
        createPortal(
        <ul
          className="fixed z-50 max-h-72 overflow-auto rounded-lg border border-hairline bg-white shadow-elevated-lg"
          role="listbox"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
          onMouseDown={(e) => {
            // Evitar que el click cierre el dropdown via onBlur del input
            e.preventDefault();
          }}
        >
          {isLoading && (
            <li className="px-3 py-2 text-xs text-ink-500">Cargando cuentas…</li>
          )}
          {!isLoading && filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-500">
              Sin coincidencias.
            </li>
          )}
          {filtered.map((c, idx) => {
            const priority = isPriorityCuenta(c.codigo, tone);
            const isHighlighted = idx === highlightedIdx;
            return (
              <li
                key={c.codigo}
                id={`${idPrefix}-${c.codigo}`}
                role="option"
                aria-selected={c.codigo === value}
                onMouseEnter={() => setHighlightedIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.codigo);
                  setQuery("");
                  setOpen(false);
                }}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  isHighlighted
                    ? "bg-cehta-green/15"
                    : "hover:bg-cehta-green/10"
                } ${priority ? "" : "opacity-80"}`}
              >
                <div className="font-mono text-ink-900">
                  {highlightMatch(c.codigo, query).map((seg, i) =>
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
                  {!priority && (
                    <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                      no habitual
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-500">
                  {highlightMatch(c.nombre, query).map((seg, i) =>
                    seg.highlight ? (
                      <mark
                        key={i}
                        className="bg-cehta-green/30 text-ink-700 rounded-sm px-0.5"
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )}
                </div>
              </li>
            );
          })}
          {totalMatches > filtered.length && (
            <li className="border-t border-hairline bg-ink-50/60 px-3 py-1.5 text-[11px] text-ink-500">
              Mostrando {filtered.length} de {totalMatches} — afiná la búsqueda
            </li>
          )}
        </ul>,
        document.body,
      )}
      {showWarning && (
        <p className="mt-1 text-[11px] text-amber-600">
          Cuenta no habitual para esta sección. ¿Confirmas?
        </p>
      )}
    </div>
  );
}
