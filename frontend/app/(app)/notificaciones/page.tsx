"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  Inbox,
  Info,
} from "lucide-react";
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationsFeed,
  useUnreadCount,
} from "@/hooks/use-notifications";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import type { Notification } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

type Tab = "todas" | "sin_leer";

const TAB_LABEL: Record<Tab, string> = {
  todas: "Todas",
  sin_leer: "Sin leer",
};

const SEVERITY_ICON: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const SEVERITY_CLASS: Record<string, string> = {
  info: "text-sf-blue ring-sf-blue/30",
  warning: "text-warning ring-warning/30",
  critical: "text-negative ring-negative/30",
};

function bucketFor(iso: string): string {
  const d = parseISO(iso);
  const diff = differenceInCalendarDays(new Date(), d);
  if (diff <= 0) return "Hoy";
  if (diff === 1) return "Ayer";
  if (diff <= 7) return "Esta semana";
  return "Anteriores";
}

const BUCKET_ORDER = ["Hoy", "Ayer", "Esta semana", "Anteriores"];

export default function NotificacionesPage() {
  const [tab, setTab] = useState<Tab>("todas");
  const { data: unread } = useUnreadCount();
  const { data: feed, isLoading } = useNotificationsFeed(
    tab === "sin_leer",
    1,
    100,
  );
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  const items = feed?.items ?? [];
  const unreadCount = unread?.unread ?? 0;

  const grouped = useMemo(() => {
    const out: Record<string, Notification[]> = {};
    for (const n of items) {
      const key = bucketFor(n.created_at);
      if (!out[key]) out[key] = [];
      out[key].push(n);
    }
    return out;
  }, [items]);

  return (
    <div className="mx-auto max-w-[860px] space-y-6 px-6 py-6 lg:px-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Notificaciones
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Alertas operativas: F29 por vencer, contratos próximos al fin de
            vigencia y OCs pendientes de pago.
          </p>
        </div>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || unreadCount === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium",
            "ring-1 ring-hairline text-ink-700 transition-colors duration-150 ease-apple",
            "hover:bg-ink-100/40 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <CheckCheck className="h-4 w-4" strokeWidth={1.5} />
          Marcar todas como leídas
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-xl px-4 py-1.5 text-sm font-medium transition-colors duration-150 ease-apple",
                "ring-1",
                isActive
                  ? "bg-cehta-green/15 text-cehta-green ring-cehta-green/30"
                  : "bg-white text-ink-700 ring-hairline hover:bg-cehta-green/5",
              )}
            >
              {TAB_LABEL[t]}
              {t === "sin_leer" && unreadCount > 0 && (
                <span className="ml-2 rounded-full bg-negative/10 px-1.5 text-[11px] font-semibold text-negative">
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <Surface padding="default" className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </Surface>
      ) : items.length === 0 ? (
        <Surface padding="default" className="text-center">
          <Inbox
            className="mx-auto mb-3 h-10 w-10 text-ink-300"
            strokeWidth={1.5}
          />
          <p className="text-sm font-medium text-ink-700">
            {tab === "sin_leer"
              ? "Sin notificaciones nuevas"
              : "Todavía no hay notificaciones"}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Las alertas se generan automáticamente cuando hay F29 por vencer,
            contratos próximos al cierre, o OCs estancadas.
          </p>
        </Surface>
      ) : (
        <div className="space-y-6">
          {BUCKET_ORDER.filter((b) => grouped[b]?.length).map((bucket) => {
            const list = grouped[bucket] ?? [];
            return (
              <section key={bucket}>
                <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-300">
                  {bucket}
                </h2>
                <Surface padding="none" className="divide-y divide-hairline">
                  {list.map((n) => (
                    <NotificationCard
                      key={n.id}
                      notification={n}
                      onMarkRead={() => {
                        if (!n.read_at) markRead.mutate(n.id);
                      }}
                    />
                  ))}
                </Surface>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationCard({
  notification,
  onMarkRead,
}: {
  notification: Notification;
  onMarkRead: () => void;
}) {
  const Icon = SEVERITY_ICON[notification.severity] ?? Info;
  const sevClass =
    SEVERITY_CLASS[notification.severity] ?? SEVERITY_CLASS.info;
  const isUnread = !notification.read_at;

  const inner = (
    <div
      className={cn(
        "flex gap-4 px-5 py-4 transition-colors duration-150 ease-apple",
        "hover:bg-cehta-green/5",
        isUnread && "bg-cehta-green/[0.025]",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 bg-white",
          sevClass,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm leading-snug text-ink-900",
              isUnread ? "font-semibold" : "font-medium",
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span
              aria-hidden
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cehta-green"
            />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 text-[13px] text-ink-500">{notification.body}</p>
        )}
        <p className="mt-1.5 text-[11px] text-ink-300 tabular-nums">
          {format(parseISO(notification.created_at), "PPp", { locale: es })}
        </p>
      </div>
    </div>
  );

  if (notification.link) {
    return (
      <Link
        href={{ pathname: notification.link }}
        onClick={onMarkRead}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onMarkRead}
      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
    >
      {inner}
    </button>
  );
}
