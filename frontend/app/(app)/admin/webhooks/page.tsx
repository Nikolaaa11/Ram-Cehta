"use client";

import { useState } from "react";
import {
  Plus,
  Webhook,
  Trash2,
  Send,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
} from "@/hooks/use-webhooks";

const EVENT_LABELS: Record<string, string> = {
  "oc.created": "OC creada",
  "oc.paid": "OC pagada",
  "oc.cancelled": "OC anulada",
  "f29.due": "F29 vence pronto",
  "f29.paid": "F29 pagado",
  "legal.due": "Contrato vence pronto",
  "trabajador.created": "Trabajador creado",
  "etl.completed": "ETL completado",
  "etl.failed": "ETL falló",
  "audit.high_severity": "Cambio crítico",
  test: "Test (manual)",
};

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

  const deliveriesQ = useWebhookDeliveries(openDeliveries);

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
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Eventos a escuchar
              </label>
              <div className="flex flex-wrap gap-2">
                {allEvents.map((evt) => {
                  const checked = form.events.has(evt);
                  return (
                    <button
                      key={evt}
                      type="button"
                      onClick={() => toggleEvent(evt)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 ease-apple ${
                        checked
                          ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                          : "border-hairline bg-white text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      {EVENT_LABELS[evt] ?? evt}
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
      ) : (subsQ.data ?? []).length === 0 ? (
        <Surface className="py-12">
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <Webhook className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </span>
            <p className="text-base font-semibold text-ink-900">
              Sin webhooks configurados
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Creá tu primer webhook para conectar Cehta con Slack, Zapier, n8n
              o cualquier sistema que reciba HTTP POST.
            </p>
          </div>
        </Surface>
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
                        {EVENT_LABELS[evt] ?? evt}
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
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Últimas entregas
                  </p>
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
                          d.status_code >= 200 &&
                          d.status_code < 300;
                        return (
                          <div
                            key={d.id}
                            className="flex items-center gap-2 rounded-lg bg-ink-50/40 px-3 py-1.5 text-xs"
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-positive" : d.status_code === null ? "bg-warning" : "bg-negative"}`}
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
                          </div>
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
    </div>
  );
}
