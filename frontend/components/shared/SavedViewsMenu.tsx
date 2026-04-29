"use client";

/**
 * SavedViewsMenu (V3 fase 11) — dropdown reutilizable para guardar y
 * recuperar combinaciones de filtros por página.
 *
 * Wired desde cada list page (OCs, F29, trabajadores, proveedores,
 * legal, fondos). El page recibe `currentFilters` (snapshot del estado
 * actual de filtros) y un callback `onApply` que setea los filtros
 * desde una vista guardada.
 *
 * Apple polish: `ring-hairline`, `bg-white/95`, `ease-apple` para
 * transiciones, glass surface con backdrop-blur en el dropdown.
 */

import { useState } from "react";
import {
  BookmarkPlus,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import {
  useDeleteView,
  useSavedViews,
  useSaveView,
  useTogglePin,
  useUpdateView,
} from "@/hooks/use-saved-views";
import type { SavedViewPage, SavedViewRead } from "@/lib/api/schema";

interface SavedViewsMenuProps {
  page: SavedViewPage;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
  className?: string;
}

export function SavedViewsMenu({
  page,
  currentFilters,
  onApply,
  className,
}: SavedViewsMenuProps) {
  const [open, setOpen] = useState(false);
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const { data: views = [], isLoading } = useSavedViews(page);
  const saveMutation = useSaveView(page);
  const updateMutation = useUpdateView(page);
  const deleteMutation = useDeleteView(page);
  const togglePinMutation = useTogglePin(page);

  const pinned = views.filter((v) => v.is_pinned);
  const others = views.filter((v) => !v.is_pinned);

  const handleSaveCurrent = () => {
    const name = window.prompt(
      "Nombre para esta vista (máx. 80 caracteres):",
      "",
    );
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed.length > 80) {
      toast.error("El nombre no puede exceder 80 caracteres.");
      return;
    }
    saveMutation.mutate(
      { name: trimmed, filters: currentFilters },
      {
        onSuccess: () => toast.success(`Vista "${trimmed}" guardada.`),
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.detail : "Error al guardar vista.",
          ),
      },
    );
  };

  const handleApply = (view: SavedViewRead) => {
    onApply(view.filters as Record<string, unknown>);
    setOpen(false);
    setActionsOpenId(null);
  };

  const handleRename = (view: SavedViewRead) => {
    const name = window.prompt("Nuevo nombre:", view.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === view.name) return;
    if (trimmed.length > 80) {
      toast.error("El nombre no puede exceder 80 caracteres.");
      return;
    }
    updateMutation.mutate(
      { id: view.id, payload: { name: trimmed } },
      {
        onSuccess: () => toast.success("Vista renombrada."),
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.detail : "Error al renombrar.",
          ),
      },
    );
    setActionsOpenId(null);
  };

  const handleTogglePin = (view: SavedViewRead) => {
    togglePinMutation.mutate(
      { id: view.id, is_pinned: !view.is_pinned },
      {
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.detail : "Error al togglear pin.",
          ),
      },
    );
    setActionsOpenId(null);
  };

  const handleDelete = (view: SavedViewRead) => {
    if (!window.confirm(`¿Eliminar la vista "${view.name}"?`)) return;
    deleteMutation.mutate(view.id, {
      onSuccess: () => toast.success("Vista eliminada."),
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.detail : "Error al eliminar.",
        ),
    });
    setActionsOpenId(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-xl bg-white/95 px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
            className,
          )}
          aria-label="Mis vistas guardadas"
        >
          <BookmarkPlus className="h-4 w-4" strokeWidth={1.5} />
          Mis vistas
          {views.length > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-ink-100/70 px-1.5 text-xs font-medium tabular-nums text-ink-700">
              {views.length}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform duration-150 ease-apple",
              open && "rotate-180",
            )}
            strokeWidth={1.5}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 bg-white/95 p-1 ring-hairline backdrop-blur"
      >
        {isLoading ? (
          <div className="px-3 py-3 text-xs text-ink-500">Cargando…</div>
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-400">
                  Pinned
                </div>
                {pinned.map((view) => (
                  <ViewRow
                    key={view.id}
                    view={view}
                    showPinIcon
                    actionsOpen={actionsOpenId === view.id}
                    onActionsToggle={() =>
                      setActionsOpenId(
                        actionsOpenId === view.id ? null : view.id,
                      )
                    }
                    onApply={() => handleApply(view)}
                    onRename={() => handleRename(view)}
                    onTogglePin={() => handleTogglePin(view)}
                    onDelete={() => handleDelete(view)}
                  />
                ))}
              </div>
            )}
            {others.length > 0 && (
              <div className="mb-1">
                {pinned.length > 0 && (
                  <div className="my-1 border-t border-hairline" />
                )}
                {others.map((view) => (
                  <ViewRow
                    key={view.id}
                    view={view}
                    showPinIcon={false}
                    actionsOpen={actionsOpenId === view.id}
                    onActionsToggle={() =>
                      setActionsOpenId(
                        actionsOpenId === view.id ? null : view.id,
                      )
                    }
                    onApply={() => handleApply(view)}
                    onRename={() => handleRename(view)}
                    onTogglePin={() => handleTogglePin(view)}
                    onDelete={() => handleDelete(view)}
                  />
                ))}
              </div>
            )}
            {views.length === 0 && (
              <div className="px-3 py-3 text-xs text-ink-500">
                Aún no guardaste ninguna vista.
              </div>
            )}
            <div className="my-1 border-t border-hairline" />
            <button
              type="button"
              onClick={handleSaveCurrent}
              disabled={saveMutation.isPending}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-cehta-green transition-colors duration-150 ease-apple hover:bg-cehta-green/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-60"
            >
              <BookmarkPlus className="h-4 w-4" strokeWidth={1.5} />
              {saveMutation.isPending
                ? "Guardando…"
                : "Guardar vista actual"}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface ViewRowProps {
  view: SavedViewRead;
  showPinIcon: boolean;
  actionsOpen: boolean;
  onActionsToggle: () => void;
  onApply: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function ViewRow({
  view,
  showPinIcon,
  actionsOpen,
  onActionsToggle,
  onApply,
  onRename,
  onTogglePin,
  onDelete,
}: ViewRowProps) {
  return (
    <div className="group relative flex items-center gap-1 rounded-lg px-1 hover:bg-ink-100/40">
      <button
        type="button"
        onClick={onApply}
        className="flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
        title={view.name}
      >
        {showPinIcon && (
          <Pin
            className="h-3.5 w-3.5 shrink-0 text-cehta-green"
            strokeWidth={1.5}
          />
        )}
        <span className="truncate">{view.name}</span>
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActionsToggle();
          }}
          aria-label={`Acciones para ${view.name}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 opacity-0 transition-opacity duration-150 ease-apple hover:bg-ink-100 hover:text-ink-900 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green group-hover:opacity-100 data-[open=true]:opacity-100"
          data-open={actionsOpen}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </button>
        {actionsOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl bg-white/95 p-1 ring-1 ring-hairline shadow-card-hover backdrop-blur">
            <button
              type="button"
              onClick={onRename}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-100/40"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              Renombrar
            </button>
            <button
              type="button"
              onClick={onTogglePin}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-100/40"
            >
              {view.is_pinned ? (
                <>
                  <PinOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Quitar pin
                </>
              ) : (
                <>
                  <Pin className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Pinear
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-negative transition-colors duration-150 ease-apple hover:bg-negative/5"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              Eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
