"use client";

/**
 * EmpresaSwitcher — V4 fase 7.16.
 *
 * Dropdown que aparece en el header de /empresa/[codigo] permitiendo saltar
 * rápidamente a cualquier otra empresa sin volver al sidebar / catálogo.
 *
 * Bonus: shortcuts ← / → para navegar entre empresas adyacentes en orden
 * alfabético del catálogo.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { cn } from "@/lib/utils";

interface Props {
  currentCodigo: string;
}

export function EmpresaSwitcher({ currentCodigo }: Props) {
  const router = useRouter();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // Sort alfabético para navegación predecible
  const sorted = useMemo(
    () => [...empresas].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    [empresas],
  );

  const currentIdx = sorted.findIndex((e) => e.codigo === currentCodigo);
  const prev = currentIdx > 0 ? sorted[currentIdx - 1] : null;
  const next =
    currentIdx >= 0 && currentIdx < sorted.length - 1
      ? sorted[currentIdx + 1]
      : null;

  const filtered = useMemo(() => {
    if (!filter.trim()) return sorted;
    const q = filter.trim().toLowerCase();
    return sorted.filter(
      (e) =>
        e.codigo.toLowerCase().includes(q) ||
        e.razon_social?.toLowerCase().includes(q),
    );
  }, [sorted, filter]);

  // Keyboard shortcuts ← / → para saltar adyacentes (sin abrir popover)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isTyping) return;

      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        router.push(`/empresa/${prev.codigo}` as never);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        router.push(`/empresa/${next.codigo}` as never);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);

  return (
    <div className="flex items-center gap-1.5">
      {/* Prev arrow */}
      <button
        type="button"
        onClick={() => prev && router.push(`/empresa/${prev.codigo}` as never)}
        disabled={!prev}
        title={prev ? `← ${prev.codigo}` : "Sin empresa previa"}
        aria-label="Empresa anterior"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-500 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>

      {/* Switcher dropdown */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            Cambiar empresa
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-180",
              )}
              strokeWidth={1.75}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          {/* Search */}
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
              strokeWidth={1.75}
            />
            <input
              type="text"
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar empresa…"
              className="w-full rounded-lg border-0 bg-ink-50 py-1.5 pl-8 pr-2 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs italic text-ink-400">
                Sin coincidencias
              </p>
            ) : (
              filtered.map((emp) => {
                const isCurrent = emp.codigo === currentCodigo;
                return (
                  <button
                    key={emp.codigo}
                    type="button"
                    onClick={() => {
                      if (!isCurrent) {
                        router.push(`/empresa/${emp.codigo}` as never);
                        setOpen(false);
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      isCurrent
                        ? "bg-cehta-green/10 text-cehta-green"
                        : "hover:bg-ink-50",
                    )}
                  >
                    <EmpresaLogo empresaCodigo={emp.codigo} size={20} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{emp.codigo}</p>
                      <p className="truncate text-[10px] text-ink-500">
                        {emp.razon_social ?? "—"}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-cehta-green">
                        actual
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <p className="mt-2 border-t border-hairline pt-1.5 text-[9px] text-ink-400">
            Atajos:{" "}
            <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[9px]">
              ←
            </kbd>{" "}
            anterior ·{" "}
            <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[9px]">
              →
            </kbd>{" "}
            siguiente
          </p>
        </PopoverContent>
      </Popover>

      {/* Next arrow */}
      <button
        type="button"
        onClick={() => next && router.push(`/empresa/${next.codigo}` as never)}
        disabled={!next}
        title={next ? `${next.codigo} →` : "Sin empresa siguiente"}
        aria-label="Empresa siguiente"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-500 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
