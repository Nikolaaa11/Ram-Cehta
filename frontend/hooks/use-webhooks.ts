"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

// Tipos espejo de `app.schemas.webhook`. Los definimos a mano para evitar
// el roundtrip openapi → ts hasta el próximo `npm run gen:types`.

export type WebhookEventType =
  | "oc.created"
  | "oc.paid"
  | "oc.cancelled"
  | "f29.due"
  | "f29.paid"
  | "legal.due"
  | "trabajador.created"
  | "etl.completed"
  | "etl.failed"
  | "audit.high_severity"
  | "test";

export interface WebhookSubscriptionRead {
  id: string;
  name: string;
  target_url: string;
  events: string[];
  description: string | null;
  active: boolean;
  secret_hint: string;
  created_at: string;
  updated_at: string;
}

export interface WebhookSubscriptionWithSecret extends WebhookSubscriptionRead {
  secret: string;
}

export interface WebhookDeliveryRead {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
  attempt: number;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookSubscriptionCreate {
  name: string;
  target_url: string;
  events: WebhookEventType[];
  description?: string | null;
  active?: boolean;
}

export function useWebhookEventTypes() {
  const { session, loading } = useSession();
  return useQuery<{ events: string[] }, Error>({
    queryKey: ["webhooks", "event-types"],
    queryFn: () =>
      apiClient.get<{ events: string[] }>("/webhooks/event-types", session),
    enabled: !loading,
    staleTime: 60 * 60 * 1000, // 1h — la lista es estática del código
  });
}

export function useWebhookSubscriptions() {
  const { session, loading } = useSession();
  return useQuery<WebhookSubscriptionRead[], Error>({
    queryKey: ["webhooks"],
    queryFn: () =>
      apiClient.get<WebhookSubscriptionRead[]>("/webhooks", session),
    enabled: !loading,
  });
}

export function useCreateWebhook() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<WebhookSubscriptionWithSecret, Error, WebhookSubscriptionCreate>({
    mutationFn: (body) =>
      apiClient.post<WebhookSubscriptionWithSecret>("/webhooks", body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useUpdateWebhook() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<
    WebhookSubscriptionRead,
    Error,
    { id: string; body: Partial<WebhookSubscriptionCreate> }
  >({
    mutationFn: ({ id, body }) =>
      apiClient.patch<WebhookSubscriptionRead>(`/webhooks/${id}`, body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useDeleteWebhook() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => apiClient.delete(`/webhooks/${id}`, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useTestWebhook() {
  const { session } = useSession();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) =>
      apiClient.post(`/webhooks/${id}/test`, { sample_payload: null }, session),
  });
}

export function useWebhookDeliveries(subId: string | null) {
  const { session, loading } = useSession();
  return useQuery({
    queryKey: ["webhook-deliveries", subId],
    queryFn: () =>
      apiClient.get<{ items: WebhookDeliveryRead[]; total: number }>(
        `/webhooks/${subId}/deliveries?page=1&size=20`,
        session,
      ),
    enabled: !loading && subId !== null,
  });
}
