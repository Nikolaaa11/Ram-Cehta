"use client";

/**
 * /sii — Dashboard hub central del SII (R152rr).
 *
 * Una sola pantalla para responder las 3 preguntas operativas críticas:
 *   1. ¿Mis 9 empresas tienen credenciales SII válidas?
 *   2. ¿Cuándo fue el último sync exitoso de cada una?
 *   3. ¿Qué necesito hacer ahora?
 *
 * Llama a GET /sii/empresas que ya existe (R117). Cada fila tiene
 * shortcuts a las acciones operativas: sync RCV, conciliar, F29 preview.
 */
import Link from "next/link";
import type { Route } from "next";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark,
  RefreshCw,
  FileCheck,
  Receipt,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  KeyRound,
  Building2,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
// R152uu — Lazy DonutKPI (recharts ~80kB). AnimatedNumber sigue eager.
import { AnimatedNumber, LazyDonutKPI as DonutKPI } from "@/components/charts/lazy";

interface EmpresaSiiStatus {
  empresa_codigo: string;
  razon_social: string;
  rut: string;
  tiene_credencial_sii: boolean;
  ultima_validacion_at: string | null;
  ultima_validacion_ok: boolean | null;
  ultimo_sync_at: string | null;
  ultimo_sync_status: string | null;
  documentos_count: number;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  try {
    const ms = Date.now() - new Date(iso).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function syncFreshness(iso: string | null): {
  label: string;
  color: string;
  bg: string;
} {
  const d = daysSince(iso);
  if (d === null) return { label: "Nunca", color: "text-ink-500", bg: "bg-ink-100" };
  if (d <= 1) return { label: "Hoy", color: "text-emerald-700", bg: "bg-emerald-50" };
  if (d <= 7)
    return { label: `${d}d`, color: "text-emerald-700", bg: "bg-emerald-50" };
  if (d <= 30)
    return { label: `${d}d`, color: "text-amber-700", bg: "bg-amber-50" };
  return { label: `${d}d`, color: "text-red-700", bg: "bg-red-50" };
}

export default function SiiDashboardPage() {
  const { session } = useSession();
  const { data, isLoading, error } = useQuery<EmpresaSiiStatus[]>({
    queryKey: ["sii", "empresas"],
    // R152tt — fix endpoint path: router registrado con prefix /admin/sii
    // en backend/app/api/v1/__init__.py línea 129, NO /sii.
    queryFn: () =>
      apiClient.get<EmpresaSiiStatus[]>("/admin/sii/empresas", session),
    enabled: !!session,
    // R152ww — sync SII es manual (no cambia minuto a minuto). 2 min default.
    staleTime: 2 * 60_000,
  });

  const stats = useMemo(() => {
    const rows = data ?? [];
    const total = rows.length;
    const conCred = rows.filter((r) => r.tiene_credencial_sii).length;
    const credValidas = rows.filter(
      (r) => r.tiene_credencial_sii && r.ultima_validacion_ok === true,
    ).length;
    const syncOk = rows.filter(
      (r) => r.ultimo_sync_status === "ok" || r.ultimo_sync_status === "success",
    ).length;
    const syncFallido = rows.filter(
      (r) =>
        r.ultimo_sync_status &&
        !["ok", "success", "running", "pending"].includes(r.ultimo_sync_status),
    ).length;
    const syncFreshlist = rows.filter(
      (r) => (daysSince(r.ultimo_sync_at) ?? 999) <= 7,
    ).length;
    const totalDocs = rows.reduce((s, r) => s + r.documentos_count, 0);
    return {
      total,
      conCred,
      credValidas,
      syncOk,
      syncFallido,
      syncFreshlist,
      totalDocs,
    };
  }, [data]);

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
          <p className="font-semibold">No se pudo cargar el dashboard SII.</p>
          <p className="mt-1 text-xs">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
          <p className="mt-2 text-xs">
            Verificá que tu rol sea admin. El endpoint{" "}
            <code>/api/v1/sii/empresas</code> requiere admin scope.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-50/60 via-white to-emerald-50/40 ring-1 ring-blue-200/40 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-blue-200/20 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 ring-1 ring-blue-200">
              <Landmark
                className="size-3.5 text-blue-700"
                strokeWidth={2}
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-800">
                SII Chile · Tributario
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
              Dashboard SII · 9 empresas
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-600">
              Una sola vista del status tributario de las empresas. Credenciales
              validadas, fecha del último sync de RCV, DTEs descargados, y
              accesos rápidos a las acciones operativas.
            </p>
          </div>
        </div>
      </div>

      {/* Stats principales con donuts */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <DonutKPI
              value={stats.credValidas}
              total={Math.max(stats.total, 1)}
              label="Cred OK"
              color="#3B82F6"
              size={100}
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Credenciales validadas
              </p>
              <p className="mt-1 font-display text-xl font-semibold text-ink-900">
                <AnimatedNumber value={stats.credValidas} format="int" />
                <span className="text-sm text-ink-500"> / {stats.total}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <DonutKPI
              value={stats.syncFreshlist}
              total={Math.max(stats.total, 1)}
              label="Sync ≤7d"
              color="#10B981"
              size={100}
            />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Sync reciente
              </p>
              <p className="mt-1 font-display text-xl font-semibold text-ink-900">
                <AnimatedNumber value={stats.syncFreshlist} format="int" />
                <span className="text-sm text-ink-500"> / {stats.total}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            <Receipt className="size-3.5" />
            DTEs descargados
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber value={stats.totalDocs} format="int" />
          </p>
          <p className="mt-1 text-[10px] text-ink-500">Total Compras + Ventas</p>
        </div>
        <div
          className={`rounded-2xl border p-4 shadow-card ${
            stats.syncFallido > 0
              ? "border-red-200 bg-red-50/40"
              : "border-emerald-200 bg-emerald-50/40"
          }`}
        >
          <p
            className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${
              stats.syncFallido > 0 ? "text-red-700" : "text-emerald-700"
            }`}
          >
            {stats.syncFallido > 0 ? (
              <AlertTriangle className="size-3.5" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {stats.syncFallido > 0 ? "Sync fallidos" : "Sin errores"}
          </p>
          <p
            className={`mt-2 font-display text-3xl font-semibold ${
              stats.syncFallido > 0 ? "text-red-900" : "text-emerald-900"
            }`}
          >
            <AnimatedNumber
              value={stats.syncFallido > 0 ? stats.syncFallido : stats.syncOk}
              format="int"
            />
          </p>
          <p className="mt-1 text-[10px] text-ink-500">
            {stats.syncFallido > 0 ? "Revisar logs" : "Última corrida"}
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <QuickAction
          href={"/admin/sii" as Route}
          icon={RefreshCw}
          title="Sincronizar RCV"
          desc="Disparar pull del SII"
          tone="blue"
        />
        <QuickAction
          href={"/admin/sii?tab=conciliar" as Route}
          icon={FileCheck}
          title="Conciliar DTE"
          desc="Match con vouchers"
          tone="emerald"
        />
        <QuickAction
          href={"/f29" as Route}
          icon={Receipt}
          title="F29 Mensual"
          desc="Declaración IVA"
          tone="amber"
        />
        <QuickAction
          href={"/f22" as Route}
          icon={Receipt}
          title="F22 Anual"
          desc="Declaración Renta"
          tone="purple"
        />
      </div>

      {/* Tabla por empresa */}
      <section className="mt-8 rounded-2xl border border-hairline bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink-900">
              Status por empresa
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Click sobre una empresa para abrir su detalle SII.
            </p>
          </div>
          <Link
            href={"/admin/sii" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            Vista admin completa
            <ArrowRight className="size-3" />
          </Link>
        </header>

        {isLoading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-ink-100/40"
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Empresa</th>
                  <th className="px-4 py-3 text-left font-semibold">RUT</th>
                  <th className="px-4 py-3 text-center font-semibold">
                    Credenciales
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">
                    Última validación
                  </th>
                  <th className="px-4 py-3 text-center font-semibold">
                    Último sync
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">DTEs</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {(data ?? []).map((r) => {
                  const fresh = syncFreshness(r.ultimo_sync_at);
                  return (
                    <tr
                      key={r.empresa_codigo}
                      className="hover:bg-ink-50/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-ink-400" />
                          <Link
                            href={`/empresa/${r.empresa_codigo}` as Route}
                            className="font-semibold text-ink-900 hover:text-cehta-green hover:underline"
                          >
                            {r.empresa_codigo}
                          </Link>
                        </div>
                        <p className="ml-6 truncate text-[10px] text-ink-500" style={{ maxWidth: 220 }}>
                          {r.razon_social}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-700">
                        {r.rut}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.tiene_credencial_sii ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                            title="Credenciales cifradas en el sistema"
                          >
                            <KeyRound className="size-3" />
                            Cargadas
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle className="size-3" />
                            Faltan
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-xs">
                        {r.ultima_validacion_at ? (
                          r.ultima_validacion_ok ? (
                            <span
                              className="inline-flex items-center gap-1 text-emerald-700"
                              title={fmtDateTime(r.ultima_validacion_at)}
                            >
                              <ShieldCheck className="size-3" />
                              OK
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-red-700"
                              title={fmtDateTime(r.ultima_validacion_at)}
                            >
                              <AlertTriangle className="size-3" />
                              Falla
                            </span>
                          )
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fresh.bg} ${fresh.color}`}
                          title={fmtDateTime(r.ultimo_sync_at)}
                        >
                          <Clock className="size-3" />
                          {fresh.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                        <AnimatedNumber
                          value={r.documentos_count}
                          format="int"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={
                            `/admin/sii?empresa=${r.empresa_codigo}` as Route
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-cehta-green hover:underline"
                        >
                          Ver detalle
                          <ArrowRight className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Explicación de cada función SII (educativa, basada en el backend real) */}
      <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-sm">
        <p className="font-semibold text-blue-900">
          🎓 Qué hace cada herramienta del módulo SII
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-3 text-xs text-blue-900 md:grid-cols-2">
          <li>
            <strong>Sincronizar RCV</strong>: corre el robot que se loguea a
            sii.cl con las credenciales cifradas y descarga el Registro de
            Compras y Ventas del período. Crea filas en{" "}
            <code>sii_documentos</code>.
          </li>
          <li>
            <strong>Conciliar DTE</strong>: cruza cada DTE descargado vs los
            vouchers locales. Match exacto por (RUT + folio + tipo). Marca
            inconsistencias y permite crear voucher desde DTE no conciliado.
          </li>
          <li>
            <strong>F29 / IVA Mensual</strong>: declaración del Impuesto al
            Valor Agregado del mes. Calcula débito (ventas) − crédito (compras)
            + PPM. Vence día 12 del mes siguiente.
          </li>
          <li>
            <strong>F22 / Renta Anual</strong>: declaración del impuesto a la
            renta del ejercicio. Vence 30 de abril. Solicita base imponible,
            créditos, retenciones y PPM pagado.
          </li>
        </ul>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
  tone,
}: {
  href: Route;
  icon: typeof RefreshCw;
  title: string;
  desc: string;
  tone: "blue" | "emerald" | "amber" | "purple";
}) {
  const toneCfg: Record<
    typeof tone,
    { ring: string; bg: string; icoBg: string; icoColor: string }
  > = {
    blue: {
      ring: "ring-blue-200/40 hover:ring-blue-400",
      bg: "from-blue-50/40 to-white",
      icoBg: "bg-blue-100",
      icoColor: "text-blue-700",
    },
    emerald: {
      ring: "ring-emerald-200/40 hover:ring-emerald-400",
      bg: "from-emerald-50/40 to-white",
      icoBg: "bg-emerald-100",
      icoColor: "text-emerald-700",
    },
    amber: {
      ring: "ring-amber-200/40 hover:ring-amber-400",
      bg: "from-amber-50/40 to-white",
      icoBg: "bg-amber-100",
      icoColor: "text-amber-700",
    },
    purple: {
      ring: "ring-purple-200/40 hover:ring-purple-400",
      bg: "from-purple-50/40 to-white",
      icoBg: "bg-purple-100",
      icoColor: "text-purple-700",
    },
  };
  const cfg = toneCfg[tone];
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-2xl bg-gradient-to-br p-4 shadow-card ring-1 transition-all hover:-translate-y-0.5 hover:shadow-elevated-lg ${cfg.bg} ${cfg.ring}`}
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${cfg.icoBg} ${cfg.icoColor}`}
      >
        <Icon className="size-5" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="text-[11px] text-ink-500">{desc}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-600" />
    </Link>
  );
}
