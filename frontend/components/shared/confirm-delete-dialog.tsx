"use client";

/**
 * ConfirmDeleteDialog — modal Apple-style reutilizable para acciones
 * destructivas (eliminar/anular/etc).
 *
 * Usa Radix AlertDialog (no Dialog) — focus-trap, sin cierre por click fuera,
 * y un foco inicial en el botón Cancelar (Radix lo hace por default en
 * AlertDialog).
 *
 * Props:
 *  - trigger:      ReactNode que abre el dialog (botón).
 *  - title:        encabezado.
 *  - description:  cuerpo explicativo.
 *  - confirmText:  texto del botón destructivo (default "Eliminar").
 *  - onConfirm:    handler async; recibe el motivo (string vacío si el
 *                   dialog no pide uno). El dialog se cierra al resolver bien.
 *  - tone:         "destructive" (default) o "neutral" para anular/cambios
 *                   no destructivos.
 *  - motivo:       si viene, el dialog exige escribir un motivo antes de
 *                   habilitar el botón. Se usa para acciones que dejan
 *                   registro permanente (borrar una OC): el motivo es lo
 *                   único que va a explicar después por qué se hizo.
 */
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface MotivoConfig {
  /** Etiqueta del campo. */
  label: string;
  placeholder?: string;
  /** Mínimo de caracteres NO vacíos. Debe coincidir con el del backend. */
  minLength: number;
  /** Línea de ayuda bajo el campo: qué se hace con lo que se escriba. */
  hint?: React.ReactNode;
}

interface ConfirmDeleteDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (motivo: string) => Promise<unknown> | void;
  tone?: "destructive" | "neutral";
  motivo?: MotivoConfig;
}

export function ConfirmDeleteDialog({
  trigger,
  title,
  description,
  confirmText = "Eliminar",
  cancelText = "Cancelar",
  onConfirm,
  tone = "destructive",
  motivo,
}: ConfirmDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [texto, setTexto] = useState("");

  // Limpiar al cerrar. Sin esto, el motivo de la OC anterior aparece
  // precargado al abrir el dialog de la siguiente — y un motivo copiado sin
  // querer es peor que ninguno: queda guardado para siempre y miente.
  useEffect(() => {
    if (!open) setTexto("");
  }, [open]);

  const faltan = motivo ? motivo.minLength - texto.trim().length : 0;
  const motivoIncompleto = motivo != null && faltan > 0;

  async function handleConfirm() {
    if (pending || motivoIncompleto) return;
    setPending(true);
    try {
      await onConfirm(texto.trim());
      setOpen(false);
    } catch {
      // El componente padre maneja el toast de error; nos quedamos abiertos
      // para que el usuario reintente o cancele.
    } finally {
      setPending(false);
    }
  }

  const iconBg =
    tone === "destructive"
      ? "bg-negative/10 text-negative"
      : "bg-warning/10 text-warning";
  const confirmBtn =
    tone === "destructive"
      ? "bg-negative hover:bg-negative/90"
      : "bg-warning hover:bg-warning/90";

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <div className="flex gap-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}
            aria-hidden="true"
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="mt-1.5">
              {description}
            </AlertDialogDescription>
          </div>
        </div>
        {motivo && (
          <div className="mt-4">
            <label
              className="block text-sm font-medium text-ink-900"
              htmlFor="confirm-motivo"
            >
              {motivo.label}
            </label>
            <textarea
              id="confirm-motivo"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              placeholder={motivo.placeholder}
              disabled={pending}
              className="mt-1.5 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:opacity-60"
            />
            <p className="mt-1.5 text-xs text-ink-500">
              {faltan > 0
                ? `Faltan ${faltan} caracteres.`
                : (motivo.hint ?? null)}
            </p>
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <AlertDialogCancel disabled={pending}>{cancelText}</AlertDialogCancel>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || motivoIncompleto}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 ${confirmBtn}`}
          >
            {pending ? `${confirmText}…` : confirmText}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
