"use client";

/**
 * ShareCard — el motor viral.
 *
 * Modal que permite al LP "pasarle el reporte a un colega que invierte".
 * El sistema crea un child_token con parent_token = current → cada
 * cadena se trackea y el LP recibe notificaciones positivas:
 *   - "Pablo abrió tu link 👀"
 *   - "Pablo agendó café con Camilo 🎉"
 *
 * Endpoint público: POST /informes-lp/by-token/{token}/share
 */
import { useState } from "react";
import { Gift, Loader2, X, Check, Copy, Mail } from "lucide-react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface Props {
  token: string;
  onClose: () => void;
}

interface ShareResponse {
  child_token: string;
  child_url: string;
  parent_token: string;
  message: string;
}

export function ShareCard({ token, onClose }: Props) {
  const [step, setStep] = useState<"form" | "success">("form");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim() || !email.trim()) return;
    if (!email.includes("@")) {
      setError("Email inválido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/informes-lp/by-token/${token}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre_destinatario: nombre.trim(),
            email_destinatario: email.trim(),
            mensaje_personal: mensaje.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? `HTTP ${res.status}`);
      }
      const data: ShareResponse = await res.json();
      setResult(data);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.child_url) return;
    try {
      await navigator.clipboard.writeText(result.child_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 transition-colors hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="space-y-5 p-8">
            {/* Header */}
            <header className="flex items-start gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
                <Gift className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tight text-ink-900">
                  Pasalo a un colega que invierte
                </h2>
                <p className="mt-1 text-sm text-ink-600">
                  Si conocés a alguien que le calce este fondo, mandale el
                  reporte. Te avisamos cuando lo abra.
                </p>
              </div>
            </header>

            {error && (
              <div className="rounded-xl border border-negative/20 bg-negative/5 px-4 py-3 text-sm text-negative">
                {error}
              </div>
            )}

            {/* Form */}
            <div className="space-y-3">
              <Field
                label="Nombre del colega"
                value={nombre}
                onChange={setNombre}
                placeholder="Pablo Klein"
                required
              />
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="pablo@klein.cl"
                required
              />
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Mensaje personal (opcional)
                </label>
                <textarea
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Pablo, mirá esto. PE chileno con tracción real en BESS y minería ESG."
                  className="w-full rounded-xl border-0 bg-ink-50 px-4 py-3 text-sm ring-1 ring-hairline transition-all focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
                <p className="mt-1 text-right text-[10px] text-ink-400">
                  {mensaje.length}/500
                </p>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !nombre.trim() || !email.includes("@")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Enviando…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" strokeWidth={2} />
                  Enviar a {nombre.trim() || "tu colega"}
                </>
              )}
            </button>

            {/* Privacy note */}
            <p className="text-[10px] italic text-ink-500">
              Tu colega recibe un link único. Cuando lo abre, te lo
              notificamos. No usamos su email para nada más.
            </p>
          </form>
        )}

        {step === "success" && result && (
          <div className="space-y-5 p-8 text-center">
            <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-positive/15 text-positive">
              <Check className="h-8 w-8" strokeWidth={2} />
            </span>
            <div>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                ¡Enviado!
              </h2>
              <p className="mt-2 text-sm text-ink-600">
                {result.message}
              </p>
            </div>

            {/* Link compartible directo (alternativa al email) */}
            <div className="rounded-2xl bg-ink-50/60 p-4 text-left">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
                O compartilo vos mismo
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={result.child_url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 rounded-lg border-0 bg-white px-3 py-2 font-mono text-xs text-ink-700 ring-1 ring-hairline"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-2 text-xs font-medium text-white hover:bg-cehta-green-700"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                      Copiar
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-ink-400">
                Podés mandarlo por WhatsApp, LinkedIn, o donde prefieras.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl border border-hairline bg-white px-5 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border-0 bg-ink-50 px-4 py-3 text-sm ring-1 ring-hairline transition-all focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
      />
    </div>
  );
}
