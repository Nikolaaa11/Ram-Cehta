"use client";

/**
 * VoucherLineSection — V5++ ola CH (fase 2)
 *
 * Componente compartido para las 3 pantallas que crean vouchers Nubox-style:
 *   /vouchers/nubox            (form manual)
 *   /vouchers/desde-mensaje    (texto pegado + IA)
 *   /vouchers/importar         (archivo + IA)
 *
 * Cada voucher tiene 2 listas de líneas (DEBE Contable + HABER Financiera).
 * Este componente renderiza UNA de las dos. Recibe `tipo_documento` para
 * calcular `Total Bruto = Total Neto × 1.19` cuando el tipo doc aplica IVA
 * (lista en backend, NO hardcoded acá — disciplina 1).
 *
 * Columnas:
 *   # · Comentario · Plan de Cuenta · Total Neto · Total Bruto · 🗑
 *
 * Total Bruto es read-only, recalculado en vivo.
 */
import { CreditCard, Plus, Receipt, Trash2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { CuentaTypeahead } from "@/components/vouchers/CuentaTypeahead";

export interface VoucherLineRow {
  comentario: string;
  cuenta_codigo: string;
  total: string; // monto neto (lo que tipea el usuario)
}

interface Props {
  title: string;
  tone: "contable" | "financiera";
  lines: VoucherLineRow[];
  /** Codigo del tipo doc actual (FACTURA, FACTURA_EXENTA, etc.). */
  tipoDocumento: string;
  /** Subset de tipos que aplican IVA 19% (viene de FormMetadata backend). */
  tiposAfectosIva: string[];
  /**
   * Spec maestro AJUSTE 6/12: factor IVA (default 1.19) leído de
   * `meta.iva_porcentaje` del backend. Pasalo como `1 + meta.iva_porcentaje`.
   * NO hardcodear acá.
   */
  ivaFactor?: number;
  /** Moneda — afecta como se formatea el bruto. Default CLP. */
  moneda?: "CLP" | "USD" | "UF" | "EUR" | string;
  /**
   * AJUSTE 10: codigo empresa para filtrar el plan de cuentas en el
   * typeahead. Si viene vacío, el typeahead muestra "Cargando…" hasta que
   * el padre lo setee.
   */
  empresaCodigo: string;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  onUpdate: (idx: number, field: keyof VoucherLineRow, value: string) => void;
}

export function VoucherLineSection({
  title,
  tone,
  lines,
  tipoDocumento,
  tiposAfectosIva,
  ivaFactor = 1.19,
  moneda = "CLP",
  empresaCodigo,
  onAdd,
  onRemove,
  onUpdate,
}: Props) {
  const Icon = tone === "contable" ? Receipt : CreditCard;
  const aplicaIva = tiposAfectosIva.includes(tipoDocumento);

  // V5++ ola CH (fase 2): IVA solo aplica si moneda CLP. En USD/UF/EUR
  // los documentos no llevan IVA (excepción facturas afectas en CLP+).
  // Acá tomamos la convención simple: aplicar IVA solo si CLP + tipo afecto.
  const aplicaIvaEfectivo = aplicaIva && moneda === "CLP";

  const formatMonto = (valor: number): string => {
    if (!valor || valor === 0) return "—";
    if (moneda === "CLP") {
      return `$${Math.round(valor).toLocaleString("es-CL")}`;
    }
    const prefijo =
      moneda === "USD" ? "US$" : moneda === "UF" ? "UF " : `${moneda} `;
    return `${prefijo}${valor.toLocaleString("es-CL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })}`;
  };

  const calcBruto = (neto: number): number =>
    aplicaIvaEfectivo ? neto * ivaFactor : neto;

  return (
    <Surface className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon
            className={`size-5 ${
              tone === "contable" ? "text-amber-500" : "text-blue-500"
            }`}
          />
          <h2 className="text-lg font-medium text-ink-900">
            {title}
          </h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="size-4 mr-1" />
          Agregar línea
        </Button>
      </div>

      {/* AJUSTE 1: en mobile la tabla scrollea horizontal (min-w 768px)
          en lugar de romper layout. Las columnas usan porcentajes para
          que en desktop sigan proporcionales. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[768px]">
          <thead className="text-ink-500 text-xs uppercase">
            <tr>
              <th className="text-left px-2 py-1.5 w-12">#</th>
              <th className="text-left px-2 py-1.5 w-[30%]">Comentario *</th>
              <th className="text-left px-2 py-1.5 w-[35%]">Plan de Cuenta *</th>
              <th className="text-right px-2 py-1.5 w-[13%]">Total Neto *</th>
              <th
                className="text-right px-2 py-1.5 w-[13%]"
                title={
                  aplicaIvaEfectivo
                    ? "Total Neto × 1.19 (IVA 19%). Read-only — se recalcula automáticamente."
                    : aplicaIva && moneda !== "CLP"
                      ? `Tipo doc afecto pero moneda ${moneda} no lleva IVA. Bruto = Neto.`
                      : "Tipo de documento exento o sin IVA aplicable. Bruto = Neto."
                }
              >
                Total Bruto
              </th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {lines.map((line, idx) => {
              const neto = parseFloat(line.total) || 0;
              return (
                <tr key={idx}>
                  <td className="px-2 py-1.5 text-ink-500">{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    {/* Prompt maestro C.1.6/C.2.6: comentario de línea sigue el
                        mismo criterio que B.4 — 2 líneas visibles con scroll
                        interno si excede, mantiene capacidad full del modelo. */}
                    <textarea
                      required
                      value={line.comentario}
                      onChange={(e) =>
                        onUpdate(idx, "comentario", e.target.value)
                      }
                      placeholder="Descripción"
                      rows={2}
                      maxLength={500}
                      className="form-input resize-none overflow-y-auto"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    {/* AJUSTE 10: combobox typeahead — busca por código o
                        nombre, prioriza prefijos típicos para DEBE/HABER. */}
                    <CuentaTypeahead
                      required
                      value={line.cuenta_codigo}
                      onChange={(codigo) =>
                        onUpdate(idx, "cuenta_codigo", codigo)
                      }
                      empresaCodigo={empresaCodigo}
                      tone={tone}
                      placeholder="Código o nombre…"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.total}
                      onChange={(e) => onUpdate(idx, "total", e.target.value)}
                      className="form-input text-right"
                    />
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-mono text-ink-600 tabular-nums"
                    aria-readonly="true"
                  >
                    {formatMonto(calcBruto(neto))}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onRemove(idx)}
                      disabled={lines.length === 1}
                      className="text-ink-400 hover:text-red-500 disabled:opacity-30"
                      aria-label="Quitar línea"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-ink-400">
        {aplicaIvaEfectivo
          ? `Total Bruto = Total Neto × 1.19 (IVA 19%) — recalculado en vivo desde el tipo de documento.`
          : aplicaIva && moneda !== "CLP"
            ? `Tipo afecto a IVA pero moneda ${moneda} — el IVA solo se aplica en CLP. Bruto = Neto.`
            : `Tipo de documento sin IVA aplicable (exento / DI / SRF). Bruto = Neto.`}
      </p>
    </Surface>
  );
}
