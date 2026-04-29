"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, AlertTriangle, Bell, CheckCheck, Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsFeed,
  useUnreadCount,
} from "@/hooks/use-notifications";
import type { Notification } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

/**
 * NotificationsBell — bell icon en topbar/sidebar con badge de no leídas.
 *
 * Click → popover con últimas 10 notifs. Cada item:
 *   - Severity icon (info azul, warning ámbar, critical rojo)
 *   - Título + body (truncate 2 lineas)
 *   - Tiempo relativo "hace 5 min" (es-CL)
 *   - Link opcional → Click marca leída + navega
 *
 * Footer: "Marcar todas como leídas" + "Ver todas" → /notificaciones.
 */

type SevStyle = { icon: typeof Info; iconClass: string; ring: string };
const SEV_INFO: SevStyle = {
  icon: Info,
  iconClass: "text-sf-blue",
  ring: "ring-sf-blue/30",
};
const SEV_WARNING: SevStyle = {
  icon: AlertTriangle,
  iconClass: "text-warning",
  ring: "ring-warning/30",
};
const SEV_CRITICAL: SevStyle = {
  icon: AlertCircle,
  iconClass: "text-negative",
  ring: "ring-negative/30",
};
function severityStyle(sev: string): SevStyle {
  if (sev === "warning") return SEV_WARNING;
  if (sev === "critical") return SEV_CRITICAL;
  return SEV_INFO;
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const { data: unread } = useUnreadCount();
  const { data: feed, isLoading } = useNotificationsFeed(false, 1, 10);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const unreadCount = unread?.unread ?? 0;
  const items = useMemo<Notification[]>(() => feed?.items ?? [], [feed]);

  const handleItemClick = (n: Notification) => {
    if (!n.read_at) {
      markRead.mutate(n.id);
    }
    setOpen(false);
  };

  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notificaciones${
            unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""
          }`}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-xl",
            "ring-1 ring-hairline bg-white/90 backdrop-blur",
            "transition-colors duration-150 ease-apple",
            "hover:bg-cehta-green/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
          )}
        >
          <Bell className="h-4 w-4 text-ink-700" strokeWidth={1.5} />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center",
                "rounded-full bg-negative px-1 text-[10px] font-semibold text-white",
                "ring-2 ring-white",
              )}
            >
              {badgeText}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 ring-hairline bg-white/95 backdrop-blur"
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-ink-900">
              Notificaciones
            </h3>
            <p className="text-[11px] text-ink-500">
              {unreadCount} sin leer
            </p>
          </div>
          <button
            type="button"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || unreadCount === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
              "text-ink-700 transition-colors duration-150 ease-apple",
              "hover:bg-cehta-green/10 hover:text-cehta-green",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.5} />
            Marcar todas
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-ink-100/40"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-ink-500">No tenés notificaciones.</p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={() => handleItemClick(n)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-hairline px-3 py-2">
          <Link
            href={"/notificaciones" as never}
            onClick={() => setOpen(false)}
            className={cn(
              "block w-full rounded-lg px-3 py-1.5 text-center text-[12px] font-medium",
              "text-cehta-green transition-colors duration-150 ease-apple",
              "hover:bg-cehta-green/10",
            )}
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: Notification;
  onClick: () => void;
}) {
  const sev = severityStyle(notification.severity);
  const Icon = sev.icon;
  const isUnread = !notification.read_at;

  const inner = (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors duration-150 ease-apple",
        "hover:bg-cehta-green/5",
        isUnread && "bg-cehta-green/[0.025]",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1",
          sev.ring,
          "bg-white",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", sev.iconClass)} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-[13px] leading-snug text-ink-900",
              isUnread ? "font-semibold" : "font-medium",
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span
              aria-hidden
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cehta-green"
            />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-500">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[11px] text-ink-300 tabular-nums">
          {formatRelative(notification.created_at)}
        </p>
      </div>
    </div>
  );

  if (notification.link) {
    return (
      <li>
        <Link
          href={{ pathname: notification.link }}
          onClick={onClick}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
        >
          {inner}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        {inner}
      </button>
    </li>
  );
}
