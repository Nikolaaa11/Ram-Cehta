"use client";

/**
 * IcsSubscribeDialog — V4 fase 7.9.
 *
 * Modal con la URL ICS + instrucciones de suscripción para Google
 * Calendar, Outlook, Apple Calendar. La URL es estable; al actualizar
 * un entregable, en el siguiente sync (Google: cada ~24h, Apple: cada
 * pocas horas) el cliente externo refleja el cambio.
 *
 * No requiere login en el cliente externo — el endpoint hoy pide
 * Bearer token igual que todos los otros, lo cual significa que la URL
 * que copiamos debe incluir un mecanismo de auth. Como esto es uso
 * interno y los tokens de sesión expiran, la primera versión muestra
 * la URL "tal cual" + advertencia de que necesita un service token
 * persistente. En V5 podemos firmar URLs con un signed_token.
 */
import { useMemo, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IcsSubscribeDialog({ open, onOpenChange }: Props) {
  const [copied, setCopied] = useState(false);

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

  // URL ICS pública (requiere Bearer en server-side; para suscripciones
  // externas usamos el endpoint con token largo-vivido del admin via
  // /admin/api-tokens — el usuario lo configura una sola vez).
  const icsUrl = useMemo(() => `${apiBase}/entregables/calendar.ics`, [apiBase]);
  const webcalUrl = useMemo(
    () => icsUrl.replace(/^https?:\/\//, "webcal://"),
    [icsUrl],
  );

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL copiada al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar — copialo manualmente");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus
              className="h-5 w-5 text-cehta-green"
              strokeWidth={1.75}
            />
            Sincronizar con Google Calendar / Outlook
          </DialogTitle>
          <DialogDescription>
            Suscribite al feed iCalendar para ver los entregables en tu
            calendario externo. Se actualiza automáticamente — al marcar uno
            como entregado se elimina del feed.
          </DialogDescription>
        </DialogHeader>

        {/* URLs */}
        <div className="mt-4 space-y-3">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              URL del feed (https://)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-700 ring-1 ring-hairline">
                {icsUrl}
              </code>
              <button
                type="button"
                onClick={() => copyUrl(icsUrl)}
                className="inline-flex items-center gap-1 rounded-lg bg-cehta-green px-2.5 py-2 text-xs font-medium text-white hover:bg-cehta-green-700"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                Copiar
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Apple Calendar (webcal://)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-700 ring-1 ring-hairline">
                {webcalUrl}
              </code>
              <a
                href={webcalUrl}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                Abrir
              </a>
            </div>
          </div>
        </div>

        {/* Instrucciones */}
        <div className="mt-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Cómo agregar
          </p>
          <Step
            n={1}
            title="Google Calendar"
            body={
              <>
                Settings →{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px]">
                  Add calendar
                </code>{" "}
                →{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px]">
                  From URL
                </code>{" "}
                → pegá la URL de arriba. Sync cada ~24 hs.
              </>
            }
          />
          <Step
            n={2}
            title="Outlook (web)"
            body={
              <>
                Calendario → Add calendar →{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px]">
                  Subscribe from web
                </code>{" "}
                → pegá la URL.
              </>
            }
          />
          <Step
            n={3}
            title="Apple Calendar (Mac/iPhone)"
            body={
              <>
                Click en "Abrir" arriba con el link{" "}
                <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px]">
                  webcal://
                </code>{" "}
                — el sistema lo agrega automáticamente.
              </>
            }
          />
        </div>

        {/* Nota auth */}
        <div className="mt-4 rounded-xl border border-warning/20 bg-warning/5 p-3">
          <p className="text-[11px] text-ink-700">
            <strong className="text-warning">⚠ Auth:</strong> el feed requiere
            Bearer token. Si tu cliente externo (Google/Outlook) no soporta
            headers, generá un token de servicio en{" "}
            <a
              href="/admin/api-tokens"
              className="text-cehta-green hover:underline"
            >
              /admin/api-tokens
            </a>{" "}
            y pegalo en la URL como{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[10px]">
              ?token=...
            </code>{" "}
            (V5 firma URLs).
          </p>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40"
          >
            Cerrar
          </button>
          <a
            href={icsUrl}
            download="entregables-fip-cehta.ics"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
          >
            <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
            Descargar .ics
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cehta-green/15 text-[10px] font-bold text-cehta-green">
        {n}
      </span>
      <div className="flex-1">
        <p className="text-[12px] font-semibold text-ink-900">{title}</p>
        <p className="text-[11px] text-ink-600">{body}</p>
      </div>
    </div>
  );
}
