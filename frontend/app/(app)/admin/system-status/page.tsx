"use client";

/**
 * /admin/system-status — Round 93 — Health check operativo
 *
 * Vista única de "está todo OK?" para que el operador vea el estado
 * global sin abrir 5 pantallas distintas. Cubre:
 *   - Backend health
 *   - Vouchers por estado (DRAFT/PENDING/APPROVED/EXECUTED/VOID)
 *   - Subsidios activos
 *   - Proyectos configurados vs incompletos
 *   - Empresas con vouchers en flow CORFO
 *   - Acciones pendientes top 5
 */
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  PenTool,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ProyectoContable,
  SubsidioRead,
  SubsidioEjecucion,
} from "@/lib/api/schema";

const fmtCLP = (n: number) =>
  `$${Math.round(n).toLocaleString("es-CL")}`;

export default function SystemStatusPage() {
  const { session } = useSession();
  const { data: sidebar } = useSidebarState();

  const { data: subsidios } = useQuery<SubsidioRead[]>({
    queryKey: ["subsidios"],
    queryFn: () => apiClient.get<SubsidioRead[]>("/subsidios", session),
    enabled: !!session,
  });

  const { data: proyectos } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables-status"],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>("/proyectos-contables", session),
    enabled: !!session,
  });

  // Ejecución del subsidio activo (si existe)
  const subActivo = subsidios?.find((s) => s.estado === "ACTIVO");
  const { data: ej } = useQuery<SubsidioEjecucion>({
    queryKey: ["subsidio-ejecucion-status", subActivo?.subsidio_codigo],
    queryFn: () =>
      apiClient.get<SubsidioEjecucion>(
        `/subsidios/${subActivo?.subsidio_codigo}/ejecucion`,
        session,
      ),
    enabled: !!session && !!subActivo,
  });

  const proyectosCompletos = (proyectos ?? []).filter((p) => {
    const suma =
      Number(p.aporte_corfo_pct_default) +
      Number(p.aporte_ptec_pct_default) +
      Number(p.aporte_empresa_directa_pct_default);
    if (Math.abs(suma - 100) > 0.01) return false;
    if (Number(p.aporte_corfo_pct_default) > 0 && !p.cuenta_aporte_corfo)
      return false;
    if (Number(p.aporte_ptec_pct_default) > 0 && !p.cuenta_aporte_ptec_cehta)
      return false;
    if (
      Number(p.aporte_empresa_directa_pct_default) > 0 &&
      !p.cuenta_aporte_empresa_directa
    )
      return false;
    return true;
  });
  const proyectosIncompletos = (proyectos ?? []).filter(
    (p) => !proyectosCompletos.includes(p),
  );

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <Link
        href={"/admin/usuarios" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <div className="rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-blue-50/30 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
          <Activity className="size-3.5 text-cehta-green" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Admin · Estado del sistema
          </p>
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Health check operativo
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Vista global del estado actual: subsidios, proyectos, vouchers
          pendientes y configuración del Bloque E.
        </p>
      </div>

      {/* Top KPIs del operador (vía sidebar-state) */}
      <Section title="Mi bandeja personal" icon={<PenTool className="size-5 text-blue-500" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Stat
            label="Borradores propios"
            value={sidebar?.voucher_drafts_mine ?? 0}
            href="/vouchers?status=DRAFT"
            tone="warn"
          />
          <Stat
            label="Esperan mi firma"
            value={sidebar?.voucher_pending_approvals ?? 0}
            href="/aprobaciones"
            tone="info"
          />
          <Stat
            label="Listos para pagar"
            value={sidebar?.voucher_approved_ready_to_pay ?? 0}
            href="/transferencias"
            tone="success"
          />
          <Stat
            label="Inbox sin procesar"
            value={sidebar?.mailbox_pending ?? 0}
            href="/admin/mailbox"
          />
        </div>
      </Section>

      {/* Subsidios */}
      <Section
        title="Subsidios activos"
        icon={<CircleDollarSign className="size-5 text-cehta-green" />}
      >
        {!subsidios && <Skeleton className="h-20 w-full rounded-xl" />}
        {subsidios && subsidios.length === 0 && (
          <Surface className="p-6 text-center text-ink-500 text-sm">
            No hay subsidios cargados todavía.
          </Surface>
        )}
        {subsidios && subsidios.length > 0 && (
          <div className="space-y-3">
            {subsidios.map((s) => (
              <Link
                key={s.subsidio_codigo}
                href={`/admin/subsidios/${s.subsidio_codigo}` as Route}
              >
                <Surface className="p-4 hover:ring-cehta-green/30 hover:bg-cehta-green/[0.02] transition cursor-pointer">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                        {s.programa} · {s.entidad_otorgante}
                      </p>
                      <p className="font-semibold text-ink-900">{s.nombre}</p>
                      <p className="text-xs text-ink-500 font-mono">
                        {s.subsidio_codigo}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-display font-semibold text-ink-900 tabular-nums">
                        {fmtCLP(Number(s.monto_total))}
                      </p>
                      {ej && ej.subsidio_codigo === s.subsidio_codigo && (
                        <p className="text-xs text-cehta-green">
                          {ej.porcentaje_ejecutado.toFixed(1)}% ejecutado ·{" "}
                          {ej.coejecutores.length} coejecutor
                          {ej.coejecutores.length === 1 ? "" : "es"}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="size-4 text-ink-400" />
                  </div>
                </Surface>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {/* Proyectos */}
      <Section
        title="Proyectos contables"
        icon={<FileText className="size-5 text-cehta-green" />}
      >
        {!proyectos && <Skeleton className="h-20 w-full rounded-xl" />}
        {proyectos && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Stat
              label="Total proyectos"
              value={proyectos.length}
              href="/admin/proyectos"
            />
            <Stat
              label="Configuración completa"
              value={proyectosCompletos.length}
              tone="success"
              hint={
                proyectos.length > 0
                  ? `${Math.round((proyectosCompletos.length / proyectos.length) * 100)}% del total`
                  : ""
              }
            />
            <Stat
              label="Incompletos · revisar"
              value={proyectosIncompletos.length}
              tone={proyectosIncompletos.length > 0 ? "warn" : "default"}
              href="/admin/proyectos"
            />
          </div>
        )}
        {proyectosIncompletos.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="size-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-900">
                Proyectos con configuración Bloque E incompleta
              </p>
            </div>
            <ul className="text-[11px] text-amber-800 space-y-0.5 font-mono">
              {proyectosIncompletos.slice(0, 5).map((p) => (
                <li key={p.codigo}>
                  ·{" "}
                  <Link
                    href={`/admin/proyectos/${p.codigo}` as Route}
                    className="underline hover:no-underline"
                  >
                    {p.codigo}
                  </Link>{" "}
                  ({p.empresa_codigo})
                </li>
              ))}
              {proyectosIncompletos.length > 5 && (
                <li className="italic">
                  ... y {proyectosIncompletos.length - 5} más
                </li>
              )}
            </ul>
          </div>
        )}
      </Section>

      {/* Footer info */}
      <div className="text-center text-[10px] text-ink-400 mt-8">
        Backend: cehta-backend.fly.dev · Datos actualizados al cargar la página
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h2 className="text-xl font-semibold text-ink-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone = "default",
  hint,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: "default" | "warn" | "info" | "success";
  hint?: string;
}) {
  const colorClass =
    tone === "warn"
      ? "text-amber-500"
      : tone === "info"
        ? "text-blue-500"
        : tone === "success"
          ? "text-cehta-green"
          : "text-ink-900";
  const content = (
    <Surface className={`p-4 ${href ? "hover:ring-cehta-green/30 cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          {label}
        </p>
        {tone === "success" && value > 0 && (
          <CheckCircle2 className="size-3.5 text-cehta-green" />
        )}
      </div>
      <p className={`mt-1 text-3xl font-display font-semibold tabular-nums ${colorClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-ink-500">{hint}</p>}
    </Surface>
  );
  return href ? <Link href={href as Route}>{content}</Link> : content;
}
