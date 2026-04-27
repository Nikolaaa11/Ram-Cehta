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
 *  - onConfirm:    handler async; el dialog se cierra al resolver con éxito.
 *  - tone:         "destructive" (default) o "neutral" para anular/cambios
 *                   no destructivos.
 */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface ConfirmDeleteDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => Promise<unknown> | void;
  tone?: "destructive" | "neutral";
}

export function ConfirmDeleteDialog({
  trigger,
  title,
  description,
  confirmText = "Eliminar",
  cancelText = "Cancelar",
  onConfirm,
  tone = "destructive",
}: ConfirmDeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
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
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <AlertDialogCancel disabled={pending}>{cancelText}</AlertDialogCancel>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 ${confirmBtn}`}
          >
            {pending ? `${confirmText}…` : confirmText}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
