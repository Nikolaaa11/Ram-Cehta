"use client";

/**
 * RecentActivityFeed — V5++ ola CD.
 *
 * Widget reutilizable que muestra los últimos N cambios sobre un recurso
 * o entity_type específico. La bitácora viene del endpoint /audit/actions
 * con filtros.
 *
 * Casos de uso:
 *   - "¿Quién editó esta empresa?" → mostrar últimos cambios del recurso
 *   - "¿Qué pasó en /vouchers este mes?" → últimas creaciones/aprobaciones
 *   - "Actividad en EVOQUE" → todos los cambios que mencionan EVOQUE
 *
 * Apple-style:
 *   - Cards minimales con avatar + acción + tiempo relativo
 *   - Auto-refresh cada 30s (TanStack Query)
 *   - Empty state premium con icon halo
 *   - Hover: drawer con diff completo
 *
 * Uso:
 *   <RecentActivityFeed
 *     entityType="legal_document"
 *     entityId={String(documento_id)}
 *     limit={10}
 *   />
 *
 *   <RecentActivityFeed
 *     entityType="empresa"
 *     entityLabel="EVOQUE"
 *     limit={20}
 *   />
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Activity,
  Clock,
  Edit2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Upload,
  User,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface AuditLogItem {
  log_id: string;
  created_at: string;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  summary: string | null;
}

interface PageResp {
  items: AuditLogItem[];
  total: number;
  page: number;
  size: number;
}

export interface RecentActivityFeedProps {
  /** Filtrar por tipo de entidad (ej: 'voucher', 'legal_document', 'empresa'). */
  entityType?: string;
  /** Filtrar por ID específico (ej: voucher_id=123). */
  entityId?: string;
  /** Filtrar por user específico (ej: para ver "qué hizo Nicolás hoy"). */
  userId?: string;
  /** Máximo items a mostrar. Default 10. */
  limit?: number;
  /** Compacto (sin border ni padding). Default false. */
  compact?: boolean;
  /** Título custom. Default "Actividad reciente". */
  title?: string;
  className?: string;
}

const ACTION_META: Record<
  string,
  { icon: typeof Edit2; color: string; bg: string; label: string }
> = {
  create: { icon: Plus, color: "text-positive", bg: "bg-positive/10", label: "Creó" },
  update: { icon: Edit2, color: "text-sf-blue", bg: "bg-sf-blue/10", label: "Editó" },
  delete: { icon: Trash2, color: "text-negative", bg: "bg-negative/10", label: "Eliminó" },
  approve: { icon: CheckCircle2, color: "text-positive", bg: "bg-positive/10", label: "Aprobó" },
  reject: { icon: XCircle, color: "text-negative", bg: "bg-negative/10", label: "Rechazó" },
  sync: { icon: RefreshCw, color: "text-warning", bg: "bg-warning/10", label: "Sincronizó" },
  upload: { icon: Upload, color: "text-cehta-green", bg: "bg-cehta-green/10", label: "Subió" },
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? {
    icon: Activity,
    color: "text-ink-500",
    bg: "bg-ink-100/60",
    label: action,
  };
}

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: es });
  } catch {
    return "";
  }
}

export function RecentActivityFeed({
  entityType,
  entityId,
  userId,
  limit = 10,
  compact = false,
  title = "Actividad reciente",
  className,
}: RecentActivityFeedProps) {
  const { session, loading } = useSession();

  // Build URL params
  const params = new URLSearchParams({ page: "1", size: String(limit) });
  if (entityType) params.set("entity_type", entityType);
  if (entityId) params.set("entity_id", entityId);
  if (userId) params.set("user_id", userId);

  const queryKey = ["audit", "recent", entityType, entityId, userId, String(limit)];

  const { data, isLoading, error, refetch, isRefetching } = useQuery<
    PageResp,
    Error
  >({
    queryKey,
    queryFn: () =>
      apiClient.get<PageResp>(`/audit/actions?${params.toString()}`, session),
    enabled: !loading && !!session,
    refetchInterval: 30_000, // auto-refresh cada 30s
    staleTime: 15_000,
    retry: 0,
  });

  const items = data?.items ?? [];

  const wrapperCls = compact
    ? cn("space-y-2", className)
    : undefined;

  const Container: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    compact ? (
      <div className={wrapperCls}>{children}</div>
    ) : (
      <Surface className={className}>
        <Surface.Header divider>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cehta-green/10 text-cehta-green">
                <Clock className="size-3.5" strokeWidth={1.75} />
              </span>
              <Surface.Title>{title}</Surface.Title>
            </div>
            {!isLoading && data && data.total > 0 && (
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isRefetching}
                className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/60 hover:text-cehta-green transition-colors"
                title="Refrescar"
              >
                <RefreshCw
                  className={cn(
                    "size-3.5",
                    isRefetching && "animate-spin",
                  )}
                  strokeWidth={1.5}
                />
              </button>
            )}
          </div>
        </Surface.Header>
        {children}
      </Surface>
    );

  return (
    <Container>
      {isLoading ? (
        <div className={compact ? "" : "mt-2 space-y-2"}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="mt-2 text-xs text-negative px-2 py-3">
          No se pudo cargar la bitácora: {error.message}
        </p>
      ) : items.length === 0 ? (
        <div className={cn("text-center", compact ? "py-6" : "py-10")}>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green mb-2">
            <Clock className="size-4" strokeWidth={1.5} />
          </span>
          <p className="text-sm font-medium text-ink-700">Sin actividad reciente</p>
          <p className="text-xs text-ink-500 mt-0.5">
            Cuando alguien cree, edite o borre algo, va a aparecer aquí.
          </p>
        </div>
      ) : (
        <ul className={compact ? "space-y-1" : "mt-2 space-y-0.5"}>
          {items.map((item, idx) => {
            const meta = getActionMeta(item.action);
            const Icon = meta.icon;
            return (
              <li
                key={item.log_id}
                className="group flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-ink-50/40 animate-slide-up-fade"
                style={{ animationDelay: `${Math.min(idx, 8) * 25}ms` }}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-hairline shrink-0",
                    meta.bg,
                  )}
                >
                  <Icon className={cn("size-3.5", meta.color)} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink-900">
                    <span className={cn("font-semibold", meta.color)}>
                      {meta.label}
                    </span>{" "}
                    {item.entity_label ? (
                      <span className="font-medium">{item.entity_label}</span>
                    ) : (
                      <span className="text-ink-700">{item.entity_type}</span>
                    )}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">
                      {item.summary}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3" strokeWidth={1.5} />
                      {item.user_email ?? "Sistema"}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums" title={item.created_at}>
                      {relTime(item.created_at)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
