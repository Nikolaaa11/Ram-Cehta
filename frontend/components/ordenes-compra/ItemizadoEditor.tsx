"use client";

/**
 * El itemizado de una OC: una grilla editable, con unidades, pegado desde
 * Excel y descripciones que crecen.
 *
 * Existe para que las TRES pantallas que editan ítems —el alta manual, las
 * dos de IA y ahora la edición de una OC ya creada— usen exactamente el mismo
 * control. Estaban duplicadas, y esa duplicación es la razón por la que las
 * dos de IA nunca tuvieron el campo `unidad` que el alta manual sí tenía.
 *
 * Los totales NO se calculan acá: los calcula `calcularTotalesOC`, que es el
 * espejo verificado del servidor. Este componente sólo edita filas.
 */
import { Plus, Trash2 } from "lucide-react";

import { TextareaAutosize } from "@/components/ui/textarea-autosize";
import { parsearItemsPegados } from "@/lib/oc/pegar-items";
import { toast } from "@/components/ui/toast";

export interface ItemEditable {
  descripcion: string;
  unidad: string;
  precio_unitario: string;
  cantidad: string;
}

interface Props {
  items: ItemEditable[];
  onChange: (items: ItemEditable[]) => void;
  /** Bloquea toda edición (OC firmada, guardando…). */
  disabled?: boolean;
  /** Unidades sugeridas en el datalist. */
  unidadesId?: string;
}

export const ITEM_VACIO: ItemEditable = {
  descripcion: "",
  unidad: "",
  precio_unitario: "",
  cantidad: "1",
};

const inputBase =
  "w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green/20 disabled:bg-surface-muted disabled:opacity-60";

export function ItemizadoEditor({
  items,
  onChange,
  disabled = false,
  unidadesId = "oc-unidades-sugeridas",
}: Props) {
  const actualizar = (idx: number, patch: Partial<ItemEditable>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const agregar = () => onChange([...items, { ...ITEM_VACIO }]);

  const quitar = (idx: number) =>
    onChange(items.length > 1 ? items.filter((_, i) => i !== idx) : items);

  /**
   * Pegar una planilla completa desde Excel.
   *
   * Las filas pegadas REEMPLAZAN desde donde se pegó hacia abajo, en vez de
   * agregarse al final: si el operador está parado en la fila 1 vacía y pega
   * 8 ítems, quiere 8 ítems, no 1 vacío + 8.
   *
   * Si lo pegado no es una planilla (una palabra suelta), el parser devuelve
   * lista vacía y se deja pasar el pegado normal del navegador.
   */
  const pegar = (idx: number, e: React.ClipboardEvent) => {
    if (disabled) return;
    const pegados = parsearItemsPegados(e.clipboardData.getData("text/plain"));
    if (pegados.length === 0) return;
    e.preventDefault();

    const nuevos = [...items];
    pegados.forEach((pg, i) => {
      const destino = idx + i;
      const previo = nuevos[destino] ?? { ...ITEM_VACIO };
      nuevos[destino] = {
        descripcion: pg.descripcion || previo.descripcion,
        // Las columnas que la planilla no traiga NO pisan lo cargado a mano:
        // pegar 2 columnas sobre una fila con precio no puede borrar el precio.
        unidad: pg.unidad || previo.unidad,
        precio_unitario: pg.precio_unitario || previo.precio_unitario,
        cantidad: pg.cantidad || previo.cantidad,
      };
    });
    onChange(nuevos);
    toast.success(
      pegados.length === 1 ? "Se pegó 1 ítem" : `Se pegaron ${pegados.length} ítems`,
    );
  };

  return (
    <div className="space-y-3">
      <datalist id={unidadesId}>
        {["Un", "Gl", "Días", "Hrs", "m2", "m3", "ml", "Kg", "Ton", "Global"].map(
          (u) => (
            <option key={u} value={u} />
          ),
        )}
      </datalist>

      {items.map((it, idx) => (
        <div
          key={idx}
          className="grid grid-cols-12 items-start gap-3 border-t border-hairline pt-3 first:border-0 first:pt-0"
        >
          <div className="col-span-12 sm:col-span-4">
            <label className="sr-only" htmlFor={`it-desc-${idx}`}>
              Descripción del ítem {idx + 1}
            </label>
            <TextareaAutosize
              id={`it-desc-${idx}`}
              value={it.descripcion}
              onChange={(e) => actualizar(idx, { descripcion: e.target.value })}
              onPaste={(e) => pegar(idx, e)}
              placeholder="Descripción — o pegá desde Excel"
              disabled={disabled}
              minRows={1}
              maxRows={10}
              className={inputBase}
            />
          </div>

          <div className="col-span-4 sm:col-span-3">
            <label className="sr-only" htmlFor={`it-precio-${idx}`}>
              Precio unitario del ítem {idx + 1}
            </label>
            {/* `step="any"`: con un step fijo el navegador marca como
                inválido un precio con más decimales y empuja a mostrar ceros
                que nadie escribió. */}
            <input
              id={`it-precio-${idx}`}
              type="number"
              value={it.precio_unitario}
              onChange={(e) =>
                actualizar(idx, { precio_unitario: e.target.value })
              }
              onPaste={(e) => pegar(idx, e)}
              placeholder="P. Unit."
              step="any"
              title="Un precio negativo resta: es una línea de descuento"
              disabled={disabled}
              className={`${inputBase} tabular-nums`}
            />
          </div>

          <div className="col-span-3 sm:col-span-2">
            <label className="sr-only" htmlFor={`it-cant-${idx}`}>
              Cantidad del ítem {idx + 1}
            </label>
            <input
              id={`it-cant-${idx}`}
              type="number"
              value={it.cantidad}
              onChange={(e) => actualizar(idx, { cantidad: e.target.value })}
              placeholder="Cant."
              step="any"
              min="0"
              disabled={disabled}
              className={`${inputBase} tabular-nums`}
            />
          </div>

          {/* La unidad, que las pantallas de IA no tenían: la columna existe
              en la BD y el PDF la imprime, pero por ese camino siempre
              llegaba NULL. Texto libre con sugerencias — cada rubro usa su
              nomenclatura. */}
          <div className="col-span-3 sm:col-span-2">
            <label className="sr-only" htmlFor={`it-unidad-${idx}`}>
              Unidad del ítem {idx + 1}
            </label>
            <input
              id={`it-unidad-${idx}`}
              type="text"
              list={unidadesId}
              value={it.unidad ?? ""}
              onChange={(e) => actualizar(idx, { unidad: e.target.value })}
              placeholder="Unidad"
              maxLength={20}
              autoComplete="off"
              disabled={disabled}
              title="Unidad de medida: Un, Gl, Días, m3, Kg, Hrs… (opcional)"
              className={inputBase}
            />
          </div>

          <div className="col-span-2 sm:col-span-1 flex">
            <button
              type="button"
              onClick={() => quitar(idx)}
              disabled={disabled || items.length === 1}
              aria-label={`Eliminar ítem ${idx + 1}`}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-negative/10 text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={agregar}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10 disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        Agregar ítem
      </button>
    </div>
  );
}
