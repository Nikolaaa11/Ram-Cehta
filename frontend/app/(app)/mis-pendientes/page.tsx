"use client";

/**
 * /mis-pendientes — V5++ ola AV + Round 1 polish + Round 75
 *
 * Página personal "bandeja de entrada" que muestra todo lo que requiere
 * acción del usuario actual:
 *   - Vouchers en DRAFT que él creó (debe completarlos y submit)
 *   - Vouchers PENDING en sus empresas que esperan SU firma (GG/DIRECTOR)
 *   - Vouchers APPROVED listos para pagar (Round 75 — antes faltaba)
 *   - Empresas a las que tiene acceso
 *
 * Es la primera página que un líder/director debe abrir al loguear.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  CheckCircle2,
  Download,
  FileEdit,
  PenTool,
  Building2,
  Inbox,
  ArrowRight,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PullToRefreshIndicator } from "@/components/shared/PullToRefreshIndicator";

interface Voucher {
  voucher_id: number;
  codigo: string;
  empresa_codigo: string;
  tipo: string;
  status: string;
  glosa: string;
  total_debit: number | string;
  contraparte_nombre: string | null;
  fecha_contable: string;
}

interface MyEmpresa {
  codigo: string;
  razon_social: string;
  roles: string[];
}

export default function MisPendientesPage() {
  const { session } = useSession();
  const { data: state } = useSidebarState();
  const [drafts, setDrafts] = useState<Voucher[]>([]);
  const [pending, setPending] = useState<Voucher[]>([]);
  // Round 75 — sumo APPROVED (listos para pagar) a la bandeja personal.
  // Faltaba esta categoría: el operador veía drafts+pending pero no los
  // APPROVED que ya esperan en /transferencias.
  const [approved, setApproved] = useState<Voucher[]>([]);
  const [empresas, setEmpresas] = useState<MyEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setLoadError(null);
    try {
      // Fetch en paralelo: drafts, pendientes, approved y empresas son indep.
      const [draftRes, pendingRes, approvedRes, empResp] = await Promise.all([
        apiClient.get<Voucher[]>(
          "/vouchers?status=DRAFT&limit=100",
          session,
        ),
        apiClient.get<Voucher[]>(
          "/vouchers?status=PENDING&limit=100",
          session,
        ),
        apiClient.get<Voucher[]>(
          "/vouchers?status=APPROVED&limit=100",
          session,
        ),
        apiClient.get<{ empresas: MyEmpresa[] }>(
          "/me/empresas",
          session,
        ),
      ]);
      setDrafts(draftRes);
      setPending(pendingRes);
      setApproved(approvedRes);
      setEmpresas(empResp.empresas || []);
    } catch (err) {
      // V5++ ola CJ + Round 1 polish — antes silenciado; ahora propagamos
      // como Error para que ErrorState extraiga detalle de ApiError y user
      // pueda reintentar via callback (no falso positivo "sin pendientes").
      setLoadError(
        err instanceof Error
          ? err
          : new Error("No pude cargar tus pendientes. Reintentá en unos segundos."),
      );
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    load();
  }, [session, load]);

  // Etapa C — pull-to-refresh en mobile. Gesto nativo iOS/Android para
  // refrescar la lista. En desktop el hook no engancha listeners.
  const pull = usePullToRefresh(async () => {
    await load();
  });

  const draftsCount = state?.voucher_drafts_mine ?? drafts.length;
  const pendingCount = state?.voucher_pending_approvals ?? pending.length;
  // Round 75 — counter de APPROVED listos para pagar (badge en sidebar también).
  const approvedReadyCount =
    state?.voucher_approved_ready_to_pay ?? approved.length;

  // V5++ ola AX: skeleton mientras carga
  if (loading && pending.length === 0 && drafts.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div>
          <div className="h-8 w-48 bg-ink-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-80 bg-ink-100 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Surface key={i} className="p-4">
              <div className="h-5 w-32 bg-ink-200 rounded animate-pulse mb-3" />
              <div className="h-9 w-16 bg-ink-200 rounded animate-pulse mb-2" />
              <div className="h-3 w-48 bg-ink-100 rounded animate-pulse" />
            </Surface>
          ))}
        </div>
        <Surface className="p-6">
          <div className="h-6 w-64 bg-ink-200 rounded animate-pulse mb-4" />
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex justify-between items-center p-3 mb-2 border-b border-ink-100"
            >
              <div className="space-y-2">
                <div className="h-4 w-40 bg-ink-200 rounded animate-pulse" />
                <div className="h-3 w-64 bg-ink-100 rounded animate-pulse" />
              </div>
              <div className="h-5 w-20 bg-ink-200 rounded animate-pulse" />
            </div>
          ))}
        </Surface>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <PullToRefreshIndicator
        pullDistance={pull.pullDistance}
        isRefreshing={pull.isRefreshing}
        isPulling={pull.isPulling}
      />
      {/* Round 97 — hero pattern unificado (grid + glow + gradient text) */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <Inbox className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Tu bandeja personal
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Mis pendientes
          </h1>
          <p className="text-sm md:text-base text-ink-500 mt-2">
            Todo lo que requiere tu acción ahora. Actualizado en vivo. Atajo:{" "}
            <kbd className="text-xs px-1.5 py-0.5 bg-ink-100 rounded font-mono">
              g p
            </kbd>
          </p>
        </div>
      </div>

      {/* KPI cards — Round 75: agrego "Listos para pagar" como 3ra card. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          icon={<FileEdit className="size-5 text-amber-500" />}
          label="Borradores propios"
          value={draftsCount}
          subtitle="Vouchers que vos creaste y debés completar"
          tone="warn"
        />
        <Card
          icon={<PenTool className="size-5 text-blue-500" />}
          label="Esperan tu firma"
          value={pendingCount}
          subtitle="Vouchers PENDING en empresas que aprobás"
          tone="info"
        />
        <Card
          icon={<Download className="size-5 text-cehta-green" />}
          label="Listos para pagar"
          value={approvedReadyCount}
          subtitle="APPROVED — descargá la planilla en Confirmar pagos"
          tone="success"
        />
        <Card
          icon={<Building2 className="size-5 text-ink-700" />}
          label="Tus empresas"
          value={empresas.length}
          subtitle="Empresas donde podés trabajar"
        />
      </div>

      {/* Vouchers PENDING (priority) */}
      {pending.length > 0 && (
        <Surface className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PenTool className="size-5 text-blue-500" />
              <h2 className="text-lg font-medium text-ink-900">
                Esperan tu firma ({pending.length})
              </h2>
            </div>
            <Link
              href={"/vouchers?status=PENDING" as Route}
              className="text-sm text-cehta-green hover:underline flex items-center gap-1"
            >
              Ver todos <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {pending.slice(0, 10).map((v) => (
              <VoucherRow key={v.voucher_id} v={v} />
            ))}
          </div>
        </Surface>
      )}

      {/* Vouchers DRAFT */}
      {drafts.length > 0 && (
        <Surface className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileEdit className="size-5 text-amber-500" />
              <h2 className="text-lg font-medium text-ink-900">
                Tus borradores ({drafts.length})
              </h2>
            </div>
            <Link
              href={"/vouchers?status=DRAFT" as Route}
              className="text-sm text-cehta-green hover:underline flex items-center gap-1"
            >
              Ver todos <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {drafts.slice(0, 10).map((v) => (
              <VoucherRow key={v.voucher_id} v={v} />
            ))}
          </div>
        </Surface>
      )}

      {/* Vouchers APPROVED listos para pagar — Round 75. */}
      {approved.length > 0 && (
        <Surface className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Download className="size-5 text-cehta-green" />
              <h2 className="text-lg font-medium text-ink-900">
                Listos para pagar ({approved.length})
              </h2>
            </div>
            <Link
              href={"/transferencias" as Route}
              className="text-sm text-cehta-green hover:underline flex items-center gap-1"
            >
              Descargar planilla <ArrowRight className="size-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {approved.slice(0, 10).map((v) => (
              <VoucherRow key={v.voucher_id} v={v} />
            ))}
          </div>
        </Surface>
      )}

      {/* Error state */}
      {loadError && !loading && (
        <ErrorState
          title="No se pudieron cargar tus pendientes"
          error={loadError}
          onRetry={() => load()}
        />
      )}

      {/* Empty state — Round 75: incluyo approved en el check. */}
      {!loadError &&
        pending.length === 0 &&
        drafts.length === 0 &&
        approved.length === 0 &&
        !loading && (
          <EmptyState
            icon={CheckCircle2}
            title="Sin pendientes"
            description="¡Estás al día! No tenés tareas pendientes ni pagos por confirmar."
            tone="positive"
          />
        )}

      {/* Mis empresas */}
      <Surface className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="size-5 text-cehta-green" />
          <h2 className="text-lg font-medium text-ink-900">
            Tus empresas ({empresas.length})
          </h2>
        </div>
        {empresas.length === 0 ? (
          <p className="text-sm text-ink-500">
            No tenés empresas asignadas. Contactá al admin.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {empresas.map((e) => (
              <Link
                key={e.codigo}
                href={`/vouchers?empresa_codigo=${e.codigo}` as Route}
                className="block rounded-lg border border-hairline p-3 hover:border-cehta-green/40 hover:bg-cehta-green/5 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs bg-ink-100 px-1.5 py-0.5 rounded">
                    {e.codigo}
                  </span>
                  {e.roles.map((r) => (
                    <span
                      key={r}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        r === "admin" || r === "DIRECTOR"
                          ? "bg-purple-100 text-purple-700"
                          : r === "GG"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-ink-100 text-ink-600"
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                </div>
                <div className="text-sm text-ink-900 font-medium truncate">
                  {e.razon_social}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  subtitle,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle: string;
  tone?: "neutral" | "warn" | "info" | "success";
}) {
  const colorClass =
    tone === "warn"
      ? "text-amber-500"
      : tone === "info"
        ? "text-blue-500"
        : tone === "success"
          ? "text-cehta-green"
          : "text-ink-900";
  return (
    <Surface className="p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium text-ink-700">
          {label}
        </span>
      </div>
      <div className={`text-3xl font-semibold mb-1 ${colorClass}`}>{value}</div>
      <div className="text-xs text-ink-500">{subtitle}</div>
    </Surface>
  );
}

function VoucherRow({ v }: { v: Voucher }) {
  const total =
    typeof v.total_debit === "string"
      ? parseFloat(v.total_debit)
      : v.total_debit;
  return (
    <Link
      href={`/vouchers/${v.voucher_id}` as Route}
      // Round 8 — prefetch eager. En mis-pendientes el user casi siempre
      // clickea alguna fila, vale la pena precargar el bundle.
      prefetch={true}
      className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-ink-50 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-xs bg-ink-100 px-1.5 py-0.5 rounded">
            {v.codigo}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cehta-green/10 text-cehta-green font-medium">
            {v.empresa_codigo}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
            {v.tipo}
          </span>
        </div>
        <div className="text-sm text-ink-900 truncate">
          {v.glosa}
        </div>
        <div className="text-xs text-ink-500">
          {v.contraparte_nombre && `${v.contraparte_nombre} · `}
          {v.fecha_contable}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-ink-900">
          ${total.toLocaleString("es-CL")}
        </div>
        <ArrowRight className="size-4 text-ink-400 group-hover:text-cehta-green ml-auto mt-1" />
      </div>
    </Link>
  );
}
