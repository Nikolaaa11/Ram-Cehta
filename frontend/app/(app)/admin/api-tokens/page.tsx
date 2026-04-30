"use client";

import { useState } from "react";
import {
  Plus,
  Key,
  Trash2,
  Ban,
  Copy,
  Check,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  useDeleteApiToken,
  type ApiTokenWithSecret,
} from "@/hooks/use-api-tokens";

interface FormState {
  name: string;
  description: string;
  expires_at: string; // YYYY-MM-DD ó vacío = nunca
}

const EMPTY_FORM: FormState = { name: "", description: "", expires_at: "" };

function statusOf(token: {
  revoked_at: string | null;
  expires_at: string | null;
}): { label: string; variant: "success" | "neutral" | "danger" | "warning" } {
  if (token.revoked_at) return { label: "Revocado", variant: "danger" };
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return { label: "Expirado", variant: "warning" };
  }
  return { label: "Activo", variant: "success" };
}

export default function ApiTokensPage() {
  const tokensQ = useApiTokens();
  const createMut = useCreateApiToken();
  const revokeMut = useRevokeApiToken();
  const deleteMut = useDeleteApiToken();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [created, setCreated] = useState<ApiTokenWithSecret | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!form.name) {
      toast.error("El nombre es obligatorio");
      return;
    }
    try {
      const result = await createMut.mutateAsync({
        name: form.name,
        description: form.description || null,
        expires_at: form.expires_at
          ? new Date(form.expires_at + "T23:59:59Z").toISOString()
          : null,
      });
      setCreated(result);
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast.success(`Token "${result.name}" creado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error desconocido");
    }
  };

  const copyToken = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (id: string, name: string) => {
    if (!window.confirm(`¿Revocar token "${name}"? Las requests siguientes con ese token van a fallar con 401.`)) return;
    await revokeMut.mutateAsync(id);
    toast.success("Token revocado");
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar permanentemente el token "${name}"? Si solo querés deshabilitarlo, mejor revocá.`)) return;
    await deleteMut.mutateAsync(id);
    toast.success("Token eliminado");
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Public API tokens
          </h1>
          <p className="text-sm text-ink-500">
            Tokens de larga duración para integrar Cehta con sistemas externos
            (Power BI, Nubox, scripts custom). Cada token actúa como el user
            que lo emite — hereda sus scopes via role.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreated(null);
            setShowForm((v) => !v);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nuevo token
        </button>
      </div>

      {/* Banner del token recién creado */}
      {created && (
        <Surface className="border border-positive/30 bg-positive/5 ring-1 ring-positive/20">
          <Surface.Title className="text-positive">
            Token creado · copialo AHORA
          </Surface.Title>
          <Surface.Subtitle>
            Este token NO se vuelve a mostrar. Pegalo en tu sistema externo
            ahora — si lo perdés, hay que crear uno nuevo.
          </Surface.Subtitle>
          <Surface.Body className="mt-3">
            <div className="flex items-center gap-2 rounded-xl border border-hairline bg-white p-3">
              <code className="flex-1 break-all font-mono text-xs text-ink-900">
                {created.token}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-white text-ink-700 hover:bg-ink-50"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-positive" strokeWidth={2} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
            <p className="mt-3 text-xs text-ink-500">
              Uso típico:{" "}
              <code className="rounded bg-ink-100/40 px-1 py-0.5 font-mono text-[10px]">
                {`curl -H "Authorization: Bearer ${created.token.slice(0, 20)}…" https://cehta-backend.fly.dev/api/v1/empresa/CENERGY/resumen-cc`}
              </code>
            </p>
            <button
              type="button"
              onClick={() => setCreated(null)}
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
          <Surface.Title>Nuevo API token</Surface.Title>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Nombre
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ej. Power BI dashboards"
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
                Expira (opcional)
              </label>
              <input
                type="date"
                value={form.expires_at}
                onChange={(e) =>
                  setForm({ ...form, expires_at: e.target.value })
                }
                className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
              <p className="mt-1 text-[11px] text-ink-400">
                Vacío = nunca expira (revocás manualmente)
              </p>
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
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
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
              Crear token
            </button>
          </div>
        </Surface>
      )}

      {/* Lista */}
      {tokensQ.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (tokensQ.data ?? []).length === 0 ? (
        <Surface className="py-12">
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <Key className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </span>
            <p className="text-base font-semibold text-ink-900">
              Sin tokens emitidos
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Creá tu primer token para que un sistema externo (Power BI, Nubox,
              etc.) consulte tus datos vía la API REST.
            </p>
          </div>
        </Surface>
      ) : (
        <div className="space-y-3">
          {tokensQ.data?.map((t) => {
            const st = statusOf(t);
            return (
              <Surface key={t.id} padding="compact">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-semibold text-ink-900">
                        {t.name}
                      </p>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    {t.description && (
                      <p className="mt-1 text-xs text-ink-500">{t.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-400">
                      <span className="font-mono">{t.token_hint}</span>
                      <span>·</span>
                      <span>
                        Creado{" "}
                        {new Date(t.created_at).toLocaleDateString("es-CL")}
                      </span>
                      {t.last_used_at && (
                        <>
                          <span>·</span>
                          <span>
                            Último uso:{" "}
                            {new Date(t.last_used_at).toLocaleDateString("es-CL")}
                          </span>
                        </>
                      )}
                      {t.expires_at && (
                        <>
                          <span>·</span>
                          <span>
                            Expira{" "}
                            {new Date(t.expires_at).toLocaleDateString("es-CL")}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!t.revoked_at && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(t.id, t.name)}
                        title="Revocar"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-warning/30 bg-white text-warning transition-colors hover:bg-warning/5"
                      >
                        <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id, t.name)}
                      title="Eliminar"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-negative/20 bg-white text-negative transition-colors hover:bg-negative/5"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      {/* Documentación inline */}
      <Surface className="bg-ink-50/50">
        <Surface.Title>Cómo usar un API token</Surface.Title>
        <Surface.Body className="mt-3 space-y-2 text-sm text-ink-700">
          <p>
            Pasá el token como Bearer auth en cualquier endpoint REST de la
            plataforma. El token actúa como el user que lo creó — hereda los
            mismos permisos.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-ink-100/40 p-3 font-mono text-[11px] text-ink-800">
            {`curl -H "Authorization: Bearer cak_xxx..." \\
  https://cehta-backend.fly.dev/api/v1/empresa/CENERGY/resumen-cc`}
          </pre>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
            Documentación completa de endpoints en /docs (Swagger UI)
          </p>
        </Surface.Body>
      </Surface>
    </div>
  );
}
