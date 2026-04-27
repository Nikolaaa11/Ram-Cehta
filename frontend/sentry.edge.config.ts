/**
 * Sentry — runtime: edge (middleware, edge route handlers).
 *
 * Si `NEXT_PUBLIC_SENTRY_DSN` no está seteado, no se inicializa nada (no-op).
 */

import * as Sentry from "@sentry/nextjs";
import { redactEvent } from "@/lib/sentry-redact";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: redactEvent,
  });
}
