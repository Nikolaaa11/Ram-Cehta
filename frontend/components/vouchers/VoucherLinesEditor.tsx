"use client";

/**
 * VoucherLinesEditor — MEGAPROMPT PREVOUCHER.
 *
 * Editor de imputación para vouchers DRAFT: el especialista toma un
 * pre-voucher de la cola (/prevouchers) y COMPLETA las líneas contables
 * (cuenta × proyecto × área, debe/haber) sin borrar y recrear el voucher.
 * Guarda con PUT /vouchers/{id}/lines (replace-all, valida cuenta imputable
 * + habilitada, área y proyecto de la empresa — mismas reglas que crear).
 *
 * Solo se muestra para status DRAFT.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

interface LineIn {
  localId: number;
  cuenta_codigo: string;
  proyecto_codigo: string;
  area_codigo: string;
  debit: string;
  credit: string;
  descripcion: string;
  // Campos fiscales que el editor NO expone pero que DEBEN sobrevivir al
  // guardado: la rendición CORFO suma por balance_treatment='GASTO' y el
  // mapper de Nubox usa iva_amount. Viajan de ida y vuelta intactos.
  iva_tratamiento: string | null;
  iva_amount: number | null;
  neto_amount: number | null;
  balance_treatment: string;
}

// Tipo del schema generado: debit/credit llegan como number.
import type { VoucherLine } from "@/lib/api/schema";

type VoucherLineRead = Pick<
  VoucherLine,
  | "line_id"
  | "line_number"
  | "cuenta_codigo"
  | "proyecto_codigo"
  | "area_codigo"
  | "debit"
  | "credit"
  | "descripcion"
  | "iva_tratamiento"
  | "iva_amount"
  | "neto_amount"
  | "balance_treatment"
>;

interface CuentaItem {
  codigo: string;
  nombre: string;
}

interface AreaItem {
  codigo: string;
  nombre: string;
}

interface ProyectoItem {
  codigo: string;
  nombre: string;
}

let nextLocalId = 1;

function toLineIn(l: VoucherLineRead): LineIn {
  return {
    localId: nextLocalId++,
    cuenta_codigo: l.cuenta_codigo,
    proyecto_codigo: l.proyecto_codigo ?? "",
    area_codigo: l.area_codigo ?? "",
    debit: Number(l.debit) > 0 ? String(Math.round(Number(l.debit))) : "",
    credit: Number(l.credit) > 0 ? String(Math.round(Number(l.credit))) : "",
    descripcion: l.descripcion ?? "",
    // Se leen y se reenvían tal cual — el editor no los toca.
    iva_tratamiento: l.iva_tratamiento ?? null,
    iva_amount: l.iva_amount ?? null,
    neto_amount: l.neto_amount ?? null,
    balance_treatment: l.balance_treatment ?? "NA",
  };
}

/** Línea nueva en blanco (sin datos fiscales previos que preservar). */
function nuevaLinea(): LineIn {
  return {
    localId: nextLocalId++,
    cuenta_codigo: "",
    proyecto_codigo: "",
    area_codigo: "",
    debit: "",
    credit: "",
    descripcion: "",
    iva_tratamiento: null,
    iva_amount: null,
    neto_amount: null,
    balance_treatment: "NA",
  };
}

export function VoucherLinesEditor({
  voucherId,
  empresaCodigo,
  status,
  lines,
}: {
  voucherId: number;
  empresaCodigo: string;
  status: string;
  lines: VoucherLineRead[];
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<LineIn[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: cuentas } = useApiQuery<CuentaItem[]>(
    ["plan-cuentas", "imputables", empresaCodigo],
    `/plan-cuentas?imputable=true&activa=true&empresa_codigo=${empresaCodigo}`,
    !!session && editing,
    { staleTime: 5 * 60_000 },
  );
  const { data: areas } = useApiQuery<AreaItem[]>(
    ["areas", empresaCodigo],
    `/areas?empresa_codigo=${empresaCodigo}&only_active=true`,
    !!session && editing,
    { staleTime: 5 * 60_000 },
  );
  const { data: proyectos } = useApiQuery<ProyectoItem[]>(
    ["proyectos-contables", empresaCodigo],
    `/proyectos-contables?empresa_codigo=${empresaCodigo}&estado=ACTIVE`,
    !!session && editing,
    { staleTime: 5 * 60_000 },
  );

  const totalDebe = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.debit) || 0), 0),
    [rows],
  );
  const totalHaber = useMemo(
    () => rows.reduce((acc, r) => acc + (Number(r.credit) || 0), 0),
    [rows],
  );
  const cuadrado = totalDebe === totalHaber && totalDebe > 0;

  if (status !== "DRAFT") return null;

  function startEditing() {
    setRows(lines.length > 0 ? lines.map(toLineIn) : [nuevaLinea()]);
    setEditing(true);
  }

  function patchRow(localId: number, patch: Partial<LineIn>) {
    setRows((rs) => rs.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, nuevaLinea()]);
  }

  function removeRow(localId: number) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.localId !== localId) : rs));
  }

  async function save() {
    if (!session || saving) return;
    for (const r of rows) {
      if (!r.cuenta_codigo) {
        toast.error("Todas las líneas necesitan una cuenta.");
        return;
      }
      const d = Number(r.debit) || 0;
      const h = Number(r.credit) || 0;
      if ((d > 0) === (h > 0)) {
        toast.error("Cada línea lleva Debe O Haber (uno de los dos, mayor a 0).");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        lines: rows.map((r, i) => ({
          line_number: i + 1,
          cuenta_codigo: r.cuenta_codigo,
          proyecto_codigo: r.proyecto_codigo || null,
          area_codigo: r.area_codigo || null,
          debit: Number(r.debit) || 0,
          credit: Number(r.credit) || 0,
          descripcion: r.descripcion.trim() || null,
          // Se reenvían intactos: el editor no los muestra, pero borrarlos
          // dejaría la rendición CORFO en $0 (suma por balance_treatment).
          iva_tratamiento: r.iva_tratamiento,
          iva_amount: r.iva_amount,
          neto_amount: r.neto_amount,
          balance_treatment: r.balance_treatment,
        })),
      };
      const res = await apiClient.put<{ cuadrado: boolean }>(
        `/vouchers/${voucherId}/lines`,
        payload,
        session,
      );
      toast.success(
        res.cuadrado
          ? "Imputación guardada y cuadrada — listo para enviar a firmas."
          : "Imputación guardada (aún descuadrada).",
      );
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["prevouchers"] });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "No se pudo guardar la imputación.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="border-t border-hairline bg-ink-50/40 px-6 py-3">
        <Button type="button" variant="outline" size="sm" onClick={startEditing}>
          <Pencil className="h-3.5 w-3.5" />
          Editar imputación
        </Button>
        <span className="ml-3 text-[11px] text-ink-500">
          Completá cuentas, áreas y montos antes de enviar a firmas.
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-hairline bg-white px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cehta-green">
          Editando imputación
        </p>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-ink-500 hover:text-negative"
          aria-label="Cancelar edición"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div
            key={r.localId}
            className="grid grid-cols-2 items-center gap-2 rounded-xl bg-ink-50/40 p-2 md:grid-cols-[24px_2fr_1fr_1fr_1fr_1fr_1.4fr_28px]"
          >
            <span className="hidden text-center text-xs tabular-nums text-ink-500 md:block">
              {i + 1}
            </span>
            <select
              value={r.cuenta_codigo}
              onChange={(e) => patchRow(r.localId, { cuenta_codigo: e.target.value })}
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">— Cuenta —</option>
              {(cuentas ?? []).map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} · {c.nombre}
                </option>
              ))}
            </select>
            <select
              value={r.area_codigo}
              onChange={(e) => patchRow(r.localId, { area_codigo: e.target.value })}
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">Área —</option>
              {(areas ?? []).map((a) => (
                <option key={a.codigo} value={a.codigo}>
                  {a.codigo}
                </option>
              ))}
            </select>
            <select
              value={r.proyecto_codigo}
              onChange={(e) => patchRow(r.localId, { proyecto_codigo: e.target.value })}
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">Proyecto —</option>
              {(proyectos ?? []).map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.codigo}
                </option>
              ))}
            </select>
            <input
              inputMode="numeric"
              placeholder="Debe"
              value={r.debit}
              onChange={(e) =>
                patchRow(r.localId, {
                  debit: e.target.value.replace(/[^\d]/g, ""),
                  credit: e.target.value ? "" : r.credit,
                })
              }
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-right text-xs tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            <input
              inputMode="numeric"
              placeholder="Haber"
              value={r.credit}
              onChange={(e) =>
                patchRow(r.localId, {
                  credit: e.target.value.replace(/[^\d]/g, ""),
                  debit: e.target.value ? "" : r.debit,
                })
              }
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-right text-xs tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            <input
              type="text"
              placeholder="Descripción"
              value={r.descripcion}
              maxLength={300}
              onChange={(e) => patchRow(r.localId, { descripcion: e.target.value })}
              className="h-9 w-full rounded-lg border-0 bg-white px-2 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            <button
              type="button"
              onClick={() => removeRow(r.localId)}
              disabled={rows.length <= 1}
              className="justify-self-center text-ink-500 hover:text-negative disabled:opacity-30"
              aria-label={`Quitar línea ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Agregar línea
        </Button>
        <div className="flex items-center gap-4">
          <span
            className={
              cuadrado
                ? "text-xs font-semibold text-cehta-green"
                : "text-xs font-semibold text-warning"
            }
          >
            D ${totalDebe.toLocaleString("es-CL")} · H $
            {totalHaber.toLocaleString("es-CL")}
            {cuadrado ? " ✓" : " (descuadrado)"}
          </span>
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Guardar imputación
          </Button>
        </div>
      </div>
    </div>
  );
}
