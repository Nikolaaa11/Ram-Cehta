"use client";

/**
 * /mis-pendientes — V5++ ola AV
 *
 * Página personal "bandeja de entrada" que muestra todo lo que requiere
 * acción del usuario actual:
 *   - Vouchers en DRAFT que él creó (debe completarlos y submit)
 *   - Vouchers PENDING en sus empresas que esperan SU firma (GG/DIRECTOR)
 *   - Empresas a las que tiene acceso
 *
 * Es la primera página que un líder/director debe abrir al loguear.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertCircle,
  CheckCircle2,
  FileEdit,
  PenTool,
  Building2,
  Inbox,
  ArrowRight,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { Surface } from "@/components/ui/surface";

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
  const [empresas, setEmpresas] = useState<MyEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const load = async () => {
      try {
        // Drafts propios (status=DRAFT created by me)
        const draftRes = await apiClient.get<Voucher[]>(
          "/vouchers?status=DRAFT&limit=100",
          session,
        );
        setDrafts(draftRes);

        // Pendientes de aprobación (status=PENDING en mis empresas)
        const pendingRes = await apiClient.get<Voucher[]>(
          "/vouchers?status=PENDING&limit=100",
          session,
        );
        setPending(pendingRes);

        // Mis empresas
        const empResp = await apiClient.get<{ empresas: MyEmpresa[] }>(
          "/me/empresas",
          session,
        );
        setEmpresas(empResp.empresas || []);
      } catch (err) {
        // V5++ ola CJ — antes silenciado; ahora propagamos para que el
        // user vea el error y pueda reintentar (no quede "sin pendientes"
        // como falso positivo cuando hay un 401/500).
        const message =
          err instanceof ApiError
            ? err.detail
            : err instanceof Error
              ? err.message
              : "No pude cargar tus pendientes. Reintentá en unos segundos.";
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [session]);

  const draftsCount = state?.voucher_drafts_mine ?? drafts.length;
  const pendingCount = state?.voucher_pending_approvals ?? pending.length;

  // V5++ ola CJ — manejo de error explícito (antes se silenciaba).
  if (loadError && !loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Surface className="p-8 bg-negative/5 border border-negative/20 text-center">
          <AlertCircle className="mx-auto size-12 text-negative" />
          <h2 className="mt-3 text-lg font-semibold text-ink-900">
            No pude cargar tus pendientes
          </h2>
          <p className="mt-2 text-sm text-ink-600">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700"
          >
            Reintentar
          </button>
        </Surface>
      </div>
    );
  }

  // V5++ ola AX: skeleton mientras carga
  if (loading && pending.length === 0 && drafts.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div>
          <div className="h-8 w-48 bg-ink-200 dark:bg-ink-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-80 bg-ink-100 dark:bg-ink-900 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Surface key={i} className="p-4">
              <div className="h-5 w-32 bg-ink-200 dark:bg-ink-800 rounded animate-pulse mb-3" />
              <div className="h-9 w-16 bg-ink-200 dark:bg-ink-800 rounded animate-pulse mb-2" />
              <div className="h-3 w-48 bg-ink-100 dark:bg-ink-900 rounded animate-pulse" />
            </Surface>
          ))}
        </div>
        <Surface className="p-6">
          <div className="h-6 w-64 bg-ink-200 dark:bg-ink-800 rounded animate-pulse mb-4" />
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex justify-between items-center p-3 mb-2 border-b border-ink-100 dark:border-ink-800"
            >
              <div className="space-y-2">
                <div className="h-4 w-40 bg-ink-200 dark:bg-ink-800 rounded animate-pulse" />
                <div className="h-3 w-64 bg-ink-100 dark:bg-ink-900 rounded animate-pulse" />
              </div>
              <div className="h-5 w-20 bg-ink-200 dark:bg-ink-800 rounded animate-pulse" />
            </div>
          ))}
        </Surface>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-blue-50/30 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cehta-green/15 blur-3xl"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
            <Inbox className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Tu bandeja personal
            </p>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Mis pendientes
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Todo lo que requiere tu acción ahora. Actualizado en vivo.
            Atajo: <kbd className="text-xs px-1.5 py-0.5 bg-ink-100 rounded font-mono">g p</kbd>
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          icon={<Building2 className="size-5 text-cehta-green" />}
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
              <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
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
              <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
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

      {/* Empty state */}
      {pending.length === 0 && drafts.length === 0 && !loading && (
        <Surface className="p-12 text-center">
          <CheckCircle2 className="size-12 text-cehta-green mx-auto mb-3" />
          <h3 className="text-lg font-medium text-ink-900 dark:text-ink-100 mb-1">
            ¡Todo al día!
          </h3>
          <p className="text-sm text-ink-500">
            No tenés borradores pendientes ni vouchers esperando tu firma.
          </p>
        </Surface>
      )}

      {/* Mis empresas */}
      <Surface className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="size-5 text-cehta-green" />
          <h2 className="text-lg font-medium text-ink-900 dark:text-ink-100">
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
                className="block rounded-lg border border-hairline p-3 hover:border-cehta-green/40 hover:bg-cehta-green/5 transition-colors dark:bg-ink-900"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded">
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
                <div className="text-sm text-ink-900 dark:text-ink-100 font-medium truncate">
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
  tone?: "neutral" | "warn" | "info";
}) {
  const colorClass =
    tone === "warn"
      ? "text-amber-500"
      : tone === "info"
        ? "text-blue-500"
        : "text-ink-900 dark:text-ink-100";
  return (
    <Surface className="p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium text-ink-700 dark:text-ink-300">
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
      className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-ink-50 dark:hover:bg-ink-900/40 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-xs bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded">
            {v.codigo}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cehta-green/10 text-cehta-green font-medium">
            {v.empresa_codigo}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
            {v.tipo}
          </span>
        </div>
        <div className="text-sm text-ink-900 dark:text-ink-100 truncate">
          {v.glosa}
        </div>
        <div className="text-xs text-ink-500">
          {v.contraparte_nombre && `${v.contraparte_nombre} · `}
          {v.fecha_contable}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-ink-900 dark:text-ink-100">
          ${total.toLocaleString("es-CL")}
        </div>
        <ArrowRight className="size-4 text-ink-400 group-hover:text-cehta-green ml-auto mt-1" />
      </div>
    </Link>
  );
}
