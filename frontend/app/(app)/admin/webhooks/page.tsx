"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Webhook,
  Trash2,
  Send,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import {
  useWebhookSubscriptions,
  useWebhookEventTypes,
  useCreateWebhook,
  useDeleteWebhook,
  useUpdateWebhook,
  useTestWebhook,
  useWebhookDeliveries,
  type WebhookEventType,
  type WebhookSubscriptionWithSecret,
  type WebhookDeliveryRead,
} from "@/hooks/use-webhooks";

type DeliveryRow = WebhookDeliveryRead;

/**
 * Lista de event types disponibles + estado de wiring real.
 *
 * `wired=true` → el handler del backend dispara este event en mutaciones
 * reales. Si está `false`, podés crear la suscripción pero nunca llegan
 * eventos (excepto via "test" manual).
 *
 * Wiring verificado en commits 23c0019, 10ed75e, 24635b4.
 */
const EVENT_LABELS: Record<string, { label: string; wired: boolean }> = {
  "oc.created": { label: "OC creada", wired: true },
  "oc.paid": { label: "OC pagada (full o parcial)", wired: true },
  "oc.cancelled": { label: "OC anulada", wired: true },
  "f29.created": { label: "F29 creada", wired: true },
  "f29.due": { label: "F29 vence pronto (≤7d)", wired: true },
  "f29.paid": { label: "F29 pagado", wired: true },
  "legal.created": { label: "Doc legal creado", wired: true },
  "legal.due": { label: "Contrato vence pronto (≤30d)", wired: true },
  "trabajador.created": { label: "Trabajador creado", wired: true },
  "trabajador.deleted": { label: "Trabajador eliminado", wired: true },
  "lp.created": { label: "LP creado", wired: true },
  "lp_document.created": { label: "Doc de LP creado", wired: true },
  "entregable.due": { label: "Entregable regulatorio vence (≤7d)", wired: true },
  "etl.completed": { label: "ETL Dropbox completado", wired: true },
  "etl.failed": { label: "ETL Dropbox falló", wired: true },
  "audit.high_severity": { label: "Cambio crítico (auditoría)", wired: false },
  test: { label: "Test (manual)", wired: true },
};

const eventLabel = (evt: string): string =>
  EVENT_LABELS[evt]?.label ?? evt;

interface FormState {
  name: string;
  target_url: string;
  description: string;
  events: Set<WebhookEventType>;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  target_url: "",
  description: "",
  events: new Set(),
  active: true,
};

export default function WebhooksPage() {
  const subsQ = useWebhookSubscriptions();
  const eventsQ = useWebhookEventTypes();
  const createMut = useCreateWebhook();
  const deleteMut = useDeleteWebhook();
  const updateMut = useUpdateWebhook();
  const testMut = useTestWebhook();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, events: new Set() });
  const [createdSecret, setCreatedSecret] =
    useState<WebhookSubscriptionWithSecret | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [openDelivery, setOpenDelivery] = useState<DeliveryRow | null>(null);

  const deliveriesQ = useWebhookDeliveries(openDeliveries);

  // Stats agregadas: success rate, total, last delivery
  const deliveryStats = useMemo(() => {
    const items = deliveriesQ.data?.items ?? [];
    const total = items.length;
    if (total === 0) {
      return { total: 0, success: 0, failed: 0, pending: 0, successRate: 0 };
    }
    let success = 0;
    let failed = 0;
    let pending = 0;
    for (const d of items) {
      if (d.status_code === null || d.status_code === undefined) {
        pending++;
      } else if (d.status_code >= 200 && d.status_code < 300) {
        success++;
      } else {
        failed++;
      }
    }
    return {
      total,
      success,
      failed,
      pending,
      successRate: Math.round((success / total) * 100),
    };
  }, [deliveriesQ.data]);

  const allEvents = (eventsQ.data?.events ?? []) as WebhookEventType[];

  const submit = async () => {
    if (!form.name || !form.target_url || form.events.size === 0) {
      toast.error("Completá nombre, URL y al menos 1 evento");
      return;
    }
    try {
      const result = await createMut.mutateAsync({
        name: form.name,
        target_url: form.target_url,
        description: form.description || null,
        events: Array.from(form.events),
        active: form.active,
      });
      setCreatedSecret(result);
      setForm({ ...EMPTY_FORM, events: new Set() });
      setShowForm(false);
      toast.success(`Webhook "${result.name}" creado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error desconocido");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar webhook "${name}"? No se puede deshacer.`)) {
      return;
    }
    await deleteMut.mutateAsync(id);
    toast.success("Webhook eliminado");
  };

  const handleTest = async (id: string) => {
    try {
      await testMut.mutateAsync(id);
      toast.success(
        "Evento test disparado — revisá deliveries en unos segundos",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falló el test");
    }
  };

  const toggleEvent = (evt: WebhookEventType) => {
    setForm((prev) => {
      const next = new Set(prev.events);
      if (next.has(evt)) next.delete(evt);
      else next.add(evt);
      return { ...prev, events: next };
    });
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret.secret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Outgoing Webhooks
          </h1>
          <p className="text-sm text-ink-500">
            Notifica a sistemas externos (Slack / Zapier / n8n) cuando ocurren
            eventos en Cehta — POST con HMAC SHA-256 signature.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nuevo webhook
        </button>
      </div>

      {/* Mostrar secret una sola vez después de crear */}
      {createdSecret && (
        <Surface className="border border-positive/30 bg-positive/5 ring-1 ring-positive/20">
          <Surface.Title className="text-positive">
            Webhook creado · guardá el secret AHORA
          </Surface.Title>
          <Surface.Subtitle>
            El secret no se vuelve a mostrar. Copialo y pegalo en tu sistema
            receptor para verificar la signature de cada request.
          </Surface.Subtitle>
          <Surface.Body className="mt-3">
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-white p-3">
              <code className="flex-1 break-all font-mono text-xs text-ink-900">
                {createdSecret.secret}
              </code>
              <button
                type="button"
                onClick={copySecret}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-700 hover:bg-ink-50"
              >
                {secretCopied ? (
                  <Check className="h-4 w-4 text-positive" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCreatedSecret(null)}
              className="mt-3 text-xs text-ink-500 underline hover:text-ink-700"
            >
              Ya lo guardé · ocultar
            </button>
          </Surface.Body>
        </Surface>
      )}

      {/* Form */}
      {showForm && (
        <Surface>
          <Surface.Title>Nuevo webhook</Surface.Title>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Nombre
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ej. Slack #operaciones"
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Target URL
              </label>
              <input
                type="url"
                value={form.target_url}
                onChange={(e) => setForm({ ...form, target_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Descripción (opcional)
              </label>
              <input
                type="text"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Para qué se usa"
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="col-span-2">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <label className="block text-xs font-medium uppercase tracking-wider text-ink-500">
                  Eventos a escuchar
                </label>
                <p className="flex items-center gap-1.5 text-[10px] text-ink-400">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
                  Live = conectado a handlers reales
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {allEvents.map((evt) => {
                  const checked = form.events.has(evt);
                  const wired = EVENT_LABELS[evt]?.wired ?? false;
                  return (
                    <button
                      key={evt}
                      type="button"
                      onClick={() => toggleEvent(evt)}
                      title={
                        wired
                          ? "Live: este evento se dispara en mutaciones reales del backend"
                          : "Declarado pero NO conectado — solo recibirás 'test' manuales"
                      }
                      className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ease-apple ${
                        checked
                          ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                          : "border-hairline bg-white text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      {eventLabel(evt)}
                      <span
                        aria-hidden
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          wired ? "bg-positive" : "bg-ink-300"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm({ ...EMPTY_FORM, events: new Set() });
              }}
              className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {createMut.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Crear webhook
            </button>
          </div>
        </Surface>
      )}

      {/* Lista */}
      {subsQ.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : subsQ.error ? (
        <ErrorState
          title="No se pudieron cargar los webhooks"
          error={subsQ.error as Error}
          onRetry={() => subsQ.refetch()}
        />
      ) : (subsQ.data ?? []).length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="Sin webhooks configurados"
          description="Configurá webhooks para integrarte con sistemas externos."
        />
      ) : (
        <div className="space-y-3">
          {subsQ.data?.map((sub) => (
            <Surface key={sub.id} padding="compact">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-ink-900">
                      {sub.name}
                    </p>
                    {sub.active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="neutral">Pausado</Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-ink-500">
                    {sub.target_url}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sub.events.map((evt) => (
                      <span
                        key={evt}
                        className="inline-flex rounded-md bg-cehta-green/10 px-1.5 py-0.5 text-[10px] font-medium text-cehta-green"
                      >
                        {eventLabel(evt)}
                      </span>
                    ))}
                  </div>
                  {sub.description && (
                    <p className="mt-2 text-xs text-ink-500">{sub.description}</p>
                  )}
                  <p className="mt-1 font-mono text-[10px] text-ink-400">
                    secret hint: {sub.secret_hint}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleTest(sub.id)}
                    disabled={testMut.isPending}
                    title="Disparar evento test"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-600 transition-colors hover:bg-ink-50 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenDeliveries(openDeliveries === sub.id ? null : sub.id)
                    }
                    title="Ver entregas"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-600 transition-colors hover:bg-ink-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateMut.mutate({
                        id: sub.id,
                        body: { active: !sub.active },
                      })
                    }
                    title={sub.active ? "Pausar" : "Activar"}
                    className="rounded-lg border border-hairline bg-white px-2 py-1 text-[10px] font-medium text-ink-600 hover:bg-ink-50"
                  >
                    {sub.active ? "Pausar" : "Activar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sub.id, sub.name)}
                    title="Eliminar"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-negative/20 bg-white text-negative transition-colors hover:bg-negative/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              </div>

              {openDeliveries === sub.id && (
                <div className="mt-4 border-t border-hairline pt-4">
                  <div className="mb-3 flex items-baseline justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                      Últimas entregas
                    </p>
                    <p className="text-[10px] text-ink-400">
                      Click en una entrega para ver payload + respuesta
                    </p>
                  </div>

                  {/* KPI strip — success rate + breakdown */}
                  {deliveryStats.total > 0 && (
                    <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <DeliveryStat
                        label="Success rate"
                        value={`${deliveryStats.successRate}%`}
                        tone={
                          deliveryStats.successRate >= 95
                            ? "positive"
                            : deliveryStats.successRate >= 80
                              ? "warning"
                              : "negative"
                        }
                      />
                      <DeliveryStat
                        label="Exitosas"
                        value={String(deliveryStats.success)}
                        tone="positive"
                      />
                      <DeliveryStat
                        label="Fallidas"
                        value={String(deliveryStats.failed)}
                        tone={deliveryStats.failed > 0 ? "negative" : "neutral"}
                      />
                      <DeliveryStat
                        label="En curso"
                        value={String(deliveryStats.pending)}
                        tone="neutral"
                      />
                    </div>
                  )}

                  {deliveriesQ.isLoading ? (
                    <Skeleton className="h-20 w-full rounded-lg" />
                  ) : (deliveriesQ.data?.items ?? []).length === 0 ? (
                    <p className="text-xs text-ink-400">
                      Sin entregas todavía. Cuando ocurra un evento subscrito,
                      aparece aquí.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {deliveriesQ.data?.items.slice(0, 10).map((d) => {
                        const ok =
                          d.status_code !== null &&
                          d.status_code !== undefined &&
                          d.status_code >= 200 &&
                          d.status_code < 300;
                        const failed =
                          d.status_code !== null &&
                          d.status_code !== undefined &&
                          (d.status_code < 200 || d.status_code >= 300);
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setOpenDelivery(d)}
                            className="flex w-full items-center gap-2 rounded-lg bg-ink-50/40 px-3 py-1.5 text-left text-xs transition-colors hover:bg-ink-50"
                            title="Ver detalle (payload + respuesta del receiver)"
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${
                                ok
                                  ? "bg-positive"
                                  : failed
                                    ? "bg-negative"
                                    : "bg-warning"
                              }`}
                            />
                            <span className="font-mono">{d.event_type}</span>
                            <span className="text-ink-400">·</span>
                            <span className="tabular-nums">
                              {d.status_code ?? "—"}
                            </span>
                            <span className="text-ink-400">·</span>
                            <span>intento {d.attempt}</span>
                            <span className="ml-auto text-ink-400">
                              {new Date(d.created_at).toLocaleString("es-CL")}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Surface>
          ))}
        </div>
      )}

      {/* Modal detalle de delivery */}
      {openDelivery && (
        <DeliveryDetailModal
          delivery={openDelivery}
          onClose={() => setOpenDelivery(null)}
        />
      )}
    </div>
  );
}

function DeliveryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "positive" | "warning" | "negative" | "neutral";
}) {
  const colors = {
    positive: "border-positive/20 bg-positive/5 text-positive",
    warning: "border-warning/20 bg-warning/5 text-warning",
    negative: "border-negative/20 bg-negative/5 text-negative",
    neutral: "border-hairline bg-white text-ink-700",
  }[tone];
  return (
    <div className={`rounded-xl border ${colors} px-3 py-2`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-70">
        {label}
      </p>
      <p className="mt-0.5 font-display text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function DeliveryDetailModal({
  delivery,
  onClose,
}: {
  delivery: DeliveryRow;
  onClose: () => void;
}) {
  const ok =
    delivery.status_code !== null &&
    delivery.status_code !== undefined &&
    delivery.status_code >= 200 &&
    delivery.status_code < 300;
  const failed =
    delivery.status_code !== null &&
    delivery.status_code !== undefined &&
    (delivery.status_code < 200 || delivery.status_code >= 300);

  const [payloadCopied, setPayloadCopied] = useState(false);
  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(delivery.payload, null, 2),
      );
      setPayloadCopied(true);
      toast.success("Payload copiado al portapapeles");
      setTimeout(() => setPayloadCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar — copialo manualmente");
    }
  };

  const statusBadge = ok
    ? { label: `${delivery.status_code} OK`, color: "bg-positive/10 text-positive ring-positive/20" }
    : failed
      ? { label: `${delivery.status_code} Failed`, color: "bg-negative/10 text-negative ring-negative/20" }
      : { label: "Pending", color: "bg-warning/10 text-warning ring-warning/20" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between border-b border-hairline px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
              Webhook delivery · intento {delivery.attempt}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink-900">
              <span className="font-mono text-base">{delivery.event_type}</span>
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${statusBadge.color}`}
              >
                {statusBadge.label}
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                {new Date(delivery.created_at).toLocaleString("es-CL")}
              </span>
              {delivery.delivered_at && delivery.delivered_at !== delivery.created_at && (
                <>
                  <span>·</span>
                  <span>
                    entregado{" "}
                    <span className="font-mono tabular-nums">
                      {new Date(delivery.delivered_at).toLocaleString("es-CL")}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-600 transition-colors hover:bg-ink-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        {/* Body scrollable: payload + response */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Payload */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Payload enviado
              </p>
              <button
                type="button"
                onClick={copyPayload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 transition-colors hover:bg-ink-50"
              >
                {payloadCopied ? (
                  <>
                    <Check className="h-3 w-3" strokeWidth={2} />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    Copiar
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-2xl bg-ink-900 p-4 font-mono text-[11.5px] leading-relaxed text-emerald-300">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </section>

          {/* Response del receiver */}
          {(delivery.response_body || delivery.error) && (
            <section>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Respuesta del receiver
              </p>
              {delivery.error ? (
                <div className="rounded-2xl border border-negative/20 bg-negative/5 p-4 text-[12px] text-negative">
                  <p className="font-semibold">Error de transporte:</p>
                  <p className="mt-1 font-mono">{delivery.error}</p>
                </div>
              ) : (
                <pre className="overflow-x-auto rounded-2xl bg-ink-50 p-4 font-mono text-[11.5px] leading-relaxed text-ink-800 ring-1 ring-hairline">
                  {delivery.response_body || "(respuesta vacía)"}
                </pre>
              )}
            </section>
          )}

          {/* Hint si fue retry */}
          {delivery.attempt > 1 && (
            <div className="rounded-2xl border border-info/20 bg-info/5 p-3 text-[11px] text-ink-700">
              Esta es una reintentación. El dispatcher hace hasta 3 intentos
              con backoff exponencial 2s/4s/8s ante 5xx o timeout.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
