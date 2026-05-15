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
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label="Ver ayuda"
            className="inline-flex cursor-help items-center justify-center rounded-full text-ink-400 hover:text-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <Info style={{ width: size, height: size }} strokeWidth={2} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] whitespace-normal leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
