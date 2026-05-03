/**
 * Helpers para combinar eventos manuales del calendario con obligaciones
 * sintetizadas (hitos del Gantt, entregables regulatorios, F29, OCs, etc.).
 *
 * Estrategia: convertimos cada ObligationItem a un CalendarEventRead virtual
 * con un `event_id` negativo (para no chocar con IDs reales) y una marca
 * `auto_generado=true` para que el frontend sepa que viene de otra fuente.
 *
 * Esto deja la vista Mes intacta — solo recibe la lista combinada como
 * `events` y los renderiza con su `tipo` correspondiente.
 */
import type {
  CalendarEventRead,
  ObligationItem,
  TipoEvento,
} from "@/lib/api/schema";

// Mapeo de ObligationTipo → TipoEvento del modelo (para pasarlos al MonthView).
// Como TipoEvento es un Literal cerrado, usamos casts deliberados.
const OBLIGATION_TO_EVENT_TIPO: Record<string, string> = {
  f29: "f29",
  legal: "legal",
  oc: "oc",
  suscripcion: "suscripcion",
  event: "otro",
  hito: "hito",
  entregable: "entregable",
};

export function obligationToCalendarEvent(
  obl: ObligationItem,
): CalendarEventRead {
  // Convertir due_date (YYYY-MM-DD) a ISO datetime para fecha_inicio
  const fechaInicioIso = `${obl.due_date}T09:00:00.000Z`;
  // event_id negativo determinístico (hash simple del id string)
  let hash = 0;
  for (let i = 0; i < obl.id.length; i++) {
    hash = (hash * 31 + obl.id.charCodeAt(i)) | 0;
  }
  const virtualId = -Math.abs(hash);

  // Construir título con el monto si lo tiene
  let titulo = obl.title;
  if (obl.subtitle) {
    titulo = `${obl.title} — ${obl.subtitle}`;
  }

  return {
    event_id: virtualId,
    titulo: titulo.slice(0, 200),
    descripcion: obl.subtitle ?? null,
    tipo: OBLIGATION_TO_EVENT_TIPO[obl.tipo] ?? "otro",
    empresa_codigo: obl.empresa_codigo ?? null,
    fecha_inicio: fechaInicioIso,
    fecha_fin: null,
    todo_el_dia: true,
    recurrencia: null,
    notificar_dias_antes: 0,
    notificar_emails: null,
    auto_generado: true,
    completado: false,
    created_at: fechaInicioIso,
    updated_at: fechaInicioIso,
  };
}

/**
 * Combina eventos manuales con obligaciones sintetizadas, evitando
 * duplicados — si una obligación ya tiene un evento manual con misma
 * empresa+fecha+tipo, prevalece el manual.
 */
export function mergeEventsWithObligations(
  manualEvents: CalendarEventRead[],
  obligations: ObligationItem[],
): CalendarEventRead[] {
  const out = [...manualEvents];

  // Set de keys de eventos manuales para detectar duplicados
  const manualKeys = new Set(
    manualEvents.map(
      (ev) =>
        `${ev.tipo}:${ev.empresa_codigo ?? ""}:${ev.fecha_inicio.slice(0, 10)}`,
    ),
  );

  for (const obl of obligations) {
    const key = `${OBLIGATION_TO_EVENT_TIPO[obl.tipo] ?? "otro"}:${
      obl.empresa_codigo ?? ""
    }:${obl.due_date}`;
    if (manualKeys.has(key)) continue;
    out.push(obligationToCalendarEvent(obl));
  }

  return out;
}
