"use client";

/**
 * VoucherTimelineCard — Etapa B
 *
 * Card que muestra la historia cronologica del voucher en formato
 * timeline visual. Cada evento es un nodo con:
 *   - Icono coloreado segun tipo (created/approved/rejected/executed…)
 *   - Titulo del evento
 *   - Subtitle / summary del audit log
 *   - User email + timestamp relativo
 *
 * Usa /vouchers/{id}/timeline que combina:
 *   - audit.action_log filtrado por voucher
 *   - voucher_approvals con role + comments
 *   - voucher.created_at como evento inicial
 */

import { useQuery } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  Download,
  Edit3,
  FileSignature,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

interface TimelineEvent {
  type: string;
  icon: string;
  title: string;
  subtitle: string;
  user_email: string | null;
  timestamp: string | null;
  color: string;
  action_raw?: string;
}

interface TimelineResponse {
  voucher_id: number;
  codigo: string;
  current_status: string;
  events: TimelineEvent[];
  count: number;
}

const ICON_MAP = {
  plus: Plus,
  check: Check,
  x: X,
  wallet: Wallet,
  edit: Edit3,
  trash: Trash2,
  download: Download,
  signature: FileSignature,
  dot: CheckCircle2,
} as const;

const COLOR_CLASSES: Record<string, { bg: string; text: string; ring: string }> = {
  green: {
    bg: "bg-cehta-green/10",
    text: "text-cehta-green",
    ring: "ring-cehta-green/30",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-600",
    ring: "ring-red-200",
  },
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-600",
    ring: "ring-blue-200",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-600",
    ring: "ring-amber-200",
  },
  purple: {
    bg: "bg-purple-50",
    text: "text-purple-600",
    ring: "ring-purple-200",
  },
  ink: {
    bg: "bg-ink-100",
    text: "text-ink-600",
    ring: "ring-ink-200",
  },
};

function formatRelative(timestamp: string | null): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "hace unos segundos";
  if (diffMin < 60) return `hace ${diffMin}m`;
  if (diffH < 24) return `hace ${diffH}h`;
  if (diffDays < 30) return `hace ${diffDays}d`;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAbsolute(timestamp: string | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VoucherTimelineCard({ voucherId }: { voucherId: number }) {
  const { session } = useSession();
  const { data, isLoading, error } = useQuery<TimelineResponse>({
    queryKey: ["voucher-timeline", voucherId],
    queryFn: () =>
      apiClient.get<TimelineResponse>(
        `/vouchers/${voucherId}/timeline`,
        session,
      ),
    enabled: !!session && !!voucherId,
    staleTime: 30_000,
  });

  return (
    <Surface className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
          <FileSignature className="size-3.5" strokeWidth={2} />
        </div>
        <h3 className="text-sm font-semibold text-ink-900">
          Historia del voucher
        </h3>
        {data && (
          <span className="ml-auto text-[10px] text-ink-500">
            {data.count} evento{data.count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600">
          No se pudo cargar la historia. Refrescá la página.
        </p>
      )}

      {data && data.events.length === 0 && (
        <p className="text-xs text-ink-500">Sin eventos registrados.</p>
      )}

      {data && data.events.length > 0 && (
        <ol className="relative space-y-4 border-l border-hairline pl-6 pt-1">
          {data.events.map((ev, idx) => {
            const Icon = ICON_MAP[ev.icon as keyof typeof ICON_MAP] ?? CheckCircle2;
            const c = COLOR_CLASSES[ev.color] ?? COLOR_CLASSES.ink!;
            return (
              <li key={idx} className="relative">
                <span
                  className={`absolute -left-[33px] inline-flex h-6 w-6 items-center justify-center rounded-full ${c.bg} ${c.text} ring-2 ${c.ring}`}
                  aria-hidden
                >
                  <Icon className="size-3" strokeWidth={2.5} />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-ink-900">
                    {ev.title}
                  </p>
                  {ev.subtitle && (
                    <p className="text-xs text-ink-600 leading-snug">
                      {ev.subtitle}
                    </p>
                  )}
                  <p className="text-[10px] text-ink-500 flex flex-wrap items-center gap-2">
                    {ev.user_email && (
                      <span className="font-medium">{ev.user_email}</span>
                    )}
                    {ev.timestamp && (
                      <span
                        title={formatAbsolute(ev.timestamp)}
                        className="tabular-nums"
                      >
                        · {formatRelative(ev.timestamp)}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Surface>
  );
}
