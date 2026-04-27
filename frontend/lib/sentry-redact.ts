/**
 * PII redaction helpers for Sentry events.
 *
 * Mantén en sync con backend/app/core/observability.py — la lista de claves sensibles
 * cubre los mismos casos (RUT, password, tokens, cookies, números de cuenta).
 */

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "rut",
  "numero_cuenta",
  "account_number",
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "x-api-key",
]);

export const REDACTED = "[REDACTED]";

export function scrub(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : scrub(v);
    }
    return out;
  }
  return value;
}

export function redactEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.request) {
    if (event.request.headers && typeof event.request.headers === "object") {
      event.request.headers = scrub(event.request.headers) as Record<string, string>;
    }
    if (event.request.cookies && typeof event.request.cookies === "object") {
      // Cookies son sensibles en bloque: cualquier nombre puede ser un session token.
      const cookieKeys = Object.keys(event.request.cookies as Record<string, string>);
      event.request.cookies = Object.fromEntries(
        cookieKeys.map((k) => [k, REDACTED])
      ) as Record<string, string>;
    }
    if (event.request.data !== undefined) {
      event.request.data = scrub(event.request.data);
    }
    if (event.request.query_string && typeof event.request.query_string === "object") {
      event.request.query_string = scrub(event.request.query_string) as Record<string, string>;
    }
  }
  if (event.extra) {
    event.extra = scrub(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = scrub(event.contexts) as typeof event.contexts;
  }
  return event;
}
