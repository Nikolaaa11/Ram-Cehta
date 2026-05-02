"use client";

/**
 * AskAiDialog — V5 fase 1.
 *
 * Modal con caja de pregunta al AI sobre entregables. Usa el endpoint
 * `POST /ai/ask` con tool calling — el modelo ejecuta tools contra la DB
 * y devuelve una respuesta + traza completa de tool calls (transparencia).
 *
 * Quick prompts pre-fabricados para ergonomía:
 *   - "¿Qué entregables tengo esta semana?"
 *   - "¿Cuál empresa tiene peor compliance?"
 *   - "¿Cuántos críticos hay para CSL?"
 *   - "¿Quién es responsable de los CMF?"
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  Loader2,
  Send,
  Sparkles,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output_preview: string;
}

interface AskResponse {
  answer: string;
  tool_calls: ToolCall[];
  iterations: number;
  tokens: { input: number; output: number };
}

const QUICK_PROMPTS = [
  "¿Qué entregables tengo esta semana?",
  "¿Cuál empresa tiene peor compliance?",
  "¿Cuántos entregables críticos hay?",
  "¿Cuáles vencen en los próximos 30 días?",
  "Rankéame las empresas por compliance",
  "¿Qué CMF están pendientes?",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-seed con una pregunta inicial — útil para deep-links. */
  initialQuestion?: string;
}

export function AskAiDialog({ open, onOpenChange, initialQuestion }: Props) {
  const { session } = useSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [showTools, setShowTools] = useState(false);
  // V5.2 — Modo escritura (Claude puede mutar datos)
  const [writeMode, setWriteMode] = useState(false);

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setResponse(null);
      setShowTools(false);
      if (initialQuestion) setQuestion(initialQuestion);
      // Auto-focus en input
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuestion("");
    }
  }, [open, initialQuestion]);

  const submit = async () => {
    const q = question.trim();
    if (!q || !session || loading) return;
    setLoading(true);
    setResponse(null);
    try {
      const res = await apiClient.post<AskResponse>(
        "/ai/ask",
        { question: q, write_mode: writeMode },
        session,
      );
      setResponse(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(
          "AI no configurado. Setear ANTHROPIC_API_KEY en backend.",
        );
      } else {
        toast.error(
          err instanceof ApiError
            ? err.detail
            : "Error consultando al asistente",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles
              className="h-5 w-5 text-cehta-green"
              strokeWidth={1.75}
            />
            Preguntale al asistente
          </DialogTitle>
          <DialogDescription>
            Hace una pregunta sobre tus entregables, compliance o pipeline.
            Claude consulta la base de datos directamente y responde con
            datos reales — sin inventar números.
          </DialogDescription>
        </DialogHeader>

        {/* Input */}
        <div className="mt-4">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
              placeholder="Ej: ¿Cuántos CMF están pendientes para esta semana?"
              disabled={loading}
              className="w-full resize-none rounded-xl bg-white px-3 py-2.5 pr-10 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!question.trim() || loading}
              aria-label="Enviar pregunta"
              className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cehta-green text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-ink-500">
            Presioná{" "}
            <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[10px]">
              Cmd
            </kbd>
            {" + "}
            <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            para enviar.
          </p>

          {/* V5.2 — Write mode toggle */}
          <button
            type="button"
            onClick={() => setWriteMode((v) => !v)}
            className={cn(
              "mt-2 flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
              writeMode
                ? "border-warning/40 bg-warning/5"
                : "border-hairline bg-white hover:bg-ink-50",
            )}
          >
            <AlertTriangle
              className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                writeMode ? "text-warning" : "text-ink-400",
              )}
              strokeWidth={1.75}
            />
            <div className="flex-1">
              <p
                className={cn(
                  "text-[11px] font-semibold",
                  writeMode ? "text-warning" : "text-ink-700",
                )}
              >
                Modo escritura{writeMode ? " · ACTIVO" : " (off)"}
              </p>
              <p className="text-[10px] text-ink-500">
                {writeMode
                  ? "Claude PUEDE mutar datos (marcar entregables). Usá frases explícitas como 'marcá X como entregado'. Cada mutación queda en audit log."
                  : "Click para habilitar mutaciones. Sin esto, Claude solo puede leer."}
              </p>
            </div>
            <div
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                writeMode ? "bg-warning" : "bg-ink-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all",
                  writeMode ? "left-[18px]" : "left-0.5",
                )}
              />
            </div>
          </button>
        </div>

        {/* Quick prompts (solo cuando no hay respuesta) */}
        {!response && !loading && (
          <div className="mt-3">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Sugerencias
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setQuestion(p);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 transition-colors hover:bg-cehta-green/5 hover:text-cehta-green hover:ring-1 hover:ring-cehta-green/30"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-cehta-green/20 bg-cehta-green/5 px-3 py-3 text-sm text-ink-700">
            <Brain
              className="h-4 w-4 animate-pulse text-cehta-green"
              strokeWidth={1.75}
            />
            <span>
              Consultando la base de datos…{" "}
              <span className="text-ink-500">
                puede tomar unos segundos.
              </span>
            </span>
          </div>
        )}

        {/* Response */}
        {response && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-cehta-green/30 bg-cehta-green/5 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                  <Sparkles className="h-3 w-3" strokeWidth={2} />
                  Respuesta
                </p>
                <p className="text-[10px] text-ink-500">
                  {response.iterations} iteración
                  {response.iterations !== 1 ? "es" : ""} ·{" "}
                  {response.tokens.input + response.tokens.output} tokens
                </p>
              </div>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-ink-900">
                {response.answer}
              </div>
            </div>

            {response.tool_calls.length > 0 && (
              <div className="rounded-xl border border-hairline bg-white">
                <button
                  type="button"
                  onClick={() => setShowTools((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-ink-50"
                >
                  {showTools ? (
                    <ChevronDown
                      className="h-3 w-3 text-ink-400"
                      strokeWidth={2}
                    />
                  ) : (
                    <ChevronRight
                      className="h-3 w-3 text-ink-400"
                      strokeWidth={2}
                    />
                  )}
                  <Wrench className="h-3.5 w-3.5 text-info" strokeWidth={1.75} />
                  <span className="flex-1 font-medium text-ink-700">
                    Herramientas usadas ({response.tool_calls.length})
                  </span>
                  <span className="text-[10px] text-ink-400">
                    transparencia
                  </span>
                </button>
                {showTools && (
                  <div className="space-y-2 border-t border-hairline px-3 py-2">
                    {response.tool_calls.map((tc, i) => (
                      <div
                        key={i}
                        className="rounded-lg bg-ink-50/50 px-2.5 py-2 text-[11px]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-info/15 px-1.5 py-0.5 font-mono font-medium text-info">
                            {tc.tool}
                          </span>
                          {Object.keys(tc.input).length > 0 && (
                            <span className="font-mono text-[10px] text-ink-500">
                              ({JSON.stringify(tc.input)})
                            </span>
                          )}
                        </div>
                        <pre
                          className={cn(
                            "mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-ink-600",
                          )}
                          title={tc.output_preview}
                        >
                          → {tc.output_preview.slice(0, 200)}
                          {tc.output_preview.length > 200 ? "…" : ""}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setResponse(null);
                setQuestion("");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              Nueva pregunta
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
