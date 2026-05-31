"use client";

/**
 * PendingFeedbackPrompt — wrapper global del FeedbackPrompt (R152aa).
 *
 * Algunas acciones (crear voucher → router.push al detalle) desmontan la
 * página antes de que el FeedbackPrompt alcance a aparecer. Solución:
 * la página origen escribe en `sessionStorage` un payload JSON, y este
 * componente — montado en el layout global — lo lee, lo renderiza, y
 * limpia el flag.
 *
 * Uso desde una página origen:
 *   sessionStorage.setItem("pending_feedback", JSON.stringify({
 *     actionType: "voucher.crear",
 *     question: "¿Qué tan fácil fue crear el voucher?",
 *     context: { codigo: "AFIS-0042" },
 *   }));
 *   router.push("/vouchers/42");
 *
 * El componente lo levanta automáticamente del lado destino.
 */
import { useEffect, useState } from "react";
import { FeedbackPrompt } from "./FeedbackPrompt";

const STORAGE_KEY = "pending_feedback";

interface Payload {
  actionType: string;
  question?: string;
  context?: Record<string, unknown>;
}

export function PendingFeedbackPrompt() {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Poll al mount + cada cambio de ruta. Como vivimos en el layout,
    // un setInterval ligero cubre cualquier router.push subsecuente.
    const tick = () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const p = JSON.parse(raw) as Payload;
        if (!p.actionType) return;
        sessionStorage.removeItem(STORAGE_KEY);
        setPayload(p);
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    };
    tick();
    const id = setInterval(tick, 800);
    return () => clearInterval(id);
  }, []);

  if (!payload) return null;
  return (
    <FeedbackPrompt
      key={`${payload.actionType}-${Date.now()}`}
      actionType={payload.actionType}
      question={payload.question}
      context={payload.context}
    />
  );
}

/** Helper para que las páginas registren el feedback antes de navegar. */
export function queueFeedback(payload: Payload) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage puede fallar en modo privado — ignoramos.
  }
}
