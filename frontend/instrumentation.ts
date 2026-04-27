/**
 * Next.js 15 instrumentation hook.
 *
 * Carga el bundle de Sentry correcto según runtime. El client-side se inicializa
 * desde `sentry.client.config.ts` (auto-importado por @sentry/nextjs).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
