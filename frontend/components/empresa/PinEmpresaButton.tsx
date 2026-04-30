"use client";

import { Pin, PinOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePinnedEmpresas, MAX_PINNED } from "@/hooks/use-pinned-empresas";

interface Props {
  empresaCodigo: string;
  className?: string;
}

/**
 * Botón compacto de pin/unpin para el header de una empresa. Click toggle:
 * si la empresa ya está en pins → la saca; si no, la agrega (con FIFO si ya
 * hay 5). Usa el hook `usePinnedEmpresas` que persiste en
 * `app.user_preferences` con key `pinned_empresas`.
 */
export function PinEmpresaButton({ empresaCodigo, className = "" }: Props) {
  const { isPinned, togglePin, isPending, isFull } = usePinnedEmpresas();
  const pinned = isPinned(empresaCodigo);

  const handleClick = async () => {
    try {
      const next = await togglePin(empresaCodigo);
      const nowPinned = next.includes(empresaCodigo);
      if (nowPinned) {
        toast.success(`${empresaCodigo} pineada en favoritos`);
      } else {
        toast.success(`${empresaCodigo} removida de favoritos`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error guardando preferencia",
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title={
        pinned
          ? "Quitar de favoritos"
          : isFull
          ? `Ya tenés ${MAX_PINNED} pineadas — agregarla saca la más vieja`
          : "Pinear en favoritos"
      }
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-white text-ink-600 transition-all duration-150 ease-apple hover:bg-ink-50 disabled:opacity-50 ${
        pinned ? "border-cehta-green/30 bg-cehta-green/5 text-cehta-green" : ""
      } ${className}`}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : pinned ? (
        <Pin className="h-4 w-4 fill-cehta-green" strokeWidth={1.75} />
      ) : (
        <PinOff className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}
