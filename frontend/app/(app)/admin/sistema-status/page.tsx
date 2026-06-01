"use client";

/**
 * /admin/sistema-status — Health check live de todas las integraciones (R152ooo).
 *
 * Una sola pantalla con el status real de cada servicio externo:
 *   - Backend health (DB)
 *   - Dropbox (PDFs y cartolas)
 *   - Resend (email outbound) + IMAP (inbound)
 *   - Anthropic (asistente IA)
 *   - OpenAI (embeddings del asistente)
 *   - SII (sync RCV)
 *   - Nubox API (DTE oficial)
 *   - Nubox scraping (remuneraciones)
 *
 * Cada card muestra: nombre, status (verde/ámbar/rojo), métrica clave,
 * link a la página de detalle, y link a las docs si el status es rojo.
 */
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import {
  Activity,
  Cloud,
  Mail,
  Sparkles,
  Landmark,
  Users,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Database,
  Zap,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

type Status = "ok" | "warning" | "error" | "loading";

interface IntegrationCardProps {
  title: string;
  icon: typeof Cloud;
  status: Status;
  description: string;
  details: string[];
  href: Route;
  hint?: string;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-500">
        <span className="size-2 animate-pulse rounded-full bg-ink-400" />
        Comprobando…
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="size-3" />
        OK
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        <AlertTriangle className="size-3" />
        Atención
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
      <XCircle className="size-3" />
      Falla
    </span>
  );
}

function IntegrationCard({
  title,
  icon: Icon,
  status,
  description,
  details,
  href,
  hint,
}: IntegrationCardProps) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-hairline bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-10 items-center justify-center rounded-xl ${
              status === "ok"
                ? "bg-emerald-100 text-emerald-700"
                : status === "warning"
                ? "bg-amber-100 text-amber-700"
                : status === "error"
                ? "bg-red-100 text-red-700"
                : "bg-ink-100 text-ink-500"
            }`}
          >
            <Icon className="size-5" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">{title}</p>
            <p className="text-[11px] text-ink-500">{description}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </header>
      <ul className="mt-3 space-y-1 text-[11px] text-ink-700">
        {details.map((d, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 size-1 shrink-0 rounded-full bg-ink-400" />
            {d}
          </li>
        ))}
      </ul>
      {hint && status !== "ok" && (
        <p className="mt-3 rounded-lg bg-amber-50/60 px-3 py-2 text-[10px] leading-relaxed text-amber-900">
          💡 {hint}
        </p>
      )}
      <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-cehta-green group-hover:gap-2 group-hover:transition-all">
        Ver detalle
        <ArrowRight className="size-3" />
      </span>
    </Link>
  );
}

export default function SistemaStatusPage() {
  const { session } = useSession();

  // Backend / DB health (no requiere auth)
  const health = useQuery<{ status: string; database: string }>({
    queryKey: ["sistema-status", "health"],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ""}/health`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 1000,
    retry: 1,
  });

  // Dropbox
  const dropbox = useQuery<{ connected: boolean; account?: { email: string } }>({
    queryKey: ["sistema-status", "dropbox"],
    queryFn: () => apiClient.get("/dropbox/status", session),
    enabled: !!session,
    staleTime: 30 * 1000,
    retry: false,
  });

  // Mailbox (Resend + IMAP + Anthropic)
  const mailbox = useQuery<{
    imap_configured: boolean;
    resend_enabled: boolean;
    anthropic_enabled: boolean;
    dropbox_enabled: boolean;
    last_received_at: string | null;
  }>({
    queryKey: ["sistema-status", "mailbox"],
    queryFn: () => apiClient.get("/admin/mailbox/status", session),
    enabled: !!session,
    staleTime: 30 * 1000,
    retry: false,
  });

  // SII
  const sii = useQuery<Array<{ tiene_credencial_sii: boolean }>>({
    queryKey: ["sistema-status", "sii"],
    queryFn: () => apiClient.get("/admin/sii/empresas", session),
    enabled: !!session,
    staleTime: 60 * 1000,
    retry: false,
  });

  // Nubox API
  const nuboxApi = useQuery<Array<{ tiene_credencial: boolean }>>({
    queryKey: ["sistema-status", "nubox-api"],
    queryFn: () => apiClient.get("/admin/nubox-api/empresas", session),
    enabled: !!session,
    staleTime: 60 * 1000,
    retry: false,
  });

  // Nubox scraping (remuneraciones)
  const nuboxScraping = useQuery<Array<{ tiene_credencial: boolean }>>({
    queryKey: ["sistema-status", "nubox"],
    queryFn: () => apiClient.get("/admin/nubox/empresas", session),
    enabled: !!session,
    staleTime: 60 * 1000,
    retry: false,
  });

  // Helper: cuántos status dieron error vs OK
  const summary = {
    ok: 0,
    warning: 0,
    error: 0,
    loading: 0,
  };
  const evalStatus = (q: { isLoading: boolean; isError: boolean; data?: unknown }): Status => {
    if (q.isLoading) {
      summary.loading += 1;
      return "loading";
    }
    if (q.isError) {
      summary.error += 1;
      return "error";
    }
    summary.ok += 1;
    return "ok";
  };

  const healthStatus = evalStatus(health);
  const dropboxStatus: Status = dropbox.isLoading
    ? "loading"
    : dropbox.isError
    ? "error"
    : dropbox.data?.connected
    ? "ok"
    : "warning";
  if (dropboxStatus !== "loading") {
    if (dropboxStatus === "warning") summary.warning += 1;
    else if (dropboxStatus === "error") summary.error += 1;
    else summary.ok += 1;
  } else summary.loading += 1;

  const mailboxStatus: Status = mailbox.isLoading
    ? "loading"
    : mailbox.isError
    ? "error"
    : mailbox.data?.imap_configured && mailbox.data?.resend_enabled
    ? "ok"
    : "warning";
  if (mailboxStatus !== "loading") {
    if (mailboxStatus === "warning") summary.warning += 1;
    else if (mailboxStatus === "error") summary.error += 1;
    else summary.ok += 1;
  } else summary.loading += 1;

  const anthropicStatus: Status = mailbox.isLoading
    ? "loading"
    : mailbox.isError
    ? "error"
    : mailbox.data?.anthropic_enabled
    ? "ok"
    : "warning";
  // Avoid double counting (mailbox ya contó)

  const siiEmpresasCount = sii.data?.length ?? 0;
  const siiOk = sii.data?.filter((e) => e.tiene_credencial_sii).length ?? 0;
  const siiStatus: Status = sii.isLoading
    ? "loading"
    : sii.isError
    ? "error"
    : siiOk > 0
    ? "ok"
    : "warning";

  const nuboxApiOk = nuboxApi.data?.filter((e) => e.tiene_credencial).length ?? 0;
  const nuboxApiStatus: Status = nuboxApi.isLoading
    ? "loading"
    : nuboxApi.isError
    ? "error"
    : nuboxApiOk > 0
    ? "ok"
    : "warning";

  const nuboxScrapingOk = nuboxScraping.data?.filter((e) => e.tiene_credencial).length ?? 0;
  const nuboxScrapingStatus: Status = nuboxScraping.isLoading
    ? "loading"
    : nuboxScraping.isError
    ? "error"
    : nuboxScrapingOk > 0
    ? "ok"
    : "warning";

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      {/* Header */}
      <header>
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
            <Activity className="size-6" strokeWidth={1.6} />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              Status del sistema
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Health check live de todas las integraciones externas.
            </p>
          </div>
        </div>
      </header>

      {/* Resumen global */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div
          className={`rounded-2xl border p-5 shadow-card ${
            summary.error === 0
              ? "border-emerald-200 bg-emerald-50/40"
              : "border-red-200 bg-red-50/40"
          }`}
        >
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {summary.error === 0 ? (
              <>
                <CheckCircle2 className="size-3.5 text-emerald-700" />
                <span className="text-emerald-800">Todos los sistemas OK</span>
              </>
            ) : (
              <>
                <XCircle className="size-3.5 text-red-700" />
                <span className="text-red-800">Fallas detectadas</span>
              </>
            )}
          </p>
          <p
            className={`mt-2 font-display text-3xl font-semibold ${
              summary.error === 0 ? "text-emerald-900" : "text-red-900"
            }`}
          >
            {summary.error === 0 ? "✓" : summary.error}
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            OK
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            {summary.ok}
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
            Atención
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            {summary.warning}
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700">
            Fallas
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            {summary.error}
          </p>
        </div>
      </div>

      {/* Grid de integraciones */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Backend + DB */}
        <IntegrationCard
          title="Backend + Base de datos"
          icon={Database}
          status={healthStatus}
          description="API en Fly.io · DB en Supabase Brasil"
          details={[
            health.data?.status === "ok" ? "API responde OK" : "API no responde",
            health.data?.database === "ok" ? "DB Brasil conectada" : "DB sin conexión",
          ]}
          href={"/admin/integraciones" as Route}
        />

        {/* Dropbox */}
        <IntegrationCard
          title="Dropbox"
          icon={Cloud}
          status={dropboxStatus}
          description="Almacén de PDFs, cartolas y documentos legales"
          details={[
            dropbox.data?.connected
              ? `Cuenta conectada: ${dropbox.data.account?.email ?? "—"}`
              : "Cuenta no conectada",
          ]}
          href={"/admin/integraciones" as Route}
          hint="Conectar en /admin/integraciones · Dropbox connect"
        />

        {/* Email (Resend + IMAP) */}
        <IntegrationCard
          title="Email (Resend + IMAP)"
          icon={Mail}
          status={mailboxStatus}
          description="Envío outbound + recepción inbound a contactocehta@"
          details={[
            mailbox.data?.resend_enabled ? "Resend (outbound) OK" : "Resend NO configurado",
            mailbox.data?.imap_configured ? "IMAP (inbound) OK" : "IMAP NO configurado",
            mailbox.data?.last_received_at
              ? `Último email: ${new Date(mailbox.data.last_received_at).toLocaleString("es-CL")}`
              : "Sin emails recibidos",
          ]}
          href={"/admin/mailbox" as Route}
          hint="Setear RESEND_API_KEY + IMAP_HOST en fly secrets"
        />

        {/* Asistente IA — Anthropic */}
        <IntegrationCard
          title="Asistente IA (Anthropic)"
          icon={Sparkles}
          status={anthropicStatus}
          description="Claude para chat y clasificación de inbox"
          details={[
            mailbox.data?.anthropic_enabled
              ? "ANTHROPIC_API_KEY presente"
              : "ANTHROPIC_API_KEY no detectada",
            "Modelo: claude-3.5-sonnet (configurable)",
          ]}
          href={"/admin/ai-index" as Route}
          hint="Setear ANTHROPIC_API_KEY en fly secrets + reindexar empresas"
        />

        {/* OpenAI embeddings */}
        <IntegrationCard
          title="Embeddings (OpenAI)"
          icon={Zap}
          status={anthropicStatus}
          description="Vector search del asistente · text-embedding-3-small"
          details={[
            "Usa OPENAI_API_KEY del backend",
            "Indexa documentos Dropbox → core.ai_documents",
          ]}
          href={"/admin/ai-index" as Route}
          hint="Si las búsquedas vectoriales fallan, verifica OPENAI_API_KEY"
        />

        {/* SII */}
        <IntegrationCard
          title="SII Chile"
          icon={Landmark}
          status={siiStatus}
          description="Registro de Compras y Ventas + F29/F22"
          details={[
            `${siiOk} de ${siiEmpresasCount} empresas con credenciales`,
            siiOk === 0
              ? "Ninguna empresa autenticada todavía"
              : `${siiOk} empresas pueden sincronizar RCV`,
          ]}
          href={"/sii" as Route}
          hint="Cargar credenciales SII por empresa en /admin/empresas"
        />

        {/* Nubox API */}
        <IntegrationCard
          title="Nubox API (Factura/Admin)"
          icon={Users}
          status={nuboxApiStatus}
          description="API REST oficial para DTE"
          details={[
            `${nuboxApiOk} empresas con credenciales API`,
            nuboxApiOk === 0
              ? "API aún en UAT — credenciales PROD pendientes"
              : `${nuboxApiOk} empresas sync DTE OK`,
          ]}
          href={"/admin/nubox" as Route}
          hint="Solicitar credenciales PROD a soporte@nubox.com"
        />

        {/* Nubox scraping */}
        <IntegrationCard
          title="Nubox (Remuneraciones)"
          icon={Users}
          status={nuboxScrapingStatus}
          description="Libro de Remuneraciones · scraping web"
          details={[
            `${nuboxScrapingOk} empresas con credenciales scraping`,
            "Upload manual también disponible (xlsx)",
          ]}
          href={"/admin/nubox" as Route}
          hint="Cargar credenciales Nubox por empresa"
        />
      </section>

      {/* Tips operativos */}
      <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-sm">
        <p className="font-semibold text-blue-900">🎓 Comandos de diagnóstico rápido</p>
        <ul className="mt-3 space-y-2 text-xs text-blue-900">
          <li>
            <code className="rounded bg-blue-100 px-1.5 py-0.5">
              fly secrets list -a cehta-backend
            </code>{" "}
            — verificar variables de entorno seteadas en producción
          </li>
          <li>
            <code className="rounded bg-blue-100 px-1.5 py-0.5">
              fly logs -a cehta-backend
            </code>{" "}
            — ver logs en vivo del backend
          </li>
          <li>
            <code className="rounded bg-blue-100 px-1.5 py-0.5">
              fly secrets set CLAVE=&quot;valor&quot; -a cehta-backend
            </code>{" "}
            — agregar/actualizar una env var (Fly redeploy automático)
          </li>
          <li>
            <code className="rounded bg-blue-100 px-1.5 py-0.5">
              curl https://cehta-backend.fly.dev/api/v1/health
            </code>{" "}
            — verificar que el backend está vivo
          </li>
        </ul>
      </section>
    </div>
  );
}
