import type { Session } from "@supabase/supabase-js";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function coreFetch<T>(
  path: string,
  options: RequestInit,
  session: Session | null
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(url, { ...options, headers, cache: "no-store" });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.message ?? detail;
    } catch {
      // non-JSON response body — keep default
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  get<T>(path: string, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "GET" }, session);
  },
  post<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, session);
  },
  patch<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }, session);
  },
  delete<T>(path: string, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "DELETE" }, session);
  },
};

