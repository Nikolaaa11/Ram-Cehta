"use client";

/**
 * Forma de pago de una OC — hitos por PORCENTAJE (antes: cuotas por monto).
 *
 * Las OC reales se pactan por porcentaje: "30% anticipo al inicio de
 * fabricación y 70% contra entrega". El operador define % + descripción +
 * fecha, y el monto se calcula solo sobre el total de la OC.
 *
 * Permite:
 *   - Editar los hitos (%, descripción, fecha) con el monto calculado en vivo
 *   - Repartos rápidos: 50/50, 30/70, 3 partes iguales
 *   - Ver cuánto suma (verde si da 100%, rojo si falta o sobra)
 *   - Generar vouchers DRAFT por cada hito pendiente
 *
 * El endpoint sigue siendo /cuotas por compatibilidad; hacia el usuario todo
 * se llama "forma de pago" / "hitos de pago".
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Calendar,
  FileText,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  Percent,
  Lock,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

/** Fila tal como la devuelve el backend. */
interface Cuota {
  cuota_id: number;
  oc_id: number;
  numero_cuota: number;
  porcentaje: string | null;
  monto: string;
  fecha_vencimiento: string;
  descripcion: string | null;
  estado: string;
  voucher_id: number | null;
  voucher_codigo: string | null;
  voucher_status: string | null;
  dias_a_vencer: number | null;
}

/** Fila en edición dentro del formulario. */
interface HitoDraft {
  key: string;
  numeroCuota: number | null;
  porcentaje: string;
  descripcion: string;
  fecha: string;
  /** true = ya tiene voucher generado: no se puede tocar. */
  bloqueado: boolean;
  estado: string;
  montoServidor: number;
  voucherId: number | null;
  voucherCodigo: string | null;
  voucherStatus: string | null;
}

const TOLERANCIA = 0.01;

const fmtCLP = (v: string | number) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
};

const fmtPct = (n: number) =>
  (Math.round(n * 1000) / 1000).toLocaleString("es-CL", {
    maximumFractionDigits: 3,
  });

const fmtDate = (d: string) => {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("es-CL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const hoyMas = (dias: number) =>
  new Date(Date.now() + dias * 86_400_000).toISOString().split("T")[0] ?? "";

const toNum = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const ESTADO_LABEL: Record<string, string> = {
  PENDIENTE: "Por generar",
  VOUCHER_GENERADO: "Voucher creado",
  PAGADA: "Pagado",
  ANULADA: "Anulado",
};

const ESTADO_COLOR: Record<string, string> = {
  PENDIENTE: "bg-amber-100 text-amber-800 ring-amber-200",
  VOUCHER_GENERADO: "bg-blue-100 text-blue-800 ring-blue-200",
  PAGADA: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  ANULADA: "bg-red-100 text-red-800 ring-red-200",
};

/** Descripciones que más se repiten en las OC del fondo. */
const SUGERENCIAS = [
  "Anticipo",
  "Anticipo al inicio de fabricación",
  "Contra entrega",
  "Contra entrega conforme",
  "Contra recepción de factura",
  "Saldo final",
];

let seqKey = 0;
const nuevaKey = () => `hito-${Date.now()}-${seqKey++}`;

function toDraft(c: Cuota, totalOc: number): HitoDraft {
  const monto = Number(c.monto || 0);
  // Filas viejas (cargadas antes de la migración) pueden no tener % guardado:
  // se muestra el derivado del monto para que el operador vea algo coherente.
  const pct =
    c.porcentaje !== null && c.porcentaje !== undefined
      ? Number(c.porcentaje)
      : totalOc > 0
        ? Math.round((monto / totalOc) * 100_000) / 1000
        : 0;
  return {
    key: `cuota-${c.cuota_id}`,
    numeroCuota: c.numero_cuota,
    porcentaje: String(Math.round(pct * 1000) / 1000),
    descripcion: c.descripcion ?? "",
    fecha: c.fecha_vencimiento,
    bloqueado: c.voucher_id !== null,
    estado: c.estado,
    montoServidor: monto,
    voucherId: c.voucher_id,
    voucherCodigo: c.voucher_codigo,
    voucherStatus: c.voucher_status,
  };
}

function draftNuevo(porcentaje: number, descripcion: string, fecha: string): HitoDraft {
  return {
    key: nuevaKey(),
    numeroCuota: null,
    porcentaje: String(porcentaje),
    descripcion,
    fecha,
    bloqueado: false,
    estado: "PENDIENTE",
    montoServidor: 0,
    voucherId: null,
    voucherCodigo: null,
    voucherStatus: null,
  };
}

export function OcCuotasSection({
  ocId,
  totalOc,
}: {
  ocId: number;
  totalOc: number;
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [hitos, setHitos] = useState<HitoDraft[]>([]);
  const [editado, setEditado] = useState(false);

  const cuotas = useApiQuery<Cuota[]>(
    ["oc-cuotas", String(ocId)],
    `/ordenes-compra/${ocId}/cuotas`,
  );

  // Sincroniza el formulario con el servidor mientras el operador no haya
  // tocado nada — así no le pisamos lo que está escribiendo con un refetch.
  useEffect(() => {
    if (!cuotas.data || editado) return;
    setHitos(cuotas.data.map((c) => toDraft(c, totalOc)));
  }, [cuotas.data, editado, totalOc]);

  const guardarMut = useMutation({
    mutationFn: async () =>
      apiClient.put<Cuota[]>(
        `/ordenes-compra/${ocId}/cuotas`,
        {
          hitos: hitos.map((h) => ({
            porcentaje: toNum(h.porcentaje),
            descripcion: h.descripcion.trim() || null,
            fecha_vencimiento: h.fecha,
            numero_cuota: h.numeroCuota,
          })),
        },
        session,
      ),
    onSuccess: () => {
      toast.success("Forma de pago guardada.");
      setEditado(false);
      qc.invalidateQueries({ queryKey: ["oc-cuotas", String(ocId)] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof ApiError ? e.detail : "No se pudo guardar la forma de pago",
      ),
  });

  const generarMut = useMutation({
    mutationFn: async () =>
      apiClient.post<{
        cuotas_procesadas: number;
        vouchers_creados: number;
        vouchers_codigos: string[];
      }>(`/ordenes-compra/${ocId}/cuotas/generar-vouchers`, {}, session),
    onSuccess: (data) => {
      if (data.vouchers_creados === 0) {
        toast.info("No había hitos pendientes. Todos los vouchers ya existen.");
      } else {
        toast.success(
          `${data.vouchers_creados} vouchers DRAFT creados: ${data.vouchers_codigos.join(", ")}. Editalos en /vouchers para imputar.`,
          { duration: 12_000 },
        );
      }
      qc.invalidateQueries({ queryKey: ["oc-cuotas", String(ocId)] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof ApiError ? e.detail : "No se pudieron generar los vouchers",
      ),
  });

  // ── Cálculos en vivo ────────────────────────────────────────────────
  const hayBloqueados = hitos.some((h) => h.bloqueado);

  const sumaPct = useMemo(
    () =>
      Math.round(
        hitos.reduce((acc, h) => acc + toNum(h.porcentaje), 0) * 1000,
      ) / 1000,
    [hitos],
  );
  const cuadra = Math.abs(sumaPct - 100) <= TOLERANCIA;
  const diferencia = Math.round((100 - sumaPct) * 1000) / 1000;

  /**
   * Montos calculados igual que en el backend: el ÚLTIMO hito editable
   * absorbe la diferencia de redondeo para que la suma dé exactamente el
   * total de la OC. Se muestra en pesos para que se vea cuánta plata es.
   */
  const montos = useMemo(() => {
    const res = hitos.map((h) =>
      h.bloqueado ? h.montoServidor : Math.round((totalOc * toNum(h.porcentaje)) / 100),
    );
    const idxUltimoEditable = hitos.reduce(
      (acc, h, i) => (h.bloqueado ? acc : i),
      -1,
    );
    if (idxUltimoEditable >= 0 && cuadra) {
      const suma = res.reduce((a, b) => a + b, 0);
      res[idxUltimoEditable] = (res[idxUltimoEditable] ?? 0) + (totalOc - suma);
    }
    return res;
  }, [hitos, totalOc, cuadra]);

  const sumaMontos = montos.reduce((a, b) => a + b, 0);
  const editables = hitos.filter((h) => !h.bloqueado);
  const faltanFechas = editables.some((h) => !h.fecha);
  const hayPctInvalido = editables.some(
    (h) => toNum(h.porcentaje) <= 0 || toNum(h.porcentaje) > 100,
  );
  const puedeGuardar =
    hitos.length > 0 &&
    cuadra &&
    !faltanFechas &&
    !hayPctInvalido &&
    totalOc > 0 &&
    !guardarMut.isPending;

  const pendientesGuardadas = (cuotas.data ?? []).filter(
    (c) => c.estado === "PENDIENTE",
  );
  const conVoucher = (cuotas.data ?? []).filter(
    (c) => c.estado === "VOUCHER_GENERADO" || c.estado === "PAGADA",
  );

  // ── Mutadores del formulario ────────────────────────────────────────
  const patch = (key: string, cambio: Partial<HitoDraft>) => {
    setEditado(true);
    setHitos((prev) =>
      prev.map((h) => (h.key === key ? { ...h, ...cambio } : h)),
    );
  };

  const agregar = () => {
    setEditado(true);
    setHitos((prev) => [
      ...prev,
      draftNuevo(
        Math.max(0, Math.round((100 - sumaPct) * 1000) / 1000),
        "",
        hoyMas(30 * (prev.length + 1)),
      ),
    ]);
  };

  const quitar = (key: string) => {
    setEditado(true);
    setHitos((prev) => prev.filter((h) => h.key !== key));
  };

  /** Repartos rápidos: los tres que más se usan en las OC del fondo. */
  const aplicarPreset = (partes: number[], etiquetas: string[]) => {
    // Guard: un reparto nuevo pisaría los hitos que ya tienen voucher y la
    // OC dejaría de cuadrar. El botón ya viene deshabilitado en ese caso.
    if (hayBloqueados) return;
    setEditado(true);
    setHitos((prev) =>
      partes.map((p, i) =>
        draftNuevo(
          p,
          etiquetas[i] ?? "",
          prev[i]?.fecha || hoyMas(30 * (i + 1)),
        ),
      ),
    );
  };

  const presets: { label: string; run: () => void }[] = [
    {
      label: "50 / 50",
      run: () => aplicarPreset([50, 50], ["Anticipo", "Contra entrega"]),
    },
    {
      label: "30 / 70",
      run: () => aplicarPreset([30, 70], ["Anticipo", "Contra entrega"]),
    },
    {
      label: "3 partes iguales",
      // 33,334 + 33,333 + 33,333 = 100 exacto (mismo criterio del backend).
      run: () =>
        aplicarPreset(
          [33.334, 33.333, 33.333],
          ["Primer pago", "Segundo pago", "Pago final"],
        ),
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Percent className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
            Forma de pago
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            Definí los hitos por porcentaje — ej: 30% de anticipo y 70% contra
            entrega. El monto de cada hito se calcula solo sobre el total de la
            OC ({fmtCLP(totalOc)}).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => guardarMut.mutate()}
            disabled={!puedeGuardar}
            title={
              !cuadra
                ? "Los porcentajes tienen que sumar 100%"
                : faltanFechas
                  ? "Falta la fecha de algún hito"
                  : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {guardarMut.isPending ? "Guardando…" : "Guardar forma de pago"}
          </button>
          {pendientesGuardadas.length > 0 && (
            <button
              type="button"
              onClick={() => generarMut.mutate()}
              disabled={generarMut.isPending || editado}
              title={
                editado
                  ? "Guardá la forma de pago antes de generar los vouchers"
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-3 py-2 text-sm font-semibold text-white hover:bg-ink-900/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FileText className="h-4 w-4" strokeWidth={2} />
              {generarMut.isPending
                ? "Generando…"
                : `Generar ${pendientesGuardadas.length} voucher${pendientesGuardadas.length === 1 ? "" : "s"} DRAFT`}
            </button>
          )}
        </div>
      </div>

      {totalOc <= 0 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <div>
            Esta OC todavía no tiene total. Cargá los ítems primero: los montos
            de cada hito se calculan sobre el total.
          </div>
        </div>
      )}

      {/* Repartos rápidos */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Repartos rápidos
        </span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={p.run}
            disabled={hayBloqueados}
            title={
              hayBloqueados
                ? "Hay hitos con voucher generado: editá los porcentajes a mano"
                : undefined
            }
            className="rounded-full bg-ink-50 px-3 py-1 text-xs font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={agregar}
          className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-3 py-1 text-xs font-semibold text-cehta-green ring-1 ring-cehta-green/20 hover:bg-cehta-green/15"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
          Agregar hito
        </button>
      </div>

      {/* Editor de hitos */}
      {cuotas.isLoading ? (
        <div className="rounded-2xl bg-ink-50/40 p-8 text-center text-sm text-ink-500">
          Cargando forma de pago…
        </div>
      ) : hitos.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
          <Calendar className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-ink-500">
            Esta OC todavía no tiene forma de pago. Usá un reparto rápido
            (50/50, 30/70) o agregá los hitos uno por uno.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          {/* Encabezado — solo en pantallas grandes */}
          <div className="hidden md:grid grid-cols-[3rem_7rem_1fr_10rem_9rem_9rem_2.5rem] gap-2 bg-ink-50/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <div>N°</div>
            <div>%</div>
            <div>Descripción del hito</div>
            <div>Fecha</div>
            <div className="text-right">Monto</div>
            <div>Estado</div>
            <div />
          </div>

          <datalist id="hitos-pago-sugeridos">
            {SUGERENCIAS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          {hitos.map((h, i) => (
            <div
              key={h.key}
              className="grid grid-cols-1 md:grid-cols-[3rem_7rem_1fr_10rem_9rem_9rem_2.5rem] gap-2 border-t border-hairline/60 px-4 py-3 items-center"
            >
              <div className="text-sm font-medium tabular-nums text-ink-500">
                {h.numeroCuota ?? i + 1}
              </div>

              <div className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.001}
                  value={h.porcentaje}
                  disabled={h.bloqueado}
                  aria-label={`Porcentaje del hito ${i + 1}`}
                  onChange={(e) => patch(h.key, { porcentaje: e.target.value })}
                  className="w-full rounded-lg border-0 bg-white px-2 py-2 text-sm tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50 disabled:text-ink-500"
                />
                <span className="text-xs text-ink-400">%</span>
              </div>

              <input
                type="text"
                list="hitos-pago-sugeridos"
                placeholder="Ej: Anticipo al inicio de fabricación"
                value={h.descripcion}
                disabled={h.bloqueado}
                aria-label={`Descripción del hito ${i + 1}`}
                onChange={(e) => patch(h.key, { descripcion: e.target.value })}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50 disabled:text-ink-500"
              />

              <input
                type="date"
                value={h.fecha}
                disabled={h.bloqueado}
                aria-label={`Fecha del hito ${i + 1}`}
                onChange={(e) => patch(h.key, { fecha: e.target.value })}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-50 disabled:text-ink-500"
              />

              <div className="text-right text-sm font-medium tabular-nums text-ink-900">
                {fmtCLP(montos[i] ?? 0)}
                <div className="text-[10px] font-normal text-ink-400 md:hidden">
                  {fmtDate(h.fecha)}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
                    ESTADO_COLOR[h.estado] ?? "bg-ink-100 text-ink-700 ring-ink-200"
                  }`}
                >
                  {ESTADO_LABEL[h.estado] ?? h.estado}
                </span>
                {h.voucherId && (
                  <Link
                    href={`/vouchers/${h.voucherId}`}
                    className="text-[11px] text-cehta-green underline"
                  >
                    {h.voucherCodigo ?? `#${h.voucherId}`}
                    {h.voucherStatus ? ` (${h.voucherStatus})` : ""}
                  </Link>
                )}
              </div>

              <div className="flex justify-end">
                {h.bloqueado ? (
                  <span
                    title="Ya tiene voucher generado: no se puede editar"
                    className="text-ink-300"
                  >
                    <Lock className="h-4 w-4" strokeWidth={2} />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => quitar(h.key)}
                    aria-label={`Quitar hito ${i + 1}`}
                    className="rounded-lg p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Totalizador — el semáforo que mira Nicolás antes de guardar */}
          <div
            className={`flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm ${
              cuadra
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {cuadra ? (
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              ) : (
                <AlertCircle className="h-4 w-4" strokeWidth={2} />
              )}
              <span className="tabular-nums">Suman {fmtPct(sumaPct)}%</span>
              {cuadra ? (
                <span className="font-normal">— la OC cuadra.</span>
              ) : diferencia > 0 ? (
                <span className="font-normal">
                  — faltan {fmtPct(diferencia)}% para llegar al 100%.
                </span>
              ) : (
                <span className="font-normal">
                  — te pasaste en {fmtPct(-diferencia)}%.
                </span>
              )}
            </div>
            <div className="tabular-nums text-xs">
              {fmtCLP(sumaMontos)} de {fmtCLP(totalOc)}
            </div>
          </div>
        </div>
      )}

      {faltanFechas && hitos.length > 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          Falta la fecha de algún hito — sin fecha no se puede guardar.
        </p>
      )}

      {hayPctInvalido && hitos.length > 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          Hay hitos con 0% (o más de 100%). Poné el porcentaje o quitá el hito.
        </p>
      )}

      {editado && (
        <p className="text-xs text-ink-500">
          Tenés cambios sin guardar. Apretá “Guardar forma de pago” para que
          queden registrados en la OC.
        </p>
      )}

      {conVoucher.length > 0 && (
        <p className="text-xs text-ink-500 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
          {conVoucher.length} hito{conVoucher.length === 1 ? "" : "s"} ya{" "}
          {conVoucher.length === 1 ? "tiene" : "tienen"} voucher DRAFT. Editalo
          desde el link para imputar a cuentas + área. Esos hitos quedan
          bloqueados para no romper el voucher en curso.
        </p>
      )}
    </section>
  );
}
