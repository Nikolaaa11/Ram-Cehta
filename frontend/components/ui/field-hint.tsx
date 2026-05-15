"use client";

/**
 * FieldHint — Etapa I onboarding
 *
 * Icono "i" pequeno al lado del label de un campo, que muestra un tooltip
 * con explicacion al hover. Pensado para reducir ambiguedad en forms
 * sin meter parrafos enteros de texto bajo cada input.
 *
 * Uso:
 *   <label className="flex items-center gap-1">
 *     Fecha de documento
 *     <FieldHint text="Fecha que figura en la factura/documento tributario. No la fecha de pago." />
 *   </label>
 */

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function FieldHint({ text, size = 12 }: { text: string; size?: number }) {
  // QA fix 14/05/2026 — antes usaba <span role="button" tabIndex={0}> que
  // no responde a Enter/Space (no es accesible por teclado pese al aria role).
  // Ahora <button type="button"> real — Radix Tooltip lo soporta con asChild.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Ver ayuda"
            className="inline-flex cursor-help items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-400 hover:text-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green focus:ring-offset-1"
          >
            <Info style={{ width: size, height: size }} strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] whitespace-normal leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
