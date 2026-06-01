"use client";

/**
 * BrandSwitcher — V5++ ola BS.
 *
 * Dropdown que aparece en la sección "brand" del sidebar. Permite al user
 * cambiar rápidamente de empresa sin tener que scrollear el árbol de
 * empresas abajo del sidebar.
 *
 * Solo visible si el user tiene acceso a MÁS de 1 empresa (sino no tiene
 * sentido). Click en el brand → abre dropdown con la lista de empresas
 * accesibles + el "default" Cehta Capital arriba.
 *
 * Al elegir una empresa, llama setActive() del useActiveEmpresa hook
 * → el brand del sidebar (logo + nombre) se actualiza inmediatamente.
 */
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { ChevronDown, Check } from "lucide-react";
import {
  useMyEmpresas,
  LOGO_MAP,
  type MyEmpresa,
} from "@/hooks/use-my-empresas";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { cn } from "@/lib/utils";

export function BrandSwitcher({
  currentLogo,
  currentName,
  currentSubtitle,
  activeCodigo,
}: {
  currentLogo: string;
  currentName: string;
  currentSubtitle: string;
  activeCodigo: string | null;
}) {
  const { data: myEmpresas } = useMyEmpresas();
  const { setActive } = useActiveEmpresa();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const empresas = myEmpresas?.empresas ?? [];
  // Si tiene 1 sola empresa, no mostrar el switcher (no hay nada que switchear)
  const hasMultiple = empresas.length > 1;

  if (!hasMultiple) {
    // Layout simple sin botón clickeable
    return (
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-glass ring-1 ring-hairline">
          <Image
            src={currentLogo}
            alt={currentName}
            width={40}
            height={40}
            className="h-full w-full object-contain p-0.5"
            unoptimized
            priority
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold tracking-tight text-ink-900 truncate"
            title={currentName}
          >
            {currentName}
          </p>
          <p className="text-xs text-ink-500 truncate" title={currentSubtitle}>
            {currentSubtitle}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2 min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex items-center gap-3 min-w-0 flex-1 rounded-xl px-1 py-1 -mx-1",
          "hover:bg-ink-50 transition-all duration-200 ease-apple",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Cambiar empresa"
      >
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-glass ring-1 ring-hairline transition-all duration-300 ease-apple group-hover:ring-cehta-green/40 group-hover:shadow-glow-green">
          <Image
            src={currentLogo}
            alt={currentName}
            width={40}
            height={40}
            className="h-full w-full object-contain p-0.5 transition-transform duration-300 ease-apple group-hover:scale-105"
            unoptimized
            priority
          />
          {/* Active indicator dot — pulse cuando hay empresa activa real */}
          {activeCodigo !== null && (
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 inline-flex h-2.5 w-2.5 items-center justify-center"
            >
              <span className="absolute h-full w-full rounded-full bg-cehta-green/40 animate-pulse-ring" />
              <span className="relative h-2 w-2 rounded-full bg-cehta-green ring-2 ring-white" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p
            className="text-sm font-semibold tracking-tight text-ink-900 truncate transition-colors group-hover:text-cehta-green"
            title={currentName}
          >
            {currentName}
          </p>
          <p className="text-xs text-ink-500 truncate" title={currentSubtitle}>
            {currentSubtitle}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-ink-400 shrink-0 transition-all duration-300 ease-apple",
            open && "rotate-180 text-cehta-green",
          )}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full mt-2 w-72 rounded-2xl border border-hairline",
            "bg-white/95 backdrop-blur-xl shadow-elevated-lg z-50 max-h-96 overflow-y-auto",
            "",
            "animate-slide-down-fade",
          )}
          role="listbox"
        >
          {/* Header sutil del dropdown */}
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-xl border-b border-hairline px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Cambiar empresa · {empresas.length}
              </p>
              {myEmpresas?.is_admin && (
                <span
                  title="Eres admin global — tenés acceso a todas las empresas"
                  className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cehta-green ring-1 ring-cehta-green/20"
                >
                  ★ Admin
                </span>
              )}
            </div>
          </div>

          {/* Option: Cehta Capital default */}
          <button
            type="button"
            onClick={() => {
              setActive(null);
              setOpen(false);
            }}
            className={cn(
              "group/item w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
              "hover:bg-gradient-to-r hover:from-cehta-green/5 hover:to-transparent",
              "",
              "border-b border-hairline",
              activeCodigo === null && "bg-cehta-green/5",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-hairline transition-all duration-200 group-hover/item:ring-cehta-green/40 group-hover/item:scale-110">
              <Image
                src="/logos/cehta.png"
                alt="Cehta"
                width={32}
                height={32}
                className="h-full w-full object-contain p-0.5"
                unoptimized
              />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium truncate",
                  activeCodigo === null
                    ? "text-cehta-green"
                    : "text-ink-900",
                )}
              >
                Cehta Capital
              </p>
              <p className="text-xs text-ink-500">
                Vista global · FIP CEHTA ESG
              </p>
            </div>
            {activeCodigo === null && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cehta-green text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
          </button>

          {empresas.map((emp, idx) => {
            const isActive = activeCodigo === emp.codigo;
            return (
              <button
                key={emp.codigo}
                type="button"
                onClick={() => {
                  setActive(emp.codigo);
                  setOpen(false);
                }}
                style={{ animationDelay: `${idx * 20}ms` }}
                className={cn(
                  "group/item w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all",
                  "hover:bg-gradient-to-r hover:from-cehta-green/5 hover:to-transparent",
                  "",
                  isActive && "bg-cehta-green/5",
                  "animate-slide-up-fade",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-hairline transition-all duration-200 group-hover/item:ring-cehta-green/40 group-hover/item:scale-110">
                  <Image
                    src={LOGO_MAP[emp.codigo] ?? "/logos/cehta.png"}
                    alt={emp.codigo}
                    width={32}
                    height={32}
                    className="h-full w-full object-contain p-0.5"
                    unoptimized
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate",
                      isActive
                        ? "font-semibold text-cehta-green"
                        : "font-medium text-ink-900",
                    )}
                    title={emp.razon_social}
                  >
                    {emp.razon_social}
                  </p>
                  <p className="text-xs text-ink-500 flex items-center gap-1.5">
                    <span className="font-mono">{emp.codigo}</span>
                    {emp.roles.length > 0 && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span className="text-[10px] uppercase tracking-wide">
                          {emp.roles.join(", ")}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {isActive && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cehta-green text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Helper export for parent */
export type { MyEmpresa };
