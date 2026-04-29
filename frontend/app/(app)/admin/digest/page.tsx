"use client";

/**
 * Admin > Digest CEO (V3 fase 10).
 *
 * Permite previsualizar y disparar manualmente el digest semanal del CEO.
 * El gate `app_role === "admin"` ya lo hace `/admin/layout.tsx`. El backend
 * además valida `notifications:admin` scope en cada endpoint.
 *
 *   Left column:  formulario de recipients (chips) + botón Enviar ahora
 *   Right column: iframe con preview HTML 600x800 (mailbox-safe)
 *   Bottom:       toggle JSON payload tree
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ChevronLeft,
  Mail,
  Send,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useDigestPreview, useSendDigest } from "@/hooks/use-digest";
import { useSession } from "@/hooks/use-session";
import { ApiError } from "@/lib/api/client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function AdminDigestPage() {
  const { session } = useSession();
  const preview = useDigestPreview();
  const send = useSendDigest();

  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

  // Construimos la URL del iframe con el bearer token. Pasamos el token
  // como query param vía un blob URL — el backend lee Authorization header,
  // así que en su lugar pre-fetcheamos el HTML autenticado y lo metemos
  // en un blob URL local.
  useEffect(() => {
    let revokeUrl: string | null = null;
    const fetchHtml = async () => {
      if (!session?.access_token) return;
      try {
        const res = await fetch(
          `${API_BASE}/digest/ceo-weekly/preview.html`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            cache: "no-store",
          },
        );
        if (!res.ok) return;
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        revokeUrl = url;
        setIframeUrl(url);
      } catch {
        // ignore — iframe queda en estado vacío
      }
    };
    fetchHtml();
    return () => {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [session?.access_token, preview.dataUpdatedAt]);

  const addRecipient = (raw: string) => {
    const value = raw.trim().replace(/[,;\s]+$/, "");
    if (!value) return;
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      toast.error("Email inválido", { description: value });
      return;
    }
    if (recipients.includes(value)) return;
    setRecipients((prev) => [...prev, value]);
    setRecipientInput("");
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const onSendClick = () => {
    send.mutate(
      { recipients: recipients.length > 0 ? recipients : undefined },
      {
        onSuccess: (data) => {
          if (data.sent > 0) {
            toast.success("Digest enviado", {
              description: `Enviado a ${data.sent} destinatario${
                data.sent === 1 ? "" : "s"
              }${
                data.failed.length > 0
                  ? ` · ${data.failed.length} fallido${
                      data.failed.length === 1 ? "" : "s"
                    }`
                  : ""
              }.`,
            });
          } else {
            toast.warning("Digest no enviado", {
              description:
                data.failed.length > 0
                  ? `Falló a ${data.failed.length} destinatario(s).`
                  : "No hubo destinatarios.",
            });
          }
        },
        onError: (err) => {
          let description =
            err instanceof Error ? err.message : "Error desconocido";
          if (err instanceof ApiError && err.status === 503) {
            description =
              "Resend no está configurado. Pedile al admin setear RESEND_API_KEY.";
          }
          toast.error("No se pudo enviar el digest", { description });
        },
      },
    );
  };

  const period = useMemo(() => {
    if (!preview.data) return null;
    return `${preview.data.period_from} → ${preview.data.period_to}`;
  }, [preview.data]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 lg:px-10">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
              Digest semanal CEO
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Envío automático lunes 8am · {period ?? "calculando…"}
            </p>
          </div>
          {preview.isError && (
            <Badge variant="warning">Error cargando preview</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        {/* Left column: form */}
        <Surface>
          <Surface.Header>
            <Surface.Title>Enviar ahora</Surface.Title>
            <Surface.Subtitle>
              Si dejás la lista vacía, se usa la default configurada en
              <code className="mx-1 rounded bg-ink-100/60 px-1.5 py-0.5 text-xs">
                EMAIL_ADMIN_RECIPIENTS
              </code>
              del backend.
            </Surface.Subtitle>
          </Surface.Header>
          <Surface.Body>
            <div className="space-y-2">
              <label
                htmlFor="recipient-input"
                className="text-xs font-medium uppercase tracking-wide text-ink-500"
              >
                Destinatarios
              </label>

              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-3 py-1 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/20"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeRecipient(email)}
                        aria-label={`Quitar ${email}`}
                        className="rounded-full p-0.5 transition-colors hover:bg-cehta-green/20"
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <input
                id="recipient-input"
                type="email"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === " ") {
                    e.preventDefault();
                    addRecipient(recipientInput);
                  }
                  if (
                    e.key === "Backspace" &&
                    recipientInput === "" &&
                    recipients.length > 0
                  ) {
                    setRecipients((prev) => prev.slice(0, -1));
                  }
                }}
                onBlur={() => {
                  if (recipientInput.trim()) addRecipient(recipientInput);
                }}
                placeholder="ceo@cehta.cl, agregá más con Enter…"
                className="block w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline transition-shadow placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
              <p className="text-[11px] text-ink-500">
                Usá Enter, coma o espacio para agregar cada email.
              </p>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                disabled={send.isPending}
                onClick={onSendClick}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Send className="h-4 w-4" strokeWidth={1.5} />
                )}
                Enviar ahora
              </button>
              <button
                type="button"
                onClick={() => preview.refetch()}
                disabled={preview.isFetching}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50"
              >
                <Mail className="h-4 w-4" strokeWidth={1.5} />
                Recalcular preview
              </button>
            </div>

            {send.isError &&
              send.error instanceof ApiError &&
              send.error.status === 503 && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning ring-1 ring-warning/20">
                  <AlertTriangle
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.5}
                  />
                  <span>
                    Resend no está configurado. Setear
                    <code className="mx-1 rounded bg-warning/20 px-1 py-0.5">
                      RESEND_API_KEY
                    </code>
                    en el backend.
                  </span>
                </div>
              )}
          </Surface.Body>
        </Surface>

        {/* Right column: iframe preview */}
        <Surface padding="none" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <div>
              <p className="text-sm font-semibold tracking-tight text-ink-900">
                Preview HTML del email
              </p>
              <p className="text-[11px] text-ink-500">
                Render exacto que recibe el CEO · 600px width
              </p>
            </div>
            {preview.data && (
              <Badge variant="neutral">
                {preview.data.empresas.length} empresas
              </Badge>
            )}
          </div>
          <div className="bg-[#f7f7f8] p-4">
            {iframeUrl ? (
              <iframe
                src={iframeUrl}
                title="Preview Digest CEO"
                width={600}
                height={800}
                style={{
                  border: "none",
                  borderRadius: "12px",
                  background: "#ffffff",
                  margin: "0 auto",
                  display: "block",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }}
              />
            ) : (
              <div className="mx-auto flex h-[800px] w-[600px] items-center justify-center rounded-xl bg-white text-sm text-ink-500">
                {preview.isError ? (
                  <span>No se pudo cargar el preview.</span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      strokeWidth={1.5}
                    />
                    Cargando preview…
                  </span>
                )}
              </div>
            )}
          </div>
        </Surface>
      </div>

      {/* JSON tree toggle */}
      <Surface>
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          {showJson ? (
            <ChevronDown className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
          )}
          <span className="text-sm font-semibold tracking-tight text-ink-900">
            Previsualización JSON (payload)
          </span>
        </button>
        {showJson && (
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-ink-100/40 p-4 text-[11px] leading-relaxed text-ink-700">
            {preview.data
              ? JSON.stringify(preview.data, null, 2)
              : preview.isError
                ? "// no disponible"
                : "// cargando…"}
          </pre>
        )}
      </Surface>
    </div>
  );
}
