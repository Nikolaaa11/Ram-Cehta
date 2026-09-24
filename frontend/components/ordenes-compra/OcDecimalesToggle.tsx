"use client";

/**
 * OcDecimalesToggle — "Precio unitario: con decimales / sin decimales".
 *
 * Nicolás (2026-09-24): "coloca un botón en las OC para elegir que salgan
 * con decimales o sin decimales".
 *
 * Qué cambia y qué NO. Es SÓLO presentación del precio unitario:
 *   · con decimales  → $67.142,86, y cantidad x precio da exactamente el
 *     importe de la línea (por eso es el default desde el 2026-09-22);
 *   · sin decimales  → $67.143, la columna queda limpia pero la
 *     multiplicación impresa puede no dar el importe de la línea.
 * El importe de cada línea, el neto, el IVA y el total son los MISMOS en
 * los dos casos: no se mueve un peso. Por eso el endpoint es
 * `PATCH /ordenes-compra/{id}/formato` y no el PATCH general —funciona
 * también en borrador, en firma, firmada y pagada, donde la edición está
 * cerrada—, y por eso el aviso de abajo cambia según el estado: una OC que
 * ya salió se va a descargar distinta de acá en adelante.
 *
 * Sólo se muestra en OC en pesos: en UF y USD los centésimos son plata y
 * se imprimen siempre.
 */
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { apiClient, ApiError } from "@/lib/api/client";

interface Props {
  ocId: number;
  numeroOc: string;
  moneda: string;
  estado: string;
  mostrarDecimales: boolean;
}

/** Estados en los que la OC ya salió de la plataforma. */
const ESTADOS_YA_EMITIDA = new Set([
  "en_firma",
  "firmada",
  "enviada_proveedor",
  "facturada",
  "pagada",
  "parcial",
]);

const opcionBase =
  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-1 disabled:opacity-60";

export function OcDecimalesToggle({
  ocId,
  numeroOc,
  moneda,
  estado,
  mostrarDecimales,
}: Props) {
  const router = useRouter();
  const { session } = useSession();
  const { data: me } = useMe();

  // Mismo scope que exige el backend en el endpoint. El acceso a la empresa
  // lo valida el servidor (403), igual que en el resto de la ficha.
  const puedeCambiar = me?.allowed_actions?.includes("oc:update") ?? false;

  const mutation = useMutation({
    mutationFn: (valor: boolean) =>
      apiClient.patch<unknown>(
        `/ordenes-compra/${ocId}/formato`,
        { mostrar_decimales: valor },
        session,
      ),
    onSuccess: (_data, valor) => {
      toast.success(
        valor
          ? `OC ${numeroOc}: el precio unitario sale con decimales`
          : `OC ${numeroOc}: el precio unitario sale redondeado a peso`,
      );
      router.refresh();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudo cambiar el formato de la OC",
      );
    },
  });

  // En UF/USD no aplica; una OC anulada no se retoca (el backend devuelve
  // 409, así que tampoco se ofrece el botón).
  if ((moneda || "CLP").toUpperCase() !== "CLP") return null;
  if (estado === "anulada") return null;
  if (!puedeCambiar) return null;

  const cambiar = (valor: boolean) => {
    if (valor === mostrarDecimales || mutation.isPending) return;
    mutation.mutate(valor);
  };

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div
        role="group"
        aria-label="Decimales del precio unitario"
        className="inline-flex rounded-xl bg-white p-0.5 ring-1 ring-hairline"
      >
        <button
          type="button"
          aria-pressed={mostrarDecimales}
          disabled={mutation.isPending}
          onClick={() => cambiar(true)}
          className={`${opcionBase} ${
            mostrarDecimales
              ? "bg-cehta-green text-white"
              : "text-ink-700 hover:bg-ink-100/40"
          }`}
        >
          Con decimales
        </button>
        <button
          type="button"
          aria-pressed={!mostrarDecimales}
          disabled={mutation.isPending}
          onClick={() => cambiar(false)}
          className={`${opcionBase} ${
            !mostrarDecimales
              ? "bg-cehta-green text-white"
              : "text-ink-700 hover:bg-ink-100/40"
          }`}
        >
          Sin decimales
        </button>
      </div>
      <p className="max-w-sm text-xs leading-relaxed text-ink-500 sm:text-right">
        {mostrarDecimales
          ? "El precio unitario sale como es ($67.142,86): cantidad x precio da exacto el importe de la línea."
          : "El precio unitario sale redondeado ($67.143): más limpio, pero cantidad x precio puede no dar el importe de la línea."}{" "}
        Los montos no cambian, sólo cómo se imprime el precio.
        {ESTADOS_YA_EMITIDA.has(estado)
          ? " Ojo: esta OC ya salió, así que el PDF que se descargue ahora se verá distinto al anterior."
          : ""}
      </p>
    </div>
  );
}
