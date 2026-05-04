"use client";

/**
 * ActasReportView — render formal de las actas del FIP CEHTA.
 *
 * Filtros via URL searchParams (router.replace) para que el reporte sea
 * shareable y revalidable por el server component. Click en una acta
 * expande sus acuerdos. Print-friendly (oculta filtros y actions).
 */
import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Gavel,
  Printer,
  ScrollText,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ReportShell } from "@/components/reportes/ReportShell";
import { fmtDate, fmtInt } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import type {
  Acuerdo,
  FondoActa,
  FondoActaEstado,
  FondoActaTipo,
} from "@/lib/api/schema";

const TIPO_TODOS = "todos";

interface TipoMeta {
  label: string;
  icon: typeof Gavel;
  accent: string;
}

const TIPO_META: Record<FondoActaTipo, TipoMeta> = {
  directorio_afis: {
    label: "Directorio AFIS",
    icon: Gavel,
    accent: "text-cehta-green",
  },
  comite_inversion: {
    label: "Comité de Inversión",
    icon: Activity,
    accent: "text-sf-blue",
  },
  asamblea_lps: {
    label: "Asamblea de LPs",
    icon: Users,
    accent: "text-sf-purple",
  },
  comite_vigilancia: {
    label: "Comité de Vigilancia",
    icon: ShieldCheck,
    accent: "text-sf-teal",
  },
  comite_riesgo: {
    label: "Comité de Riesgo",
    icon: AlertTriangle,
    accent: "text-warning",
  },
  otro: {
    label: "Otro",
    icon: FileText,
    accent: "text-ink-500",
  },
};

const TIPO_ORDER: FondoActaTipo[] = [
  "directorio_afis",
  "comite_inversion",
  "asamblea_lps",
  "comite_vigilancia",
  "comite_riesgo",
  "otro",
];

const TIPO_OPTIONS: { value: string; label: string }[] = [
  { value: TIPO_TODOS, label: "Todos los órganos" },
  ...TIPO_ORDER.map((t) => ({ value: t, label: TIPO_META[t].label })),
];

const ESTADO_VARIANT: Record<FondoActaEstado, BadgeProps["variant"]> = {
  borrador: "neutral",
  aprobada: "info",
  firmada: "success",
  archivada: "neutral",
};

const ESTADO_LABEL: Record<FondoActaEstado, string> = {
  borrador: "Borrador",
  aprobada: "Aprobada",
  firmada: "Firmada",
  archivada: "Archivada",
};

interface Props {
  actas: FondoActa[];
  tipoOrgano?: string;
  desde?: string;
  hasta?: string;
}

export function ActasReportView({ actas, tipoOrgano, desde, hasta }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const tipoValue = tipoOrgano && tipoOrgano !== "" ? tipoOrgano : TIPO_TODOS;

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (tipoValue !== TIPO_TODOS) {
      const meta = TIPO_META[tipoValue as FondoActaTipo];
      if (meta) parts.push(meta.label);
    }
    if (desde && hasta) parts.push(`Del ${fmtDate(desde)} al ${fmtDate(hasta)}`);
    else if (desde) parts.push(`Desde ${fmtDate(desde)}`);
    else if (hasta) parts.push(`Hasta ${fmtDate(hasta)}`);
    if (parts.length === 0) {
      return "Vista consolidada de actas formales · FIP CEHTA ESG";
    }
    return parts.join(" · ");
  }, [tipoValue, desde, hasta]);

  const stats = useMemo(() => {
    const aprobadas = actas.filter(
      (a) => a.estado === "aprobada" || a.estado === "firmada",
    ).length;
    const borradores = actas.filter((a) => a.estado === "borrador").length;
    const acuerdos = actas.reduce((acc, a) => acc + (a.acuerdos?.length ?? 0), 0);
    return {
      total: actas.length,
      aprobadas,
      borradores,
      acuerdos,
    };
  }, [actas]);

  const grouped = useMemo(() => {
    const map = new Map<FondoActaTipo, FondoActa[]>();
    for (const acta of actas) {
      const list = map.get(acta.tipo_organo) ?? [];
      list.push(acta);
      map.set(acta.tipo_organo, list);
    }
    return TIPO_ORDER.map((t) => ({
      tipo: t,
      items: (map.get(t) ?? []).sort((a, b) => {
        const da = new Date(a.fecha_reunion).getTime();
        const db = new Date(b.fecha_reunion).getTime();
        return db - da;
      }),
    })).filter((g) => g.items.length > 0);
  }, [actas]);

  const cronologia = useMemo(
    () =>
      [...actas].sort((a, b) => {
        const da = new Date(a.fecha_reunion).getTime();
        const db = new Date(b.fecha_reunion).getTime();
        return db - da;
      }),
    [actas],
  );

  function pushParams(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => {
      router.replace(
        (qs ? `/reportes/actas?${qs}` : "/reportes/actas") as Route,
      );
    });
  }

  function updateTipo(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value || value === TIPO_TODOS) params.delete("tipo_organo");
    else params.set("tipo_organo", value);
    pushParams(params);
  }

  function updateDesde(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value) params.delete("desde");
    else params.set("desde", value);
    pushParams(params);
  }

  function updateHasta(value: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value) params.delete("hasta");
    else params.set("hasta", value);
    pushParams(params);
  }

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  return (
    <ReportShell
      eyebrow="Reporte formal · Actas del FIP CEHTA"
      title="Actas del Fondo"
      subtitle={subtitle}
      actions={
        <button
          type="button"
          onClick={handlePrint}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-apple",
            "hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
          )}
        >
          <Printer className="h-4 w-4" strokeWidth={1.5} />
          Imprimir / PDF
        </button>
      }
      filters={
        <div
          className={cn(
            "flex flex-wrap items-end gap-3",
            pending && "opacity-70",
          )}
        >
          <FilterField label="Tipo de órgano">
            <select
              value={tipoValue}
              onChange={(e) => updateTipo(e.target.value)}
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green min-w-[200px]"
            >
              {TIPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Desde">
            <input
              type="date"
              value={desde ?? ""}
              onChange={(e) => updateDesde(e.target.value)}
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green tabular-nums"
            />
          </FilterField>
          <FilterField label="Hasta">
            <input
              type="date"
              value={hasta ?? ""}
              onChange={(e) => updateHasta(e.target.value)}
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green tabular-nums"
            />
          </FilterField>
        </div>
      }
    >
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Total actas" value={fmtInt(stats.total)} />
        <KpiTile
          label="Aprobadas / firmadas"
          value={fmtInt(stats.aprobadas)}
          tone="ok"
        />
        <KpiTile
          label="Borradores"
          value={fmtInt(stats.borradores)}
          tone={stats.borradores > 0 ? "warn" : "neutral"}
        />
        <KpiTile label="Acuerdos totales" value={fmtInt(stats.acuerdos)} />
      </div>

      {actas.length === 0 ? (
        <Surface className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
            <ScrollText
              className="h-6 w-6 text-ink-300"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-base font-semibold text-ink-900">
            Sin actas en el período seleccionado
          </p>
          <p className="mt-1 max-w-md mx-auto text-sm text-ink-500">
            No encontramos actas para los filtros aplicados. Las actas formales
            son la trazabilidad oficial del Directorio AFIS, los Comités y la
            Asamblea de LPs.
          </p>
          <Link
            href={"/admin/fondo-actas" as Route}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
          >
            Crear primera acta
          </Link>
        </Surface>
      ) : (
        <>
          {/* Por tipo de órgano */}
          <Surface padding="none" className="overflow-hidden">
            <div className="border-b border-hairline px-6 py-4">
              <h3 className="text-base font-semibold tracking-tight text-ink-900">
                Por tipo de órgano
              </h3>
              <p className="text-xs text-ink-500">
                Conteo de actas en el período seleccionado
              </p>
            </div>
            <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map((g) => {
                const meta = TIPO_META[g.tipo];
                const Icon = meta.icon;
                const acuerdosCount = g.items.reduce(
                  (acc, a) => acc + (a.acuerdos?.length ?? 0),
                  0,
                );
                return (
                  <div
                    key={g.tipo}
                    className="flex items-start gap-3 bg-white p-5"
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100/60",
                        meta.accent,
                      )}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                        {meta.label}
                      </p>
                      <p className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-ink-900">
                        {fmtInt(g.items.length)}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500 tabular-nums">
                        {fmtInt(acuerdosCount)} acuerdos
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Surface>

          {/* Cronología */}
          <Surface padding="none" className="overflow-hidden">
            <div className="border-b border-hairline px-6 py-4">
              <h3 className="text-base font-semibold tracking-tight text-ink-900">
                Cronología
              </h3>
              <p className="text-xs text-ink-500">
                Más recientes primero · click en una acta para ver sus acuerdos
              </p>
            </div>
            <ul className="divide-y divide-hairline">
              {cronologia.map((acta) => (
                <ActaRow key={acta.acta_id} acta={acta} />
              ))}
            </ul>
          </Surface>
        </>
      )}
    </ReportShell>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  return (
    <Surface padding="compact" className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {label}
      </span>
      <span
        className={cn("font-display text-3xl font-semibold tabular-nums", {
          "text-ink-900": tone === "neutral",
          "text-positive": tone === "ok",
          "text-warning": tone === "warn",
        })}
      >
        {value}
      </span>
    </Surface>
  );
}

function ActaRow({ acta }: { acta: FondoActa }) {
  const [open, setOpen] = useState(false);
  const meta = TIPO_META[acta.tipo_organo];
  const Icon = meta.icon;
  const variant = ESTADO_VARIANT[acta.estado];
  const acuerdos = acta.acuerdos ?? [];
  const asistentesCount = (acta.asistentes ?? []).length;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-4 px-6 py-4 text-left transition-colors duration-150 hover:bg-ink-100/30 focus-visible:outline-none focus-visible:bg-ink-100/40"
      >
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100/60",
            meta.accent,
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold tracking-tight text-ink-900">
              {meta.label} · Acta N° {acta.numero_acta}
            </span>
            <Badge variant={variant}>{ESTADO_LABEL[acta.estado]}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500 tabular-nums">
            <span>{fmtDate(acta.fecha_reunion)}</span>
            {acta.lugar ? <span>· {acta.lugar}</span> : null}
            <span>· {fmtInt(asistentesCount)} asistentes</span>
            {acta.quorum !== null && acta.quorum_total !== null ? (
              <span>
                · Quórum {fmtInt(acta.quorum)}/{fmtInt(acta.quorum_total)}
              </span>
            ) : null}
            <span>· {fmtInt(acuerdos.length)} acuerdos</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            {acta.presidente ? (
              <span>
                Preside:{" "}
                <span className="text-ink-700">{acta.presidente}</span>
              </span>
            ) : null}
            {acta.secretario ? (
              <span>
                Secretario:{" "}
                <span className="text-ink-700">{acta.secretario}</span>
              </span>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-ink-300 transition-transform duration-200 ease-apple motion-reduce:transition-none",
            open && "rotate-180 text-ink-700",
          )}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
      {open && acuerdos.length > 0 ? (
        <div className="border-t border-hairline bg-ink-100/20 px-6 py-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
            Acuerdos
          </p>
          <ol className="space-y-2.5">
            {acuerdos.map((ac, i) => (
              <AcuerdoItem key={i} index={i + 1} acuerdo={ac} />
            ))}
          </ol>
        </div>
      ) : open && acuerdos.length === 0 ? (
        <div className="border-t border-hairline bg-ink-100/20 px-6 py-4 text-xs text-ink-500">
          Esta acta aún no registra acuerdos.
        </div>
      ) : null}
    </li>
  );
}

function AcuerdoItem({ index, acuerdo }: { index: number; acuerdo: Acuerdo }) {
  return (
    <li className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-hairline">
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          acuerdo.aprobado
            ? "bg-positive/10 text-positive"
            : "bg-negative/10 text-negative",
        )}
        aria-hidden="true"
      >
        {acuerdo.aprobado ? (
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <XCircle className="h-4 w-4" strokeWidth={1.75} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Punto {index} · {acuerdo.orden_dia}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-900">
          {acuerdo.descripcion}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-ink-500">
          <span className="text-positive">
            A favor: {fmtInt(acuerdo.votos_a_favor)}
          </span>
          <span className="text-negative">
            En contra: {fmtInt(acuerdo.votos_en_contra)}
          </span>
          <span>Abstenciones: {fmtInt(acuerdo.abstenciones)}</span>
          <span
            className={cn(
              "ml-auto font-medium",
              acuerdo.aprobado ? "text-positive" : "text-negative",
            )}
          >
            {acuerdo.aprobado ? "Aprobado" : "Rechazado"}
          </span>
        </div>
      </div>
    </li>
  );
}
