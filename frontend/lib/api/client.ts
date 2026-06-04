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
  // R152sss + R152WWWW — Capturar TypeError "Failed to fetch" del browser
  // fetch API y convertir en ApiError accionable. R152WWWW agrega:
  //   - AbortController con timeout explícito (45s primer intento, 60s segundo)
  //     para cubrir el cold start de las machines de Fly (auto-suspend de 5min
  //     hace que el primer request post-idle tarde 5-15s en wake-up).
  //   - Retry automático 1 vez ante Failed to fetch / aborted: la causa más
  //     común es cold start; el segundo intento siempre responde rápido.
  //   - Pre-warm vía /health en el primer retry para forzar wake-up.
  let res!: Response;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutMs = attempt === 0 ? 45_000 : 60_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, {
        ...options,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      const raw = e instanceof Error ? e.message : String(e);
      const isNetwork =
        raw.includes("Failed to fetch") ||
        raw.includes("NetworkError") ||
        raw.includes("aborted") ||
        (e instanceof DOMException && e.name === "AbortError");
      if (isNetwork && attempt === 0) {
        // Cold start probable. Pre-warm con /health y reintentar.
        try {
          const base = API_BASE.replace(/\/api\/v1\/?$/, "");
          await fetch(`${base}/health`, {
            method: "GET",
            cache: "no-store",
            keepalive: true,
          });
        } catch {
          // Best-effort warm-up; el retry ya va a esperar el real.
        }
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      // Falló también el retry o no es error de red — escalamos.
      if (isNetwork) {
        throw new ApiError(
          0,
          "No se pudo conectar con el servidor tras 2 intentos. " +
            "Causa probable: (1) la red está caída; (2) hay un Service Worker " +
            "viejo cacheado — abrí DevTools (F12) → Application → Service " +
            "Workers → Unregister, después Ctrl+Shift+R; (3) si usás VPN/" +
            "proxy corporativo, podría estar bloqueando cehta-backend.fly.dev.",
        );
      }
      throw new ApiError(0, `Error de red: ${raw}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  if (lastErr) {
    // Defensive — no debería pasar, pero TS no sabe que el for siempre
    // resuelve a res o throw.
    throw new ApiError(0, "Estado de red inconsistente");
  }
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

