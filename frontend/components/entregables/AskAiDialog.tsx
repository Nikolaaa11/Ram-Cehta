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
import { cn } from "@/lib/utils";

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output_preview: string;
  status: "running" | "done";
}

interface StreamingState {
  iteration: number;
  toolCalls: ToolCall[];
  thinking: string;
  answer: string;
  done: boolean;
  tokens: { input: number; output: number };
  error: string | null;
}

const INITIAL_STREAM: StreamingState = {
  iteration: 0,
  toolCalls: [],
  thinking: "",
  answer: "",
  done: false,
  tokens: { input: 0, output: 0 },
  error: null,
};

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

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function AskAiDialog({ open, onOpenChange, initialQuestion }: Props) {
  const { session } = useSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<StreamingState>(INITIAL_STREAM);
  const [showTools, setShowTools] = useState(true); // default expanded para ver tools en vivo
  // V5.2 — Modo escritura (Claude puede mutar datos)
  const [writeMode, setWriteMode] = useState(false);

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setStream(INITIAL_STREAM);
      if (initialQuestion) setQuestion(initialQuestion);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuestion("");
      // Si hay stream activo, abortarlo al cerrar
      abortRef.current?.abort();
    }
  }, [open, initialQuestion]);

  const submit = async () => {
    const q = question.trim();
    if (!q || !session || loading) return;
    setLoading(true);
    setStream(INITIAL_STREAM);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/ai/ask/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: q, write_mode: writeMode }),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 503) {
          toast.error("AI no configurado. Setear ANTHROPIC_API_KEY en backend.");
        } else {
          toast.error(`HTTP ${res.status}`);
        }
        setLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        toast.error("Streaming no soportado en este browser");
        setLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames: each event termina en \n\n
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";  // último puede ser incompleto

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6); // strip "data: "
          try {
            const evt = JSON.parse(payload) as Record<string, unknown>;
            handleStreamEvent(evt);
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // user cancelled — no toast
      } else {
        toast.error(
          err instanceof Error ? err.message : "Error en streaming AI",
        );
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleStreamEvent = (evt: Record<string, unknown>) => {
    const type = evt.type as string;
    if (type === "iteration") {
      setStream((s) => ({ ...s, iteration: Number(evt.n) || 0 }));
    } else if (type === "tool_use") {
      const tool = String(evt.tool || "");
      const input = (evt.input as Record<string, unknown>) || {};
      setStream((s) => ({
        ...s,
        toolCalls: [
          ...s.toolCalls,
          { tool, input, output_preview: "", status: "running" },
        ],
      }));
    } else if (type === "tool_result") {
      const tool = String(evt.tool || "");
      const preview = String(evt.preview || "");
      setStream((s) => {
        // Actualiza el último call con tool name matching y status running
        const next = [...s.toolCalls];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i]!.tool === tool && next[i]!.status === "running") {
            next[i] = { ...next[i]!, output_preview: preview, status: "done" };
            break;
          }
        }
        return { ...s, toolCalls: next };
      });
    } else if (type === "thinking") {
      setStream((s) => ({
        ...s,
        thinking: s.thinking
          ? `${s.thinking}\n${String(evt.text || "")}`
          : String(evt.text || ""),
      }));
    } else if (type === "answer") {
      setStream((s) => ({ ...s, answer: String(evt.text || "") }));
    } else if (type === "done") {
      const tokens = (evt.tokens as { input: number; output: number }) || {
        input: 0,
        output: 0,
      };
      setStream((s) => ({
        ...s,
        done: true,
        iteration: Number(evt.iterations) || s.iteration,
        tokens,
      }));
    } else if (type === "error") {
      setStream((s) => ({ ...s, error: String(evt.detail || "Error AI") }));
      toast.error(String(evt.detail || "Error AI"));
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const hasContent =
    stream.iteration > 0 ||
    stream.toolCalls.length > 0 ||
    stream.answer !== "" ||
    stream.error !== null;

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

        {/* Quick prompts (solo cuando no hay nada que mostrar) */}
        {!hasContent && !loading && (
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

        {/* Streaming state — V5.5 */}
        {(loading || hasContent) && (
          <div className="mt-4 space-y-3">
            {/* Status header */}
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                stream.error
                  ? "border-negative/30 bg-negative/5 text-negative"
                  : stream.done
                    ? "border-cehta-green/30 bg-cehta-green/5 text-cehta-green"
                    : "border-info/30 bg-info/5 text-info",
              )}
            >
              {loading && !stream.done ? (
                <Brain
                  className="h-3.5 w-3.5 animate-pulse"
                  strokeWidth={1.75}
                />
              ) : stream.error ? (
                <span className="text-base">⚠</span>
              ) : (
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              <span className="flex-1 font-medium">
                {stream.error
                  ? `Error: ${stream.error}`
                  : stream.done
                    ? `Listo · ${stream.iteration} iteración${stream.iteration !== 1 ? "es" : ""} · ${stream.tokens.input + stream.tokens.output} tokens`
                    : `Iteración ${stream.iteration}${stream.toolCalls.length > 0 ? ` · ${stream.toolCalls.length} tool${stream.toolCalls.length !== 1 ? "s" : ""}` : ""}`}
              </span>
              {loading && (
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-md border border-current px-2 py-0.5 text-[10px] font-medium hover:bg-current/10"
                >
                  Cancelar
                </button>
              )}
            </div>

            {/* Tool calls live feed */}
            {stream.toolCalls.length > 0 && (
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
                  <Wrench
                    className="h-3.5 w-3.5 text-info"
                    strokeWidth={1.75}
                  />
                  <span className="flex-1 font-medium text-ink-700">
                    Tools en ejecución ({stream.toolCalls.length})
                  </span>
                  <span className="text-[10px] text-ink-400">
                    {stream.toolCalls.filter((t) => t.status === "done").length}{" "}
                    / {stream.toolCalls.length}
                  </span>
                </button>
                {showTools && (
                  <div className="space-y-2 border-t border-hairline px-3 py-2">
                    {stream.toolCalls.map((tc, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-lg px-2.5 py-2 text-[11px] transition-colors",
                          tc.status === "running"
                            ? "bg-info/5 ring-1 ring-info/20"
                            : "bg-ink-50/50",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {tc.status === "running" ? (
                            <Loader2
                              className="h-3 w-3 animate-spin text-info"
                              strokeWidth={2}
                            />
                          ) : (
                            <span className="text-positive">✓</span>
                          )}
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 font-mono font-medium",
                              tc.status === "running"
                                ? "bg-info/15 text-info"
                                : "bg-positive/15 text-positive",
                            )}
                          >
                            {tc.tool}
                          </span>
                          {Object.keys(tc.input).length > 0 && (
                            <span className="font-mono text-[10px] text-ink-500">
                              ({JSON.stringify(tc.input)})
                            </span>
                          )}
                        </div>
                        {tc.output_preview && (
                          <pre
                            className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-ink-600"
                            title={tc.output_preview}
                          >
                            → {tc.output_preview.slice(0, 200)}
                            {tc.output_preview.length > 200 ? "…" : ""}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Thinking text (Claude muestra texto entre tools) */}
            {stream.thinking && !stream.answer && (
              <div className="rounded-xl border border-info/20 bg-info/5 px-3 py-2 text-xs italic text-ink-600">
                <Brain
                  className="mr-1 inline h-3 w-3"
                  strokeWidth={1.75}
                />
                {stream.thinking}
              </div>
            )}

            {/* Answer final */}
            {stream.answer && (
              <div className="rounded-xl border border-cehta-green/30 bg-cehta-green/5 px-4 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                  <Sparkles className="h-3 w-3" strokeWidth={2} />
                  Respuesta
                </p>
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-ink-900">
                  {stream.answer}
                </div>
              </div>
            )}

            {/* CTA Nueva pregunta cuando done */}
            {stream.done && !loading && (
              <button
                type="button"
                onClick={() => {
                  setStream(INITIAL_STREAM);
                  setQuestion("");
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                <Send className="h-3 w-3" strokeWidth={1.75} />
                Nueva pregunta
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
