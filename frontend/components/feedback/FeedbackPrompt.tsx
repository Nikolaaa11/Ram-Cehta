"use client";

/**
 * FeedbackPrompt — NPS in-app de 1-click (Round 152t).
 *
 * Aplica "Comunicación Bidireccional" de Ray Gallegos (Clase 4 p36):
 *   "Esta es muy relevante para escuchar a los diferentes actores,
 *    obtener feedback y ver lo que piensan y sienten."
 *
 * Uso:
 *   <FeedbackPrompt actionType="voucher.firmar" />
 *
 * Aparece como toast pequeño abajo-derecha tras una acción crítica.
 * Persiste en localStorage que ya respondió a ese actionType en últimos 14 días.
 */
import { useState, useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import { X } from "lucide-react";

const COOLDOWN_DAYS = 14;
const STORAGE_KEY_PREFIX = "fb-cooldown-";

export function FeedbackPrompt({
  actionType,
  question = "¿Qué tan fácil fue esto?",
  context,
}: {
  actionType: string;
  question?: string;
  context?: Record<string, unknown>;
}) {
  const { session } = useSession();
  const [visible, setVisible] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [comment, setComment] = useState("");
  const [expandComment, setExpandComment] = useState<number | null>(null);

  // Solo mostrar si no respondió a este actionType en últimos 14 días
  useEffect(() => {
    if (typeof window === "undefined") return;
    const k = STORAGE_KEY_PREFIX + actionType;
    const lastTs = Number(localStorage.getItem(k) || "0");
    const daysSince = (Date.now() - lastTs) / (1000 * 60 * 60 * 24);
    if (daysSince >= COOLDOWN_DAYS) {
      // pequeño delay para no aparecer al toque
      const t = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(t);
    }
  }, [actionType]);

  const submit = async (score: number, finalComment: string | null = null) => {
    if (!session) return;
    try {
      await apiClient.post(
        "/me/feedback",
        { action_type: actionType, score, comment: finalComment, context },
        session,
      );
      setSubmitted(true);
      localStorage.setItem(STORAGE_KEY_PREFIX + actionType, String(Date.now()));
      setTimeout(() => setVisible(false), 1200);
    } catch {
      // si falla silenciosamente, no rompe el flujo del user
      setVisible(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 max-w-xs rounded-2xl border border-hairline bg-white p-4 shadow-elevated-lg"
      role="dialog"
      aria-label="Feedback rápido"
    >
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="absolute right-2 top-2 rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-900"
        aria-label="Cerrar"
      >
        <X className="size-4" />
      </button>

      {submitted ? (
        <div className="py-3 text-center">
          <p className="text-2xl">🎉</p>
          <p className="mt-1 text-sm font-medium text-ink-900">¡Gracias!</p>
          <p className="text-xs text-ink-500">Tu feedback ayuda a mejorar.</p>
        </div>
      ) : expandComment !== null ? (
        <div>
          <p className="text-sm font-medium text-ink-900">{question}</p>
          <p className="mt-1 text-xs text-ink-500">
            Cuéntanos brevemente (opcional)
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="¿Qué pasó? ¿Qué mejoraría?"
            maxLength={500}
            className="mt-2 w-full resize-none rounded-lg border border-hairline px-2 py-1.5 text-xs focus:border-cehta-green focus:outline-none"
            rows={3}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => submit(expandComment, comment || null)}
              className="flex-1 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-cehta-green-700"
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={() => submit(expandComment, null)}
              className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              Saltar
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-ink-900">{question}</p>
          <div className="mt-3 flex justify-around gap-2">
            <button
              type="button"
              onClick={() => setExpandComment(1)}
              className="flex flex-col items-center gap-1 rounded-xl p-2 transition-transform hover:scale-110"
              title="Difícil"
            >
              <span className="text-3xl">😞</span>
              <span className="text-[10px] font-medium text-ink-500">Difícil</span>
            </button>
            <button
              type="button"
              onClick={() => submit(2)}
              className="flex flex-col items-center gap-1 rounded-xl p-2 transition-transform hover:scale-110"
              title="Ok"
            >
              <span className="text-3xl">😐</span>
              <span className="text-[10px] font-medium text-ink-500">Ok</span>
            </button>
            <button
              type="button"
              onClick={() => submit(3)}
              className="flex flex-col items-center gap-1 rounded-xl p-2 transition-transform hover:scale-110"
              title="Fácil"
            >
              <span className="text-3xl">😊</span>
              <span className="text-[10px] font-medium text-ink-500">Fácil</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
