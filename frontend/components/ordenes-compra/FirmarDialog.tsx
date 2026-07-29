"use client";

/**
 * FirmarDialog — el momento de firmar la OC.
 *
 * Réplica de la experiencia de firmar un PDF: la persona ve su nombre
 * dibujado en cursiva sobre una línea, tal cual va a salir impreso, y
 * recién ahí confirma. Puede ajustar el texto (algunos firman con el
 * nombre completo y otros abreviado) antes de aceptar.
 *
 * La vista previa usa la MISMA tipografía que el PDF (Great Vibes,
 * declarada en globals.css como `font-firma`), así que lo que se ve acá
 * es literalmente lo que queda estampado en el documento.
 */
import * as React from "react";
import { PenLine } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Número de OC, para que la persona sepa qué está firmando. */
  numeroOc: string;
  /** Nombre registrado del firmante — es el texto propuesto por defecto. */
  nombreSugerido: string;
  cargo?: string | null;
  /** Razón social que se imprime bajo el cargo. */
  empresa?: string | null;
  pendiente: boolean;
  onConfirm: (firmaVisual: string) => void | Promise<unknown>;
}

const MAX = 120;

export function FirmarDialog({
  open,
  onOpenChange,
  numeroOc,
  nombreSugerido,
  cargo,
  empresa,
  pendiente,
  onConfirm,
}: Props) {
  const [texto, setTexto] = React.useState(nombreSugerido);

  // Al reabrir el diálogo, volver a proponer el nombre registrado: si la
  // persona canceló después de editarlo, no queremos que el borrador viejo
  // reaparezca sin que se dé cuenta.
  React.useEffect(() => {
    if (open) setTexto(nombreSugerido);
  }, [open, nombreSugerido]);

  const limpio = texto.trim();
  const valido = limpio.length >= 3 && limpio.length <= MAX;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // No dejar cerrar mientras se está firmando: la firma es
        // irreversible y cerrar a mitad confunde sobre si quedó o no.
        if (pendiente) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Firmar la OC {numeroOc}</DialogTitle>
          <DialogDescription>
            Así va a verse tu firma en el PDF. Podés ajustar el texto antes
            de confirmar.
          </DialogDescription>
        </DialogHeader>

        {/* Vista previa: idéntica al bloque de firma del PDF */}
        <div className="rounded-2xl bg-ink-100/50 p-6 ring-1 ring-hairline">
          <div className="mx-auto max-w-[16rem] text-center">
            <div
              className="font-firma flex h-16 items-end justify-center overflow-hidden pb-1 text-[2.1rem] leading-none text-ink-900"
              aria-label="Vista previa de la firma"
            >
              {limpio || " "}
            </div>
            <div className="border-t border-ink-900" />
            <p className="mt-1 text-[0.8rem] font-semibold text-ink-900">
              {nombreSugerido}
            </p>
            {cargo && <p className="text-xs text-ink-600">{cargo}</p>}
            {empresa && (
              <p className="text-[0.7rem] uppercase text-ink-600">{empresa}</p>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="firma-texto"
            className="text-sm font-medium text-ink-900"
          >
            Nombre con el que firmás
          </label>
          <input
            id="firma-texto"
            type="text"
            value={texto}
            maxLength={MAX}
            disabled={pendiente}
            onChange={(e) => setTexto(e.target.value)}
            className="mt-1 w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green/40"
          />
          {!valido && limpio.length > 0 && (
            <p className="mt-1 text-xs text-negative">
              Escribí al menos 3 caracteres.
            </p>
          )}
        </div>

        <p className="text-xs text-ink-600">
          Al firmar queda registrada la fecha, tu IP y un código de
          verificación. <span className="font-medium text-ink-900">No se
          puede deshacer.</span> Si algo de la OC está mal, cerrá esto y usá
          “Rechazar” indicando el motivo.
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              disabled={pendiente}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition hover:bg-ink-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={!valido || pendiente}
            onClick={() => onConfirm(limpio)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition hover:bg-cehta-green/90 disabled:opacity-50"
          >
            <PenLine className="h-4 w-4" strokeWidth={1.5} />
            {pendiente ? "Firmando…" : "Firmar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
