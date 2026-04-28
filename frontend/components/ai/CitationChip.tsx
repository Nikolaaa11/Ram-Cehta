"use client";

import { FileText } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatCitation } from "@/hooks/use-chat-stream";

/**
 * Badge clickable mostrando la fuente de un chunk citado por el assistant.
 * Tooltip muestra el snippet (primeros 200 chars del chunk).
 */
export function CitationChip({ citation, index }: { citation: ChatCitation; index: number }) {
  const label = (() => {
    if (citation.source_path) {
      const parts = citation.source_path.split("/");
      return parts[parts.length - 1] || citation.source_path;
    }
    return `chunk #${citation.chunk_id}`;
  })();

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-cehta-green/5 px-2 py-0.5 text-xs font-medium text-cehta-green-700 ring-1 ring-cehta-green/10 transition-colors duration-150 ease-apple hover:bg-cehta-green/10">
            <FileText className="h-3 w-3" strokeWidth={1.75} />
            <span className="max-w-[160px] truncate">
              {index + 1}. {label}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-sm whitespace-pre-wrap text-xs leading-relaxed"
        >
          <div className="font-semibold">{label}</div>
          {citation.snippet ? (
            <div className="mt-1 text-ink-500">{citation.snippet}</div>
          ) : (
            <div className="mt-1 italic text-ink-300">Sin snippet disponible</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
