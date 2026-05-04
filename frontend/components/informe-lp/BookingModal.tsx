"use client";

/**
 * BookingModal — embed de Cal.com / Calendly / Google Appointments.
 *
 * Si `bookingUrl` viene configurado en el backend (env BOOKING_URL),
 * el LP puede agendar SIN salir del informe — modal con iframe.
 *
 * Si NO hay URL, fallback al mailto: clásico (CTASection ya lo maneja).
 *
 * Tracking:
 *   - tipo='agendar_click' al abrir el modal (count CTA conversion)
 *   - Detección del booking confirmation del provider via postMessage
 *     (Cal.com manda `__cal_iframe_ready` y `cal:bookingSuccessful` —
 *     interceptamos para mostrar mensaje custom y track conversion).
 */
import { useEffect } from "react";
import { X, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  bookingUrl: string;
  ownerName?: string;
  onBookingSuccess?: () => void;
}

export function BookingModal({
  open,
  onClose,
  bookingUrl,
  ownerName,
  onBookingSuccess,
}: Props) {
  // Listener para mensajes del iframe (Cal.com / Calendly)
  useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      // Cal.com: { type: 'cal:bookingSuccessful', data: {...} }
      // Calendly: { event: 'calendly.event_scheduled', payload: {...} }
      const data = e.data;
      if (typeof data !== "object" || !data) return;
      const isCalSuccess =
        (data as { type?: string }).type === "cal:bookingSuccessful";
      const isCalendlySuccess =
        (data as { event?: string }).event === "calendly.event_scheduled";
      if (isCalSuccess || isCalendlySuccess) {
        onBookingSuccess?.();
        // Cerrar el modal después de 2s para que el LP vea el confirm
        setTimeout(() => onClose(), 2000);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, onClose, onBookingSuccess]);

  // Esc para cerrar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Detectar provider del URL para ajustar embed params
  const isCalCom = bookingUrl.includes("cal.com");
  const isCalendly = bookingUrl.includes("calendly.com");

  // Cal.com soporta `?embed=true&theme=light&hideEventTypeDetails=false`
  // Calendly soporta `?embed_domain=...&hide_event_type_details=0`
  let iframeUrl = bookingUrl;
  try {
    const url = new URL(bookingUrl);
    if (isCalCom) {
      url.searchParams.set("embed", "true");
      url.searchParams.set("theme", "light");
    } else if (isCalendly) {
      if (typeof window !== "undefined") {
        url.searchParams.set("embed_domain", window.location.hostname);
      }
      url.searchParams.set("hide_event_type_details", "0");
    }
    iframeUrl = url.toString();
  } catch {
    // URL inválida → usar como vino
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl sm:h-[80vh]"
      >
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-hairline bg-white px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              Agendar reunión
            </p>
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
              30 min con {ownerName ?? "Camilo Salazar"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 transition-colors hover:bg-ink-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        {/* Iframe del provider */}
        <div className="relative h-[calc(100%-65px)] w-full bg-ink-50">
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2
              className="h-8 w-8 animate-spin text-cehta-green"
              strokeWidth={1.5}
            />
          </div>
          <iframe
            src={iframeUrl}
            title={`Agendar con ${ownerName ?? "Camilo"}`}
            className="relative z-10 h-full w-full border-0"
            allow="camera; microphone; autoplay"
          />
        </div>
      </div>
    </div>
  );
}
