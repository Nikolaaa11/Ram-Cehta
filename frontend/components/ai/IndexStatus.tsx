"use client";

import { Database, RefreshCcw } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface IndexStatusInfo {
  empresa_codigo: string;
  chunk_count: number;
  last_indexed_at: string | null;
  sources: string[];
}

export function IndexStatus({
  status,
  isAdmin,
  reindexing,
  onReindex,
}: {
  status: IndexStatusInfo | null;
  isAdmin: boolean;
  reindexing: boolean;
  onReindex: () => void;
}) {
  const last =
    status?.last_indexed_at && status.last_indexed_at.length > 0
      ? format(new Date(status.last_indexed_at), "d MMM yyyy, HH:mm", { locale: es })
      : "Nunca";

  const count = status?.chunk_count ?? 0;
  const sources = status?.sources?.length ?? 0;

  return (
    <div className="border-t border-hairline bg-white p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-700">
        <Database className="h-3.5 w-3.5 text-cehta-green" strokeWidth={1.75} />
        Knowledge base
      </div>
      <dl className="mt-2 space-y-0.5 text-[11px] text-ink-500">
        <div className="flex justify-between">
          <dt>Chunks indexados</dt>
          <dd className={cn("font-medium", count > 0 ? "text-ink-900" : "text-ink-300")}>
            {count}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Archivos fuente</dt>
          <dd className="font-medium text-ink-900">{sources}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Último update</dt>
          <dd className="font-medium text-ink-900">{last}</dd>
        </div>
      </dl>
      {isAdmin ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReindex}
          disabled={reindexing}
          className="mt-3 w-full gap-1.5 border-hairline bg-white text-xs"
        >
          <RefreshCcw
            className={cn("h-3 w-3", reindexing && "animate-spin")}
            strokeWidth={1.75}
          />
          {reindexing ? "Indexando..." : "Reindexar Dropbox"}
        </Button>
      ) : null}
    </div>
  );
}
