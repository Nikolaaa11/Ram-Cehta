"use client";

/**
 * /claudia — Home / Dashboard de Claudia, coordinadora del subsidio
 * CORFO 2024-265638 (REVTECH + TRONGKAI co-ejecutores · $3.000MM).
 *
 * Pantalla pensada como la primera que abre cada mañana:
 *   - Hero con saludo + estado del subsidio
 *   - 4 acciones rápidas grandes (crear voucher, rendir, indexar, sugerencias)
 *   - Status del mes: vouchers creados, monto, mapeo
 *   - Guía rápida del flujo CORFO (5 pasos)
 *   - Botón "Sugerencia" siempre visible
 */
import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleDollarSign,
  Receipt,
  FileSpreadsheet,
  FileCheck,
  Sparkles,
  Upload,
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  PlayCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { AnimatedNumber, LazyDonutKPI as DonutKPI } from "@/components/charts/lazy";

interface SubsidioEjecucion {
  subsidio_codigo: string;
  monto_total: number;
  presupuesto_total: number;
  ejecutado_total: number;
  disponible_total: number;
  pct_ejecucion: number;
  empresas: Array<{
    empresa_codigo: string;
    presupuesto: number;
    ejecutado: number;
  }>;
}

function currentPeriodo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CLAUDIA_FLUJO_STEPS = [
  {
    n: 1,
    title: "Crear voucher CORFO",
    desc: "Por cada gasto del subsidio, crea un voucher en el form especializado. El sistema reparte automáticamente entre CORFO / P-tec / Empresa.",
    icon: Receipt,
    href: "/vouchers/corfo" as Route,
  },
  {
    n: 2,
    title: "Subir respaldo a Dropbox",
    desc: "Cada voucher necesita su respaldo (factura/boleta/contrato). Los archivos van directo a Dropbox cifrado.",
    icon: Upload,
    href: "/vouchers/corfo" as Route,
  },
  {
    n: 3,
    title: "Mapear cuentas locales a CORFO",
    desc: "Una vez al mes (o cuando aparezcan cuentas nuevas), revisar el mapeo cuenta local → cuenta CORFO oficial.",
    icon: FileCheck,
    href: "/admin/rendiciones-corfo/mapping" as Route,
  },
  {
    n: 4,
    title: "Generar rendición mensual",
    desc: "Descargar los 2 Excel oficiales del folio 2024-265638 (Gastos + RRHH) ya pre-llenados con los datos del mes.",
    icon: FileSpreadsheet,
    href: "/admin/rendiciones-corfo" as Route,
  },
  {
    n: 5,
    title: "Consultar al asistente IA",
    desc: "Si surge alguna duda sobre la base de conocimiento (vouchers, contratos, hitos), pregunta al asistente de cada empresa.",
    icon: Sparkles,
    href: "/empresa/REVTECH/asistente" as Route,
  },
];

export default function ClaudiaHomePage() {
  const { session } = useSession();
  const { data: me } = useMe();
  const [periodo] = useState(currentPeriodo());

  // R152ooo — fix path: endpoint real es /ejecucion, no /status
  const subsidio = useQuery<SubsidioEjecucion>({
    queryKey: ["subsidio", "CORFO-2026-REVTECH-TRONGKAI", "ejecucion"],
    queryFn: () =>
      apiClient.get<SubsidioEjecucion>(
        "/subsidios/CORFO-2026-REVTECH-TRONGKAI/ejecucion",
        session,
      ),
    enabled: !!session,
    staleTime: 5 * 60_000,
    retry: false, // si el subsidio no existe en DB, no reintentar
  });

  // Preview de vouchers del mes para REVTECH + TRONGKAI
  const previewRevtech = useQuery({
    queryKey: ["corfo", "preview", "REVTECH", periodo],
    queryFn: () =>
      apiClient.get<{
        rows: unknown[];
        total_neto: number;
        sin_mapeo: number;
      }>(
        `/admin/corfo/rendicion/preview?empresa=REVTECH&periodo=${periodo}`,
        session,
      ),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const previewTrongkai = useQuery({
    queryKey: ["corfo", "preview", "TRONGKAI", periodo],
    queryFn: () =>
      apiClient.get<{
        rows: unknown[];
        total_neto: number;
        sin_mapeo: number;
      }>(
        `/admin/corfo/rendicion/preview?empresa=TRONGKAI&periodo=${periodo}`,
        session,
      ),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const totalDocs =
    (previewRevtech.data?.rows.length ?? 0) +
    (previewTrongkai.data?.rows.length ?? 0);
  const totalNeto =
    (previewRevtech.data?.total_neto ?? 0) +
    (previewTrongkai.data?.total_neto ?? 0);
  const sinMapeo =
    (previewRevtech.data?.sin_mapeo ?? 0) +
    (previewTrongkai.data?.sin_mapeo ?? 0);
  const conMapeo = Math.max(0, totalDocs - sinMapeo);
  const pctMapeado = totalDocs > 0 ? Math.round((conMapeo / totalDocs) * 100) : 100;

  // Saludo según hora del día
  const hour = new Date().getHours();
  const saludo =
    hour < 6
      ? "Buenas noches"
      : hour < 12
      ? "Buenos días"
      : hour < 19
      ? "Buenas tardes"
      : "Buenas noches";

  const firstName = (me?.email ?? "")
    .split("@")[0]
    ?.split(".")[0]
    ?.replace(/^./, (c) => c.toUpperCase()) ?? "Claudia";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      {/* Header hero */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50/70 via-white to-emerald-50/40 ring-1 ring-amber-200/50 p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-200/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-12 -bottom-12 size-44 rounded-full bg-emerald-200/30 blur-3xl"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 ring-1 ring-amber-200">
            <CircleDollarSign className="size-3.5 text-amber-700" strokeWidth={2} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">
              Subsidio CORFO 2024-265638
            </span>
          </div>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">
            {saludo}, {firstName}
          </h1>
          <p className="mt-2 max-w-2xl text-base text-ink-600">
            Este es tu workspace para coordinar la ejecución del subsidio CORFO
            entre <strong>REVTECH</strong> y <strong>TRONGKAI</strong>. Acá
            tienes las acciones del día, el estado del mes, y la guía del flujo
            completo.
          </p>
        </div>
      </header>

      {/* 4 acciones rápidas */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink-500">
          Acciones rápidas
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <QuickAction
            href={"/vouchers/corfo" as Route}
            icon={Receipt}
            title="Crear voucher CORFO"
            desc="Por cada gasto del subsidio"
            tone="emerald"
          />
          <QuickAction
            href={"/admin/rendiciones-corfo" as Route}
            icon={FileSpreadsheet}
            title="Generar rendición"
            desc="Excel oficial del mes"
            tone="amber"
          />
          <QuickAction
            href={"/admin/rendiciones-corfo/mapping" as Route}
            icon={FileCheck}
            title="Mapear cuentas"
            desc="Local → CORFO oficial"
            tone="blue"
          />
          <QuickAction
            href={"/sugerencias" as Route}
            icon={MessageSquare}
            title="Enviar sugerencia"
            desc="Algo que mejorar"
            tone="purple"
          />
        </div>
      </section>

      {/* Status del mes */}
      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-ink-500">
          Status del mes (REVTECH + TRONGKAI)
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Documentos del mes
            </p>
            <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
              <AnimatedNumber value={totalDocs} format="int" />
            </p>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Monto neto
            </p>
            <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
              <AnimatedNumber value={totalNeto} format="clp" />
            </p>
          </div>
          <div
            className={`rounded-2xl border p-5 shadow-card ${
              sinMapeo > 0
                ? "border-amber-200 bg-amber-50/40"
                : "border-emerald-200 bg-emerald-50/40"
            }`}
          >
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
              {sinMapeo > 0 ? (
                <AlertTriangle className="size-3.5 text-amber-700" />
              ) : (
                <CheckCircle2 className="size-3.5 text-emerald-700" />
              )}
              <span
                className={sinMapeo > 0 ? "text-amber-800" : "text-emerald-800"}
              >
                Sin mapeo
              </span>
            </p>
            <p
              className={`mt-2 font-display text-3xl font-semibold ${
                sinMapeo > 0 ? "text-amber-900" : "text-emerald-900"
              }`}
            >
              <AnimatedNumber value={sinMapeo} format="int" />
            </p>
          </div>
          <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <DonutKPI
              value={pctMapeado}
              total={100}
              label="mapeado"
              color={pctMapeado === 100 ? "#10B981" : "#F59E0B"}
              size={110}
            />
          </div>
        </div>
      </section>

      {/* Atajos a empresas */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          href={"/empresa/REVTECH" as Route}
          className="group rounded-2xl border border-hairline bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Empresa coejecutora
          </p>
          <h3 className="mt-1 font-display text-2xl font-semibold text-ink-900 group-hover:text-cehta-green">
            REVTECH
          </h3>
          <p className="mt-2 text-sm text-ink-600">
            Dashboard, flujo mensual, transacciones, KPIs operativos, trabajadores y más.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-cehta-green group-hover:gap-2 group-hover:transition-all">
            Ver workspace REVTECH
            <ArrowRight className="size-3.5" />
          </span>
        </Link>
        <Link
          href={"/empresa/TRONGKAI" as Route}
          className="group rounded-2xl border border-hairline bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Empresa coejecutora
          </p>
          <h3 className="mt-1 font-display text-2xl font-semibold text-ink-900 group-hover:text-cehta-green">
            TRONGKAI
          </h3>
          <p className="mt-2 text-sm text-ink-600">
            Dashboard, flujo mensual, transacciones, KPIs operativos, trabajadores y más.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-cehta-green group-hover:gap-2 group-hover:transition-all">
            Ver workspace TRONGKAI
            <ArrowRight className="size-3.5" />
          </span>
        </Link>
      </section>

      {/* Guía 5 pasos del flujo CORFO */}
      <section className="rounded-3xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-cehta-green" strokeWidth={2} />
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Tu flujo de trabajo CORFO en 5 pasos
          </h2>
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Este es el ciclo de coordinación mensual. Cada paso tiene un link
          directo a su pantalla.
        </p>
        <ol className="mt-5 space-y-3">
          {CLAUDIA_FLUJO_STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.n}>
                <Link
                  href={step.href}
                  className="group flex items-start gap-4 rounded-2xl border border-transparent p-3 transition-all hover:border-hairline hover:bg-ink-50/40"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cehta-green/10 font-display text-sm font-semibold text-cehta-green">
                    {step.n}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 text-ink-500" strokeWidth={1.8} />
                      <p className="text-sm font-semibold text-ink-900">
                        {step.title}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                      {step.desc}
                    </p>
                  </div>
                  <ArrowRight className="mt-2 size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-cehta-green" />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {/* CTA enviar sugerencia (siempre visible al final) */}
      <section className="rounded-3xl border-2 border-dashed border-purple-300 bg-purple-50/40 p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-purple-100 text-purple-700">
            <PlayCircle className="size-6" strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-purple-900">
              ¿Falta algo? ¿Algo no funciona como esperabas?
            </h3>
            <p className="mt-1 text-sm text-purple-800">
              Tu feedback alimenta directamente las próximas mejoras de la
              plataforma. No es un buzón ciego: cada sugerencia llega al equipo
              de producto y se prioriza.
            </p>
            <Link
              href={"/sugerencias" as Route}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition-colors hover:bg-purple-700"
            >
              <MessageSquare className="size-4" strokeWidth={1.8} />
              Enviar una sugerencia
            </Link>
          </div>
        </div>
      </section>

      {/* Subsidio info card — solo si /ejecucion responde */}
      {subsidio.data && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 text-sm">
          <p className="font-semibold text-amber-900">
            Subsidio CORFO 2024-265638 — ejecución acumulada
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase text-amber-700">Monto total</p>
              <p className="font-display text-xl font-semibold text-amber-900">
                ${(subsidio.data.monto_total / 1_000_000).toLocaleString("es-CL")}MM
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-amber-700">Ejecutado</p>
              <p className="font-display text-xl font-semibold text-amber-900">
                ${(subsidio.data.ejecutado_total / 1_000_000).toLocaleString("es-CL")}MM
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-amber-700">Disponible</p>
              <p className="font-display text-xl font-semibold text-amber-900">
                ${(subsidio.data.disponible_total / 1_000_000).toLocaleString("es-CL")}MM
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-amber-700">% Ejecución</p>
              <p className="font-display text-xl font-semibold text-amber-900">
                {subsidio.data.pct_ejecucion.toFixed(1)}%
              </p>
            </div>
          </div>
        </section>
      )}
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
  icon: typeof Receipt;
  title: string;
  desc: string;
  tone: "emerald" | "amber" | "blue" | "purple";
}) {
  const toneCfg: Record<typeof tone, { bg: string; ring: string; ico: string }> = {
    emerald: {
      bg: "from-emerald-50/40 to-white",
      ring: "ring-emerald-200/40 hover:ring-emerald-400",
      ico: "bg-emerald-100 text-emerald-700",
    },
    amber: {
      bg: "from-amber-50/40 to-white",
      ring: "ring-amber-200/40 hover:ring-amber-400",
      ico: "bg-amber-100 text-amber-700",
    },
    blue: {
      bg: "from-blue-50/40 to-white",
      ring: "ring-blue-200/40 hover:ring-blue-400",
      ico: "bg-blue-100 text-blue-700",
    },
    purple: {
      bg: "from-purple-50/40 to-white",
      ring: "ring-purple-200/40 hover:ring-purple-400",
      ico: "bg-purple-100 text-purple-700",
    },
  };
  const cfg = toneCfg[tone];
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-3 rounded-2xl bg-gradient-to-br p-5 shadow-card ring-1 transition-all hover:-translate-y-0.5 hover:shadow-elevated-lg ${cfg.bg} ${cfg.ring}`}
    >
      <div className={`inline-flex size-10 items-center justify-center rounded-xl ${cfg.ico}`}>
        <Icon className="size-5" strokeWidth={1.8} />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="mt-0.5 text-[11px] text-ink-500">{desc}</p>
      </div>
      <ArrowRight className="size-3.5 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-cehta-green" />
    </Link>
  );
}
