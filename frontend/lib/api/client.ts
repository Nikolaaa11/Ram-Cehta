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

/**
 * R152AAAAA · Auditoría P0 del apiClient.
 *
 * Bugs corregidos en este round:
 *
 *   1. DOUBLE-SUBMIT en POST/PATCH/PUT (crítico financiero).
 *      Antes: el retry tras AbortError reenviaba el mismo POST.
 *      AbortController NO cancela el procesamiento server-side, así que el
 *      server podía recibir el request 1 (timeout cliente) Y el request 2
 *      (retry), procesando ambos. Resultado real observado en producción:
 *      bug de "Generar 11 vouchers DRAFT" — con cold-start de Fly, riesgo
 *      de generar 22 vouchers en lugar de 11.
 *      Fix: retry SOLO para métodos idempotentes (GET, HEAD). Para
 *      POST/PATCH/PUT/DELETE: 1 solo intento con timeout largo y, opcional,
 *      Idempotency-Key para que el backend deduplique.
 *
 *   2. FormData consumido en attempt 1.
 *      ReadableStream del FormData se vacía tras consumirlo; attempt 2
 *      enviaba body vacío y backend respondía 422 sin contexto.
 *      Fix: cubierto automáticamente por el cambio 1 (no hay retry en POST).
 *
 *   3. `res.json()` sin try/catch tira SyntaxError sin mensaje.
 *      Si el server responde 500 con HTML (default de uvicorn pre-FastAPI),
 *      JSON.parse explota y el llamador recibe SyntaxError, no ApiError.
 *      Fix: guard de content-type + try/catch sobre res.json().
 *
 *   4. Cold-start de Fly: timeout corto para GET, pre-warm con /health.
 *      Mantenemos los 45-60s para GET, agregamos timeout largo de 90s para
 *      mutaciones porque sin retry necesitan headroom suficiente.
 */

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

/**
 * Genera una Idempotency-Key UUID v4 para que el backend pueda deduplicar
 * mutaciones que llegan dos veces (double-click, retry de red, etc.).
 * Si el backend la ignora, no rompe nada.
 */
function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback simple cuando crypto.randomUUID no está disponible.
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function preWarm(): Promise<void> {
  try {
    const base = API_BASE.replace(/\/api\/v1\/?$/, "");
    await fetch(`${base}/health`, {
      method: "GET",
      cache: "no-store",
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}

async function coreFetch<T>(
  path: string,
  options: RequestInit,
  session: Session | null,
  opts: { isFormData?: boolean; idempotencyKey?: string } = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(opts.isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (session?.access_token) {
    headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const canRetry = IDEMPOTENT_METHODS.has(method) && !opts.isFormData;
  const maxAttempts = canRetry ? 2 : 1;
  // POST/PATCH sin retry: timeout largo (90s) para tolerar cold-start sin
  // arriesgar double-submit. GET/HEAD: 45s primer intento, 60s segundo.
  const timeoutFor = (attempt: number): number => {
    if (!canRetry) return 90_000;
    return attempt === 0 ? 45_000 : 60_000;
  };

  let res!: Response;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutFor(attempt));
    try {
      res = await fetch(url, {
        ...options,
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      const raw = e instanceof Error ? e.message : String(e);
      const isNetwork =
        raw.includes("Failed to fetch") ||
        raw.includes("NetworkError") ||
        raw.includes("aborted") ||
        (e instanceof DOMException && e.name === "AbortError");

      if (isNetwork && canRetry && attempt === 0) {
        // Solo GET/HEAD reintentan. Pre-warm y reintentar con timeout más
        // largo. Mutaciones no llegan acá — caen al throw de abajo.
        await preWarm();
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }

      if (isNetwork) {
        const hint = canRetry
          ? "tras 2 intentos"
          : "(operación de mutación — sin retry automático para evitar duplicados)";
        throw new ApiError(
          0,
          `No se pudo conectar con el servidor ${hint}. ` +
            "Causa probable: (1) la red está caída; (2) hay un Service Worker " +
            "viejo cacheado — abre DevTools (F12) → Application → Service " +
            "Workers → Unregister, después Ctrl+Shift+R; (3) si usas VPN o " +
            "proxy corporativo, podría estar bloqueando cehta-backend.fly.dev.",
        );
      }
      throw new ApiError(0, `Error de red: ${raw}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastError) {
    // Defensive — no debería pasar; el for siempre resuelve a res o throw.
    throw new ApiError(0, "Estado de red inconsistente");
  }

  // Procesar la respuesta con guard sobre content-type y try/catch de JSON.
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const isJson = contentType.includes("application/json");

    if (isJson) {
      try {
        const body = await res.json();
        const rawDetail = body?.detail ?? body?.message;
        if (Array.isArray(rawDetail)) {
          // FastAPI/Pydantic 422 — detail es array de objetos
          // { loc: ["body","campo"], msg: "Field required", type: "missing" }
          // Lo formateamos como "campo: msg · otroCampo: msg".
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
        // JSON malformado pese al content-type — mantener default HTTP X.
      }
    } else {
      // No-JSON (HTML 500 de uvicorn pre-FastAPI, plain text, etc.)
      try {
        const txt = await res.text();
        if (txt) {
          // Extraer un mensaje accionable del body. Limitar a 200 chars.
          detail = `${detail}: ${txt.replace(/\s+/g, " ").slice(0, 200)}`;
        }
      } catch {
        // ignore
      }
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as unknown as T;

  // Respuesta OK — content-type debe ser JSON.
  const okType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!okType.includes("application/json")) {
    try {
      const txt = await res.text();
      throw new ApiError(
        res.status,
        `Respuesta no-JSON inesperada: ${txt.slice(0, 200)}`,
      );
    } catch {
      throw new ApiError(res.status, "Respuesta no-JSON sin body");
    }
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "Respuesta JSON malformada del servidor");
  }
}

export const apiClient = {
  get<T>(path: string, session: Session | null): Promise<T> {
    return coreFetch<T>(path, { method: "GET" }, session);
  },
  post<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "POST", body: JSON.stringify(body) },
      session,
      { idempotencyKey: generateIdempotencyKey() },
    );
  },
  postForm<T>(path: string, formData: FormData, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "POST", body: formData },
      session,
      { isFormData: true, idempotencyKey: generateIdempotencyKey() },
    );
  },
  patch<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "PATCH", body: JSON.stringify(body) },
      session,
      { idempotencyKey: generateIdempotencyKey() },
    );
  },
  put<T>(path: string, body: unknown, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "PUT", body: JSON.stringify(body) },
      session,
      { idempotencyKey: generateIdempotencyKey() },
    );
  },
  delete<T>(path: string, session: Session | null): Promise<T> {
    return coreFetch<T>(
      path,
      { method: "DELETE" },
      session,
      { idempotencyKey: generateIdempotencyKey() },
    );
  },
};
