"use client";

/**
 * EmptyState — V4 fase 7.16.
 *
 * Componente universal para "sin datos" con jerarquía visual consistente
 * y opcionalmente uno o dos CTAs accionables.
 *
 * Reemplaza los empty states ad-hoc dispersos por la app — ahora todos
 * tienen el mismo estilo (icon en círculo + title + description + CTAs).
 *
 * Uso:
 *   <EmptyState
 *     icon={Inbox}
 *     title="Sin notificaciones"
 *     description="Te avisamos cuando haya algo nuevo."
 *     primaryAction={{ label: "Generar alertas", onClick: ... }}
 *     secondaryAction={{ label: "Ver preferencias", href: "/notificaciones?tab=prefs" }}
 *   />
 */
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

interface ActionLink {
  label: string;
  href: string;
}

interface ActionButton {
  label: string;
  onClick: () => void;
}

type Action = ActionLink | ActionButton;

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: Action;
  secondaryAction?: Action;
  /** Tono visual del icono. Default 'default' (gris). */
  tone?: "default" | "positive" | "info";
  /** Padding del Surface. */
  padding?: "compact" | "default" | "loose";
  className?: string;
}

const TONE_BG: Record<NonNullable<Props["tone"]>, string> = {
  default: "bg-ink-100/60 text-ink-400",
  positive: "bg-positive/15 text-positive",
  info: "bg-cehta-green/15 text-cehta-green",
};

function isLinkAction(a: Action): a is ActionLink {
  return "href" in a;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  primaryAction,
  secondaryAction,
  tone = "default",
  padding = "loose",
  className,
}: Props) {
  const padClass = {
    compact: "py-8",
    default: "py-12",
    loose: "py-16",
  }[padding];

  return (
    <Surface className={cn("text-center", padClass, className)}>
      <div className="mx-auto max-w-md">
        <div
          className={cn(
            "mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl",
            TONE_BG[tone],
          )}
        >
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-base font-semibold text-ink-900">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-ink-500">{description}</p>
        )}
        {(primaryAction || secondaryAction) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {primaryAction &&
              (isLinkAction(primaryAction) ? (
                <a
                  href={primaryAction.href}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700"
                >
                  {primaryAction.label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700"
                >
                  {primaryAction.label}
                </button>
              ))}
            {secondaryAction &&
              (isLinkAction(secondaryAction) ? (
                <a
                  href={secondaryAction.href}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  {secondaryAction.label}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
                >
                  {secondaryAction.label}
                </button>
              ))}
          </div>
        )}
      </div>
    </Surface>
  );
}
