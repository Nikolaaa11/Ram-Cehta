"use client";

/**
 * AiDataQAWidget — input de pregunta natural sobre el estado del fondo.
 *
 * El user escribe "¿cuánto debe TRONGKAI a proveedores?", click "Preguntar".
 * Backend computa snapshot + pasa a Claude → respuesta cita números reales.
 *
 * Diseño Apple-tier:
 *   - Input grande con placeholder rotativo de ejemplos
 *   - Respuesta en card abajo con typewriter effect
 *   - Histórico de las últimas 5 preguntas en sidebar (localStorage)
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Sparkles,
  Send,
  Loader2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface DataQAResponse {
  answer: string;
  snapshot: Record<string, unknown>;
  model: string;
  tokens_input: number;
  tokens_output: number;
}

const EXAMPLE_QUESTIONS = [
  "¿Cuántos vouchers tengo PENDING de firma?",
  "¿Qué F29 vencen en los próximos 14 días?",
  "¿Cuánto monto está pendiente de aprobación?",
  "¿Cuántos emails sin clasificar tengo?",
  "¿Cuántas OCs están pendientes de pago?",
];

export function AiDataQAWidget() {
  const { session } = useSession();
  const [question, setQuestion] = useState("");
  const [exampleIdx, setExampleIdx] = useState(0);

  const askMut = useMutation({
    mutationFn: (q: string) =>
      apiClient.post<DataQAResponse>(
        "/ai/data-qa",
        { question: q },
        session,
      ),
  });

  const submit = () => {
    const q = question.trim();
    if (q.length < 3) return;
    askMut.mutate(q);
  };

  const reset = () => {
    setQuestion("");
    askMut.reset();
  };

  return (
    <section className="rounded-3xl border border-hairline bg-gradient-to-br from-white to-cehta-green/5 p-6 shadow-card dark:border-ink-800 dark:from-ink-900 dark:to-cehta-green/10">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green ring-1 ring-cehta-green/20">
          <Sparkles className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Pregunta a Claudia Data
          </p>
          <h3 className="mt-0.5 font-display text-lg font-semibold text-ink-900 dark:text-ink-100">
            ¿Qué querés saber del fondo?
          </h3>
          <p className="mt-1 text-xs text-ink-500">
            Pregunta natural sobre vouchers, F29, F22, OCs, inbox.
            Claude responde citando los números actuales de la DB.
          </p>
        </div>
      </div>

      {/* Input */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={EXAMPLE_QUESTIONS[exampleIdx]}
          onFocus={() => setExampleIdx((i) => (i + 1) % EXAMPLE_QUESTIONS.length)}
          className="flex-1 rounded-xl border-0 bg-white px-4 py-2.5 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green dark:bg-ink-800 dark:text-ink-100 dark:ring-ink-700"
        />
        <button
          type="button"
          onClick={submit}
          disabled={askMut.isPending || question.trim().length < 3}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {askMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.75} />
          )}
          Preguntar
        </button>
      </div>

      {/* Respuesta */}
      {askMut.isSuccess && askMut.data && (
        <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-hairline dark:bg-ink-800 dark:ring-ink-700">
          <p className="whitespace-pre-wrap text-sm text-ink-800 leading-relaxed">
            {askMut.data.answer}
          </p>
          <div className="mt-3 flex items-center justify-between text-[10px] text-ink-400">
            <span>
              {askMut.data.model} · {askMut.data.tokens_input}↓{" "}
              {askMut.data.tokens_output}↑ tokens
            </span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 hover:text-cehta-green"
            >
              <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
              Nueva pregunta
            </button>
          </div>
        </div>
      )}

      {askMut.isError && (
        <div className="mt-5 flex items-start gap-2 rounded-2xl bg-red-50 p-4 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-semibold">No se pudo responder</p>
            <p className="mt-0.5">
              {askMut.error instanceof ApiError
                ? askMut.error.detail
                : "Error desconocido"}
            </p>
          </div>
        </div>
      )}

      {/* Hint si user no escribió nada */}
      {!askMut.data && !askMut.isPending && !askMut.isError && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.slice(0, 3).map((eq) => (
            <button
              key={eq}
              type="button"
              onClick={() => {
                setQuestion(eq);
              }}
              className="rounded-full bg-white px-3 py-1 text-[11px] text-ink-600 ring-1 ring-hairline hover:bg-cehta-green/5 hover:text-cehta-green hover:ring-cehta-green/30"
            >
              {eq}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
