"use client";

/**
 * CeoToolbar — V5.6.
 *
 * Barra de acciones para el CEO Dashboard:
 *   - Print / Export PDF (window.print con CSS print-friendly)
 *   - Modo presentación (fullscreen + auto-rotate cada 15s entre secciones)
 *   - Período selector global (30d / 90d / YTD)
 *
 * Control de modo presentación se mantiene aquí para que toggle ON-OFF
 * sea accesible siempre. Auto-rotate scroll smooth entre data-presentation
 * sections.
 */
import { useEffect, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Play,
  Pause,
  Printer,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePeriodoFilter, type Periodo } from "@/hooks/use-periodo-filter";

const PERIODO_OPTIONS: { v: Periodo; label: string }[] = [
  { v: "30d", label: "30d" },
  { v: "90d", label: "90d" },
  { v: "ytd", label: "YTD" },
];

export function CeoToolbar() {
  const { periodo, setPeriodo } = usePeriodoFilter();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);

  // Track fullscreen state cambios externos (Esc, F11)
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Auto-rotate sections en modo presentación
  useEffect(() => {
    if (!isPresenting) return;
    const sections = document.querySelectorAll<HTMLElement>(
      "[data-presentation-section]",
    );
    if (sections.length === 0) return;
    let idx = 0;
    const tick = () => {
      idx = (idx + 1) % sections.length;
      sections[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const interval = setInterval(tick, 15_000);
    return () => clearInterval(interval);
  }, [isPresenting]);

  const togglePresenting = async () => {
    if (!isPresenting) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // si el browser lo bloquea, igual activamos auto-rotate
      }
      setIsPresenting(true);
    } else {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          /* noop */
        }
      }
      setIsPresenting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {/* Periodo selector */}
      <div className="inline-flex items-center gap-1 rounded-xl bg-ink-100/40 p-0.5 ring-1 ring-hairline">
        <Calendar
          className="ml-1.5 h-3 w-3 text-ink-400"
          strokeWidth={1.75}
        />
        {PERIODO_OPTIONS.map(({ v, label }) => (
          <button
            key={v}
            type="button"
            onClick={() => setPeriodo(v)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ease-apple",
              periodo === v
                ? "bg-white text-ink-900 shadow-card/40"
                : "text-ink-600 hover:bg-white/40",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Print PDF */}
      <button
        type="button"
        onClick={() => window.print()}
        title="Imprimir / Exportar a PDF"
        className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
      >
        <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
        PDF
      </button>

      {/* Modo presentación */}
      <button
        type="button"
        onClick={togglePresenting}
        title={
          isPresenting
            ? "Detener presentación"
            : "Modo presentación (fullscreen + auto-rotate cada 15s)"
        }
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
          isPresenting
            ? "bg-cehta-green text-white hover:bg-cehta-green-700"
            : "border border-hairline bg-white text-ink-700 hover:bg-ink-50",
        )}
      >
        {isPresenting ? (
          <>
            <Pause className="h-3.5 w-3.5" strokeWidth={2} />
            Detener
          </>
        ) : (
          <>
            <Play className="h-3.5 w-3.5" strokeWidth={2} />
            Presentar
          </>
        )}
      </button>

      {/* Fullscreen indicator (auto si presenting) */}
      {isFullscreen && !isPresenting && (
        <span className="inline-flex items-center gap-1 text-[10px] text-ink-500">
          <Maximize2 className="h-3 w-3" strokeWidth={1.75} />
          Pantalla completa
        </span>
      )}
      {isPresenting && (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-cehta-green">
          <Minimize2 className="h-3 w-3 animate-pulse" strokeWidth={2} />
          Auto-rotate cada 15s
        </span>
      )}
    </div>
  );
}
