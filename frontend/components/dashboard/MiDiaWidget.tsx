"use client";

/**
 * MiDiaWidget — V4 fase 7.7.
 *
 * Widget personal diario que vive arriba de todo en el dashboard. Resume
 * en 1 vista lo que el usuario tiene que hacer HOY:
 *   - Entregables vencidos / hoy / próximos 5 días
 *   - Notificaciones sin leer
 *   - Acceso rápido a las acciones más comunes (reporte, marcar todos)
 *
 * Filosofía: el dashboard ejecutivo muestra estado del Fondo. Este
 * widget muestra estado de TUS pendientes. Al inicio del día, mirás
 * acá y sabés qué priorizar.
 */
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Sparkles,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntregables, useCriticalCount } from "@/hooks/use-entregables";
import { useUnreadCount } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";

function formatFechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
  });
}

function saludoSegunHora(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function MiDiaWidget() {
  // Entregables próximos 7 días, sin entregados — para mostrar "lo de hoy"
  const today = new Date();
  const en7d = new Date(today);
  en7d.setDate(today.getDate() + 7);
  const todayISO = today.toISOString().slice(0, 10);
  const en7dISO = en7d.toISOString().slice(0, 10);

  const { data: entregables = [], isLoading: loadingEntregables } =
    useEntregables({ desde: todayISO, hasta: en7dISO });
  const { data: criticalCount, isLoading: loadingCritical } = useCriticalCount();
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.unread ?? 0;

  const isLoading = loadingEntregables || loadingCritical;

  // Filtrar: solo no entregados, ordenar por fecha
  const pendientes = entregables
    .filter((e) => e.estado !== "entregado" && e.estado !== "no_entregado")
    .sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite));

  const vencidos = pendientes.filter(
    (e) => e.nivel_alerta === "vencido",
  );
  const hoy = pendientes.filter((e) => e.nivel_alerta === "hoy");
  const proximos = pendientes
    .filter(
      (e) =>
        e.nivel_alerta !== "vencido" &&
        e.nivel_alerta !== "hoy",
    )
    .slice(0, 5);

  // Stats adicionales para el header
  const entregadosHoy = entregables.filter(
    (e) =>
      e.estado === "entregado" &&
      e.fecha_entrega_real?.startsWith(todayISO),
  ).length;
  const totalSemana = pendientes.filter((e) => {
    if (e.dias_restantes === null) return false;
    return e.dias_restantes >= 0 && e.dias_restantes <= 7;
  }).length;

  const totalAcciones =
    (criticalCount?.critical ?? 0) +
    (unreadCount > 0 ? 1 : 0);

  return (
    <Surface
      variant="glass"
      className={cn(
        "border print:hidden",
        totalAcciones > 0
          ? "border-cehta-green/30 ring-1 ring-cehta-green/20"
          : "border-positive/30 ring-1 ring-positive/20",
      )}
    >
      <Surface.Header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-xl",
                totalAcciones > 0
                  ? "bg-cehta-green/15 text-cehta-green"
                  : "bg-positive/15 text-positive",
              )}
            >
              <Sparkles className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>{saludoSegunHora()}</Surface.Title>
              <Surface.Subtitle>
                {totalAcciones === 0
                  ? "Todo al día — no tenés nada urgente que hacer ahora."
                  : `Tenés ${totalAcciones} cosa${totalAcciones !== 1 ? "s" : ""} que requieren atención.`}
              </Surface.Subtitle>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/entregables/reporte"
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
              Reporte CV
            </a>
            <a
              href="/entregables"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700"
            >
              Ver todos
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </a>
          </div>
        </div>

        {/* Mini-stats row */}
        {(entregadosHoy > 0 || totalSemana > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {entregadosHoy > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-2 py-0.5 font-medium text-positive">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                {entregadosHoy} entregado{entregadosHoy !== 1 ? "s" : ""} hoy
              </span>
            )}
            {totalSemana > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 font-medium text-info">
                <CalendarClock className="h-3 w-3" strokeWidth={2} />
                {totalSemana} en próximos 7 días
              </span>
            )}
            {pendientes.length > 0 && (
              <span className="text-ink-500">
                · Total pipeline: <strong>{pendientes.length}</strong>
              </span>
            )}
          </div>
        )}
      </Surface.Header>

      {isLoading ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : (
        <>
          {/* 3 buckets de status */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <BucketCard
              label="Vencidos"
              count={vencidos.length}
              icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
              tone={vencidos.length > 0 ? "negative" : "neutral"}
              hint="Requieren explicación en acta"
              href={vencidos.length > 0 ? "/entregables?estado=pendiente" : undefined}
            />
            <BucketCard
              label="Vencen hoy"
              count={hoy.length}
              icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
              tone={hoy.length > 0 ? "warning" : "neutral"}
              hint={hoy.length > 0 ? "Cierra el día con esto resuelto" : "Sin vencimientos hoy"}
              href={hoy.length > 0 ? "/entregables" : undefined}
            />
            <BucketCard
              label="Críticos ≤5d"
              count={criticalCount?.proximos_5d ?? 0}
              icon={<ClipboardCheck className="h-4 w-4" strokeWidth={1.75} />}
              tone={
                (criticalCount?.proximos_5d ?? 0) > 0 ? "info" : "neutral"
              }
              hint="Empezar a preparar ahora"
              href="/entregables"
            />
          </div>

          {/* Lista de hoy / vencidos */}
          {(vencidos.length > 0 || hoy.length > 0) && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Para resolver hoy
              </p>
              {[...vencidos, ...hoy].slice(0, 4).map((e) => (
                <a
                  key={e.entregable_id}
                  href={`/entregables`}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2 transition-colors hover:border-cehta-green/40 hover:bg-cehta-green/5"
                >
                  <span
                    className={cn(
                      "inline-flex h-7 w-12 shrink-0 flex-col items-center justify-center rounded-md text-[10px]",
                      e.nivel_alerta === "vencido"
                        ? "bg-negative/15 text-negative"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    <span className="font-bold">
                      {formatFechaCorta(e.fecha_limite)}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {e.nombre}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      {e.categoria} · {e.responsable} · {e.periodo}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-3.5 w-3.5 shrink-0 text-ink-400"
                    strokeWidth={1.75}
                  />
                </a>
              ))}
              {vencidos.length + hoy.length > 4 && (
                <a
                  href="/entregables"
                  className="block px-2 py-1 text-[11px] text-cehta-green hover:underline"
                >
                  Ver {vencidos.length + hoy.length - 4} más →
                </a>
              )}
            </div>
          )}

          {/* Pipeline corto si no hay urgencias */}
          {vencidos.length === 0 && hoy.length === 0 && proximos.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Próximos en pipeline (7 días)
              </p>
              {proximos.slice(0, 3).map((e) => (
                <div
                  key={e.entregable_id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2"
                >
                  <span className="inline-flex h-7 min-w-[3rem] items-center justify-center rounded-md bg-info/15 px-2 text-[10px] font-bold text-info">
                    {formatFechaCorta(e.fecha_limite)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {e.nombre}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      {e.categoria} · {e.dias_restantes}d
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notificaciones sin leer */}
          {unreadCount > 0 && (
            <a
              href="/notificaciones"
              className="mt-3 flex items-center gap-3 rounded-xl border border-info/30 bg-info/5 px-3 py-2 transition-colors hover:bg-info/10"
            >
              <Bell className="h-4 w-4 text-info" strokeWidth={1.75} />
              <span className="flex-1 text-sm text-ink-700">
                Tenés{" "}
                <strong className="text-info">
                  {unreadCount} notificacion{unreadCount !== 1 ? "es" : ""} sin
                  leer
                </strong>
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 text-info"
                strokeWidth={1.75}
              />
            </a>
          )}

          {/* Estado vacío feliz */}
          {totalAcciones === 0 &&
            vencidos.length === 0 &&
            hoy.length === 0 &&
            proximos.length === 0 && (
              <div className="mt-4 rounded-xl border border-positive/20 bg-positive/5 p-4 text-center">
                <CheckCircle2
                  className="mx-auto mb-2 h-8 w-8 text-positive"
                  strokeWidth={1.5}
                />
                <p className="text-sm font-semibold text-positive">
                  ¡Todo bajo control!
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Sin pendientes urgentes ni notificaciones nuevas.
                </p>
              </div>
            )}
        </>
      )}
    </Surface>
  );
}

function BucketCard({
  label,
  count,
  icon,
  tone,
  hint,
  href,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  tone: "negative" | "warning" | "info" | "neutral";
  hint: string;
  href?: string;
}) {
  const toneClass =
    tone === "negative"
      ? "border-negative/30 bg-negative/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5"
        : tone === "info"
          ? "border-info/30 bg-info/5"
          : "border-hairline bg-white";

  const accentText =
    tone === "negative"
      ? "text-negative"
      : tone === "warning"
        ? "text-warning"
        : tone === "info"
          ? "text-info"
          : "text-ink-500";

  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 text-3xl font-bold tabular-nums", accentText)}>
        {count}
      </p>
      <p className="text-[11px] text-ink-500">{hint}</p>
    </>
  );

  if (href && count > 0) {
    return (
      <a
        href={href}
        className={cn(
          "block rounded-2xl border p-4 transition-colors hover:scale-[1.01] hover:shadow-sm",
          toneClass,
        )}
      >
        {inner}
      </a>
    );
  }

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>{inner}</div>
  );
}
