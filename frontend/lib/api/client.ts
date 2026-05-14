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
  session: Session | null,
  opts: { isFormData?: boolean } = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    ...(opts.isFormData ? {} : { "Content-Type": "application/json" }),
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
      const rawDetail = body?.detail ?? body?.message;
      if (Array.isArray(rawDetail)) {
        // FastAPI/Pydantic 422 — detail es array de objetos
        // { loc: ["body","campo"], msg: "Field required", type: "missing" }
        // Lo formateamos como "campo: msg · otroCampo: msg" para que el
        // toast muestre exactamente qué falla en vez de "[object Object]".
        const lines = rawDetail
          .map((e: unknown) => {
            if (typeof e !== "object" || e === null) return String(e);
            const obj = e as { loc?: unknown[]; msg?: string };
            const field = Array.isArray(obj.loc)
              ? obj.loc.filter((p) => p !== "body").join(".")
              : "";
            const msg = typeof obj.msg === "string" ? obj.msg : "error";
            return field ? `${field}: ${msg}` : msg;
          })
          .filter(Boolean);
        detail = lines.length ? lines.join(" · ") : detail;
      } else if (typeof rawDetail === "string") {
        detail = rawDetail;
      } else if (rawDetail && typeof rawDetail === "object") {
        detail = JSON.stringify(rawDetail);
      }
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
  postForm<T>(path: string, formData: FormData, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "POST", body: formData },
      session,
      { isFormData: true },
    );
  },
  patch<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }, session);
  },
  put<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }, session);
  },
  delete<T>(path: string, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "DELETE" }, session);
  },
};

