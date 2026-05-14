"use client";

/**
 * CuentaTypeahead — AJUSTE 10
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
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { PlanCuenta } from "@/lib/api/schema";

interface Props {
  value: string; // codigo seleccionado actual
  onChange: (codigo: string) => void;
  empresaCodigo: string;
  tone: "contable" | "financiera";
  placeholder?: string;
  required?: boolean;
}

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
}: Props) {
  const { session } = useSession();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

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
  const filtered = useMemo(() => {
    if (!cuentas) return [] as PlanCuenta[];
    const q = query.trim().toLowerCase();
    const base = q
      ? cuentas.filter(
          (c) =>
            c.codigo.toLowerCase().includes(q) ||
            c.nombre.toLowerCase().includes(q),
        )
      : cuentas;
    // Prioritarias primero
    return [...base].sort((a, b) => {
      const pa = isPriorityCuenta(a.codigo, tone) ? 0 : 1;
      const pb = isPriorityCuenta(b.codigo, tone) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.codigo.localeCompare(b.codigo);
    }).slice(0, 50); // cap razonable para perf de render
  }, [cuentas, query, tone]);

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

  const showWarning = !!selected && !isPriorityCuenta(selected.codigo, tone);

  return (
    <div ref={containerRef} className="relative">
      <input
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
        placeholder={placeholder ?? "Buscar código o nombre…"}
        className="form-input font-mono"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-hairline bg-white dark:bg-ink-900 shadow-lg"
          role="listbox"
        >
          {isLoading && (
            <li className="px-3 py-2 text-xs text-ink-500">Cargando cuentas…</li>
          )}
          {!isLoading && filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-500">
              Sin coincidencias.
            </li>
          )}
          {filtered.map((c) => {
            const priority = isPriorityCuenta(c.codigo, tone);
            return (
              <li
                key={c.codigo}
                role="option"
                aria-selected={c.codigo === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c.codigo);
                  setQuery("");
                  setOpen(false);
                }}
                className={`cursor-pointer px-3 py-2 text-sm hover:bg-cehta-green/10 ${
                  priority ? "" : "opacity-80"
                }`}
              >
                <div className="font-mono text-ink-900 dark:text-ink-100">
                  {c.codigo}
                  {!priority && (
                    <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      no habitual
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-500">{c.nombre}</div>
              </li>
            );
          })}
        </ul>
      )}
      {showWarning && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          Cuenta no habitual para esta sección. ¿Confirmas?
        </p>
      )}
    </div>
  );
}
