"use client";

/**
 * CajaAlDiaState — R152ii
 *
 * Estado vacío premium para /transferencias cuando NO hay vouchers
 * pendientes. Reemplaza al EmptyState genérico SOLO en el caso "todo al
 * día" (sin drafts ni firmas pendientes en otras pestañas).
 */
import { Sparkles } from "lucide-react";

export function CajaAlDiaState() {
  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-hairline bg-white shadow-card p-10 sm:p-14 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-56 w-[480px] rounded-full bg-cehta-green/20 blur-3xl"
      />
      <div className="relative flex flex-col items-center">
        <span className="relative inline-flex">
          <span className="absolute inset-0 rounded-full bg-cehta-green/25 blur-2xl animate-pulse" />
          <span className="relative inline-flex size-20 items-center justify-center rounded-2xl bg-cehta-green/10 ring-1 ring-cehta-green/30 text-cehta-green shadow-sm">
            <Sparkles className="size-10" strokeWidth={1.75} />
          </span>
        </span>
        <h2 className="mt-6 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-ink-900">
          Caja al día <span className="text-ink-300">·</span>{" "}
          <span className="text-cehta-green">Sin pagos pendientes</span>
        </h2>
        <p className="mt-2 max-w-md text-sm text-ink-500">
          Volvé cuando haya vouchers nuevos aprobados. Los pagos APPROVED
          aparecen acá automáticamente para que los confirmes en lote.
        </p>
      </div>
    </div>
  );
}
