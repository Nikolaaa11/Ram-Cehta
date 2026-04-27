"use client";

import { Download, FileSpreadsheet, Mail, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ReportActionsBarProps {
  onDownloadPdf: () => void;
  pdfLoading?: boolean;
  pdfError?: string | null;
}

/**
 * Barra de acciones del reporte. Excel y Email se muestran deshabilitados con
 * tooltip "Próximamente" — UX consistente con la roadmap de la plataforma.
 */
export function ReportActionsBar({
  onDownloadPdf,
  pdfLoading = false,
  pdfError = null,
}: ReportActionsBarProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDownloadPdf}
          disabled={pdfLoading}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-apple",
            "hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
            "disabled:cursor-progress disabled:opacity-70",
          )}
        >
          {pdfLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Download className="h-4 w-4" strokeWidth={1.5} />
          )}
          {pdfLoading ? "Generando PDF…" : "Descargar PDF"}
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-500 ring-1 ring-hairline cursor-not-allowed"
            >
              <FileSpreadsheet className="h-4 w-4" strokeWidth={1.5} />
              Exportar Excel
            </button>
          </TooltipTrigger>
          <TooltipContent>Próximamente</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-500 ring-1 ring-hairline cursor-not-allowed"
            >
              <Mail className="h-4 w-4" strokeWidth={1.5} />
              Enviar por email
            </button>
          </TooltipTrigger>
          <TooltipContent>Próximamente</TooltipContent>
        </Tooltip>

        {pdfError ? (
          <span className="text-xs text-negative">{pdfError}</span>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
