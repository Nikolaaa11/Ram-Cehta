"use client";

import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConversationSummary {
  conversation_id: number;
  title: string | null;
  updated_at: string;
}

function formatLabel(iso: string): string {
  try {
    const d = new Date(iso);
    if (isToday(d)) return "Hoy";
    if (isYesterday(d)) return "Ayer";
    return format(d, "d MMM", { locale: es });
  } catch {
    return "";
  }
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-hairline bg-surface-muted">
      <div className="border-b border-hairline p-3">
        <Button
          type="button"
          onClick={onCreate}
          className="w-full justify-start gap-2 bg-cehta-green text-white hover:bg-cehta-green-600"
          size="sm"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          Nueva conversación
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-500">
            Todavía no tenés conversaciones acá.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((c) => (
              <li key={c.conversation_id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.conversation_id)}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150 ease-apple",
                    activeId === c.conversation_id
                      ? "bg-white ring-1 ring-cehta-green/30 text-ink-900 shadow-card"
                      : "text-ink-700 hover:bg-white",
                  )}
                >
                  <MessageSquare
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {c.title?.trim() || "(sin título)"}
                    </span>
                    <span className="block text-[11px] text-ink-500">
                      {formatLabel(c.updated_at)}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.conversation_id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onDelete(c.conversation_id);
                      }
                    }}
                    aria-label="Borrar conversación"
                    className="invisible rounded p-1 text-ink-300 transition-opacity hover:bg-ink-100 hover:text-negative group-hover:visible"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
