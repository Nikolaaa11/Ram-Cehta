/**
 * Admin landing.
 *
 * Server component — fetcheamos KPIs en paralelo para los 3 cards. Si el
 * endpoint falla (404 mientras backend en construcción, RLS, etc.), mostramos
 * "—" en el card en vez de bloquear toda la página.
 */
import type { Route } from "next";
import { Database, Shield, UserCog } from "lucide-react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { AdminCard } from "@/components/admin/AdminCard";
import type { Page } from "@/lib/api/schema";
import {
  ADMIN_ENDPOINTS,
  type DataQualityReport,
  type EtlRunRead,
  type UserRoleRead,
} from "@/lib/admin/queries";

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

function isWithinLast24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

export default async function AdminLandingPage() {
  const [etlRunsResp, dq, users] = await Promise.all([
    safeGet<Page<EtlRunRead>>(
      ADMIN_ENDPOINTS.etlRuns({ page: 1, size: 50 }),
    ),
    safeGet<DataQualityReport>(ADMIN_ENDPOINTS.dataQuality()),
    safeGet<UserRoleRead[]>(ADMIN_ENDPOINTS.users()),
  ]);

  const recentRuns = (etlRunsResp?.items ?? []).filter((r) =>
    isWithinLast24h(r.started_at),
  );
  const failedRecent = recentRuns.filter((r) => r.status === "failed").length;

  const issuesCount = dq?.issues?.length ?? null;
  const highSeverity = (dq?.issues ?? []).filter(
    (i) => i.severity === "high",
  ).length;

  const usersCount = users?.length ?? null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          Panel Admin
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Auditoría ETL, calidad de datos y administración de roles.
        </p>
      </div>

      {/* Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <AdminCard
          href={"/admin/etl" as Route}
          title="ETL Runs"
          description="Histórico de cargas, filas rechazadas y trazabilidad por archivo origen."
          icon={Database}
          metric={
            etlRunsResp === null ? "—" : recentRuns.length.toString()
          }
          metricLabel={
            etlRunsResp === null
              ? "endpoint no disponible"
              : `runs · 24h${failedRecent > 0 ? ` · ${failedRecent} fallidos` : ""}`
          }
          tone={failedRecent > 0 ? "danger" : "default"}
        />
        <AdminCard
          href={"/admin/data-quality" as Route}
          title="Data Quality"
          description="Issues abiertas: OCs sin pago, F29 vencidas, saldos faltantes."
          icon={Shield}
          metric={issuesCount === null ? "—" : issuesCount.toString()}
          metricLabel={
            issuesCount === null
              ? "endpoint no disponible"
              : `issues${highSeverity > 0 ? ` · ${highSeverity} críticas` : ""}`
          }
          tone={highSeverity > 0 ? "warning" : "default"}
        />
        <AdminCard
          href={"/admin/usuarios" as Route}
          title="Usuarios"
          description="Asignar roles (admin / finance / viewer) y revocar accesos."
          icon={UserCog}
          metric={usersCount === null ? "—" : usersCount.toString()}
          metricLabel={
            usersCount === null
              ? "endpoint no disponible"
              : `usuario${usersCount === 1 ? "" : "s"} con rol`
          }
        />
      </div>

      {/* Aviso cuando el backend admin no está listo */}
      {etlRunsResp === null && dq === null && users === null && (
        <Surface variant="glass" className="bg-warning/5 ring-warning/20">
          <p className="text-sm font-medium text-warning">
            Endpoints admin aún no disponibles
          </p>
          <p className="mt-1 text-xs text-ink-500">
            El backend está deployando los endpoints `/audit/*` y `/admin/users`.
            Esta UI se actualizará automáticamente una vez expuestos.
          </p>
        </Surface>
      )}
    </div>
  );
}
