"use client";

/**
 * /admin/proyectos/[codigo] — Round 91 — Edición del proyecto Bloque E
 *
 * Page para que admin gestione un proyecto contable sin SQL:
 *   - Ver y editar % default (CORFO / P-tec / Empresa)
 *   - Ver y editar cuentas contables destino por fuente
 *   - Cuenta IVA corporativo
 *   - Bloquear edición de % en el voucher (rigid mode)
 *
 * Validación live: la suma de los 3 % debe ser 100 (también checkeada
 * en backend por CHECK constraint).
 */
import { use, useState, useEffect } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Lock,
  Save,
  Unlock,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProyectoContable } from "@/lib/api/schema";

export default function ProyectoAdminPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();
  const qc = useQueryClient();

  const { data: proyecto, isLoading } = useQuery<ProyectoContable>({
    queryKey: ["proyecto-contable", codigo],
    queryFn: () =>
      apiClient.get<ProyectoContable>(
        `/proyectos-contables/${codigo}`,
        session,
      ),
    enabled: !!session,
  });

  // State local del form (se sincroniza con el query cuando carga)
  const [pctCorfo, setPctCorfo] = useState<number>(0);
  const [pctPtec, setPctPtec] = useState<number>(0);
  const [pctEmpresa, setPctEmpresa] = useState<number>(100);
  const [ctaCorfo, setCtaCorfo] = useState<string>("");
  const [ctaPtec, setCtaPtec] = useState<string>("");
  const [ctaEmpresa, setCtaEmpresa] = useState<string>("");
  const [ctaIva, setCtaIva] = useState<string>("");
  const [bloquear, setBloquear] = useState<boolean>(false);

  useEffect(() => {
    if (proyecto) {
      setPctCorfo(Number(proyecto.aporte_corfo_pct_default));
      setPctPtec(Number(proyecto.aporte_ptec_pct_default));
      setPctEmpresa(Number(proyecto.aporte_empresa_directa_pct_default));
      setCtaCorfo(proyecto.cuenta_aporte_corfo ?? "");
      setCtaPtec(proyecto.cuenta_aporte_ptec_cehta ?? "");
      setCtaEmpresa(proyecto.cuenta_aporte_empresa_directa ?? "");
      setCtaIva(proyecto.cuenta_iva_corporativo ?? "");
      setBloquear(proyecto.bloquear_edicion_pct);
    }
  }, [proyecto]);

  const sumaPct = pctCorfo + pctPtec + pctEmpresa;
  const sumaOk = Math.abs(sumaPct - 100) < 0.01;

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        aporte_corfo_pct_default: pctCorfo,
        aporte_ptec_pct_default: pctPtec,
        aporte_empresa_directa_pct_default: pctEmpresa,
        cuenta_aporte_corfo: ctaCorfo || null,
        cuenta_aporte_ptec_cehta: ctaPtec || null,
        cuenta_aporte_empresa_directa: ctaEmpresa || null,
        cuenta_iva_corporativo: ctaIva || null,
        bloquear_edicion_pct: bloquear,
      };
      return apiClient.patch<ProyectoContable>(
        `/proyectos-contables/${codigo}`,
        body,
        session,
      );
    },
    onSuccess: () => {
      toast.success("Proyecto actualizado");
      qc.invalidateQueries({ queryKey: ["proyecto-contable", codigo] });
      qc.invalidateQueries({ queryKey: ["reparto-default", codigo] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo actualizar",
        { duration: 8000 },
      );
    },
  });

  if (isLoading || !proyecto) {
    return (
      <div className="mx-auto max-w-[1024px] px-6 py-8 space-y-6">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1024px] px-6 py-8 space-y-6">
      <Link
        href={"/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al subsidio
      </Link>

      {/* Header */}
      <div className="rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-blue-50/30 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
          <CircleDollarSign className="size-3.5 text-cehta-green" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Proyecto contable · {proyecto.empresa_codigo}
          </p>
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          {proyecto.nombre}
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Código: <span className="font-mono">{proyecto.codigo}</span>
          {proyecto.subsidio_codigo && (
            <>
              {" · "}Subsidio:{" "}
              <Link
                href={`/admin/subsidios/${proyecto.subsidio_codigo}` as Route}
                className="font-mono text-cehta-green hover:underline"
              >
                {proyecto.subsidio_codigo}
              </Link>
            </>
          )}
          {proyecto.presupuesto_total && (
            <>
              {" · "}Presupuesto: $
              {Number(proyecto.presupuesto_total).toLocaleString("es-CL")}
            </>
          )}
        </p>
      </div>

      {/* Reparto % */}
      <Surface className="p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            Reparto default por fuente
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            Estos % se aplican automáticamente al crear un voucher para este
            proyecto desde <code>/vouchers/corfo</code>. La suma debe ser
            exactamente 100. En el voucher el operador puede ajustarlos a
            menos que actives &quot;Bloquear edición&quot; abajo.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PctField
            label="CORFO subsidio"
            value={pctCorfo}
            setValue={setPctCorfo}
            tone="cehta"
          />
          <PctField
            label="P-tec (CEHTA Capital)"
            value={pctPtec}
            setValue={setPctPtec}
            tone="blue"
          />
          <PctField
            label="Empresa directa"
            value={pctEmpresa}
            setValue={setPctEmpresa}
            tone="ink"
          />
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-ink-50/60">
          <span className="text-sm text-ink-700">Suma:</span>
          <span
            className={`font-mono text-lg font-semibold tabular-nums ${
              sumaOk ? "text-cehta-green" : "text-negative"
            }`}
          >
            {sumaPct.toFixed(2)}%
            {sumaOk ? (
              <CheckCircle2 className="inline size-4 ml-1.5" />
            ) : (
              <span className="text-xs ml-2 font-normal">
                ⚠ debe ser 100%
              </span>
            )}
          </span>
        </div>
      </Surface>

      {/* Cuentas */}
      <Surface className="p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            Cuentas contables destino
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            Cada fuente carga a una cuenta contable distinta. Usá códigos del
            plan IFRS Nubox (ej. <code>4102-01</code> para gasto operacional,{" "}
            <code>1170-01</code> para IVA crédito fiscal). La cuenta IVA
            siempre debe ser corporativa (regla CORFO).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CtaField
            label="Cuenta CORFO"
            placeholder="ej. 4102-01"
            value={ctaCorfo}
            setValue={setCtaCorfo}
          />
          <CtaField
            label="Cuenta P-tec (CEHTA Capital)"
            placeholder="ej. 4102-01"
            value={ctaPtec}
            setValue={setCtaPtec}
          />
          <CtaField
            label="Cuenta Empresa directa"
            placeholder="ej. 4102-01"
            value={ctaEmpresa}
            setValue={setCtaEmpresa}
          />
          <CtaField
            label="Cuenta IVA corporativo"
            placeholder="ej. 1170-01"
            value={ctaIva}
            setValue={setCtaIva}
            warning
          />
        </div>
      </Surface>

      {/* Bloqueo edición */}
      <Surface className="p-5">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={bloquear}
            onChange={(e) => setBloquear(e.target.checked)}
            className="size-4"
          />
          <div className="flex-1">
            <p className="font-semibold text-ink-900 flex items-center gap-2">
              {bloquear ? (
                <Lock className="size-4 text-amber-600" />
              ) : (
                <Unlock className="size-4 text-ink-400" />
              )}
              Bloquear edición de % en el voucher
            </p>
            <p className="text-xs text-ink-500 mt-0.5">
              {bloquear
                ? "Operadores NO pueden ajustar los % al crear un voucher. Usan el reparto exacto definido acá."
                : "Operadores pueden ajustar los % por voucher (default 50/20/30 sugerido, editable)."}
            </p>
          </div>
        </label>
      </Surface>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          disabled={!sumaOk || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saveMut.isPending ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function PctField({
  label,
  value,
  setValue,
  tone,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  tone: "cehta" | "blue" | "ink";
}) {
  const ring =
    tone === "cehta"
      ? "ring-cehta-green/30 bg-cehta-green/5"
      : tone === "blue"
        ? "ring-blue-300/40 bg-blue-50/40"
        : "ring-hairline bg-ink-50/50";
  return (
    <div className={`rounded-xl ring-1 ${ring} p-4`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          step={0.01}
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          className="flex-1 rounded-md border-0 bg-white px-3 py-2 text-lg font-semibold ring-1 ring-hairline focus:ring-2 focus:ring-cehta-green"
        />
        <span className="text-lg text-ink-500 font-semibold">%</span>
      </div>
    </div>
  );
}

function CtaField({
  label,
  value,
  setValue,
  placeholder,
  warning,
}: {
  label: string;
  value: string;
  setValue: (s: string) => void;
  placeholder: string;
  warning?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="form-input font-mono"
      />
      {warning && (
        <p className="mt-1 text-[10px] text-amber-600">
          ⚠ Esta cuenta IVA es corporativa de la entidad receptora. Nunca
          se debe asignar al pozo CORFO (regla bloqueante).
        </p>
      )}
    </div>
  );
}
