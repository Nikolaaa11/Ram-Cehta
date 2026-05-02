"use client";

/**
 * ActaGeneradoraDialog — V5 fase 2.
 *
 * Modal que dispara `POST /ai/acta/generate` con Claude AI generando un
 * draft de acta del Comité de Vigilancia a partir de los datos reales
 * del sistema. Renderiza el markdown resultante con opciones de:
 *   - Copiar al portapapeles
 *   - Descargar como archivo .md
 *   - Imprimir directo
 *
 * El usuario revisa, edita en su editor preferido (Google Docs, Word,
 * Notion), agrega los firmantes, y lo lleva a la reunión.
 */
import { useState } from "react";
import {
  Brain,
  Building2,
  Check,
  Copy,
  Download,
  FileSignature,
  Loader2,
  Printer,
  Sparkles,
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
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";

interface ActaResponse {
  markdown: string;
  generated_at: string;
  empresa: string | null;
  tokens: { input: number; output: number };
  data_summary: {
    ytd_total: number;
    ytd_entregados: number;
    tasa_cumplimiento: number;
    vencidos_count: number;
    proximos_30d_count: number;
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si se pasa, genera acta filtrada a esta empresa. */
  defaultEmpresa?: string;
}

export function ActaGeneradoraDialog({
  open,
  onOpenChange,
  defaultEmpresa,
}: Props) {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState<string>(defaultEmpresa ?? "");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ActaResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!session || loading) return;
    setLoading(true);
    setResponse(null);
    try {
      const res = await apiClient.post<ActaResponse>(
        "/ai/acta/generate",
        { empresa: empresa.trim() || null },
        session,
      );
      setResponse(res);
      toast.success("Acta generada con AI");
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(
          "AI no configurado. Setear ANTHROPIC_API_KEY en backend.",
        );
      } else {
        toast.error(
          err instanceof ApiError ? err.detail : "Error generando acta",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(response.markdown);
      setCopied(true);
      toast.success("Markdown copiado al portapapeles");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar — copialo manualmente");
    }
  };

  const download = () => {
    if (!response) return;
    const blob = new Blob([response.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    const empresaSlug = response.empresa
      ? `-${response.empresa.toLowerCase()}`
      : "";
    link.download = `acta-cv${empresaSlug}-${stamp}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Archivo descargado");
  };

  const printActa = () => {
    if (!response) return;
    // Abre una ventana nueva con solo el markdown renderizado simple
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Acta CV — Borrador</title>
<style>
  body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.6;color:#1f2937;}
  h1{font-size:24px;border-bottom:2px solid #111827;padding-bottom:8px;}
  h2{font-size:18px;margin-top:24px;color:#111827;}
  h3{font-size:15px;margin-top:16px;}
  p{margin:8px 0;}
  ul,ol{margin:8px 0;padding-left:24px;}
  li{margin:4px 0;}
  code{background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:0.9em;}
  blockquote{border-left:3px solid #d1d5db;margin:16px 0;padding:4px 16px;color:#6b7280;}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;}
</style></head><body>
<pre style="white-space:pre-wrap;font-family:Georgia,serif;">${response.markdown.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</pre>
<div class="footer">Generado por AI Asistente · ${new Date(response.generated_at).toLocaleString("es-CL")} · Borrador — requiere revisión y firma</div>
<script>window.print();</script>
</body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature
              className="h-5 w-5 text-cehta-green"
              strokeWidth={1.75}
            />
            Generar borrador de acta · Comité de Vigilancia
          </DialogTitle>
          <DialogDescription>
            Claude analiza el estado regulatorio actual y redacta un borrador
            estructurado de acta. Tu tarea: revisar, editar nombres de
            firmantes, ajustar redacción, firmar.
          </DialogDescription>
        </DialogHeader>

        {/* Form generación */}
        {!response && (
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                <Building2 className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
                Ámbito del acta
              </label>
              <input
                type="text"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Vacío = acta general · O escribí CSL/RHO/DTE/etc."
                className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
              <p className="mt-1 text-[11px] text-ink-500">
                {empresa.trim()
                  ? `Acta scoped a ${empresa.trim().toUpperCase()} — solo entregables de esa empresa.`
                  : "Acta general del FIP CEHTA ESG — incluye todas las empresas + ranking compliance."}
              </p>
            </div>

            <div className="rounded-xl border border-info/20 bg-info/5 p-3 text-[11px] text-ink-700">
              <p className="font-semibold">Lo que va a hacer Claude:</p>
              <ol className="mt-1 list-decimal pl-4 leading-relaxed">
                <li>Pull de datos reales (vencidos, próximos, compliance)</li>
                <li>Estructurar acta formal estilo notarial chileno (markdown)</li>
                <li>Sugerir acuerdos accionables del Comité</li>
                <li>Marcar campos a confirmar con [A confirmar]</li>
              </ol>
              <p className="mt-2 italic text-ink-500">
                Toma ~10-20 segundos. Tokens estimados: ~3000-6000.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && !response && (
          <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-cehta-green/20 bg-cehta-green/5 p-6 text-sm text-ink-700">
            <Brain
              className="h-5 w-5 animate-pulse text-cehta-green"
              strokeWidth={1.75}
            />
            <div>
              <p className="font-medium">Claude está redactando el acta…</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                Analizando datos · Estructurando secciones · Sugiriendo
                acuerdos
              </p>
            </div>
          </div>
        )}

        {/* Response */}
        {response && (
          <div className="mt-4 space-y-3">
            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatTile
                label="YTD entregados"
                value={`${response.data_summary.ytd_entregados}/${response.data_summary.ytd_total}`}
              />
              <StatTile
                label="Tasa cumplimiento"
                value={`${response.data_summary.tasa_cumplimiento.toFixed(1)}%`}
                tone={
                  response.data_summary.tasa_cumplimiento >= 95
                    ? "positive"
                    : response.data_summary.tasa_cumplimiento >= 85
                      ? "warning"
                      : "negative"
                }
              />
              <StatTile
                label="Vencidos"
                value={String(response.data_summary.vencidos_count)}
                tone={
                  response.data_summary.vencidos_count > 0
                    ? "negative"
                    : "positive"
                }
              />
              <StatTile
                label="Próx. 30 días"
                value={String(response.data_summary.proximos_30d_count)}
              />
            </div>

            {/* Markdown preview */}
            <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-hairline bg-white">
              <div className="sticky top-0 flex items-center justify-between border-b border-hairline bg-white/95 px-3 py-1.5 backdrop-blur">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                  <Sparkles className="h-3 w-3" strokeWidth={2} />
                  Borrador generado
                </p>
                <p className="text-[10px] text-ink-500">
                  {response.markdown.split(/\s+/).length} palabras ·{" "}
                  {response.tokens.input + response.tokens.output} tokens
                </p>
              </div>
              <pre className="whitespace-pre-wrap p-4 font-serif text-[13px] leading-relaxed text-ink-900">
                {response.markdown}
              </pre>
            </div>

            <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-[11px] text-ink-700">
              ⚠ Este es un <strong>borrador AI</strong>. Antes de imprimir o
              llevar al Comité, revisá: nombres de asistentes, sentencias
              numéricas vs auditoría externa, formato legal exigido por el
              Reglamento Interno protocolizado.
            </div>
          </div>
        )}

        <DialogFooter>
          {!response ? (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={loading}
                className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {loading ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    strokeWidth={2}
                  />
                ) : (
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                )}
                {loading ? "Generando…" : "Generar acta"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setResponse(null);
                  setEmpresa(defaultEmpresa ?? "");
                }}
                className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40"
              >
                Nuevo
              </button>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                {copied ? (
                  <Check
                    className="h-3.5 w-3.5 text-positive"
                    strokeWidth={2.5}
                  />
                ) : (
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Copiar markdown
              </button>
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                .md
              </button>
              <button
                type="button"
                onClick={printActa}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
              >
                <Printer className="h-3.5 w-3.5" strokeWidth={1.75} />
                Imprimir
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "warning" | "neutral";
}) {
  const accentText =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "warning"
          ? "text-warning"
          : "text-ink-900";
  const borderClass =
    tone === "positive"
      ? "border-positive/30"
      : tone === "negative"
        ? "border-negative/30"
        : tone === "warning"
          ? "border-warning/30"
          : "border-hairline";
  return (
    <div
      className={`rounded-lg border bg-white px-3 py-2 ${borderClass}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={`mt-0.5 text-base font-bold tabular-nums ${accentText}`}>
        {value}
      </p>
    </div>
  );
}
