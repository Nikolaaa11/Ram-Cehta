import Link from "next/link";
import {
  Cloud,
  CloudOff,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Mail,
  MailX,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { serverApiGet } from "@/lib/api/server";

interface DropboxStatus {
  connected: boolean;
  account?: { account_id: string; email: string; display_name: string };
  connected_at?: string;
}

interface DataMadreStatus {
  found_inteligencia_negocios: boolean;
  inteligencia_negocios_path?: string;
  found_data_madre: boolean;
  data_madre?: {
    name: string;
    path: string;
    size?: number;
    modified?: string;
  };
}

interface MailboxStatus {
  imap_configured: boolean;
  imap_user: string | null;
  anthropic_enabled: boolean;
  resend_enabled: boolean;
  dropbox_enabled: boolean;
  last_received_at: string | null;
  counts_by_status: Record<string, number>;
  counts_by_category: Record<string, number>;
}

/**
 * Admin > Integraciones — visión general de servicios externos conectados.
 *
 * V3 fase 2: Dropbox solamente. En fases siguientes: Anthropic, Resend (email),
 * OpenAI (embeddings), Sentry, Webhooks Dropbox.
 */
export default async function IntegracionesPage() {
  let status: DropboxStatus = { connected: false };
  let dataMadre: DataMadreStatus | null = null;
  let mailbox: MailboxStatus | null = null;

  try {
    status = await serverApiGet<DropboxStatus>("/dropbox/status");
  } catch {
    // backend down / no auth — degradado
  }

  if (status.connected) {
    try {
      dataMadre = await serverApiGet<DataMadreStatus>("/dropbox/data-madre");
    } catch {
      // ignore
    }
  }

  try {
    mailbox = await serverApiGet<MailboxStatus>("/admin/mailbox/status");
  } catch {
    // backend down / endpoint not deployed yet
  }

  const totalEmails = mailbox
    ? Object.values(mailbox.counts_by_status).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
      <header className="mb-8">
        <h1 className="text-3xl font-display font-semibold tracking-tight text-ink-900">
          Integraciones
        </h1>
        <p className="mt-2 text-base text-ink-500">
          Servicios externos conectados a la plataforma.
        </p>
      </header>

      {/* Dropbox card */}
      <Surface className="mb-6">
        <div className="flex items-start gap-4">
          <span
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              status.connected
                ? "bg-positive/10 text-positive"
                : "bg-ink-100/60 text-ink-500"
            }`}
          >
            {status.connected ? (
              <Cloud className="h-6 w-6" strokeWidth={1.5} />
            ) : (
              <CloudOff className="h-6 w-6" strokeWidth={1.5} />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-display font-semibold text-ink-900">
                Dropbox
              </h2>
              {status.connected ? (
                <Badge variant="success">Conectado</Badge>
              ) : (
                <Badge variant="neutral">No conectado</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              Custodia el Excel madre y los documentos por empresa. Single-tenant: una sola cuenta corporativa.
            </p>

            {status.connected && status.account && (
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Cuenta
                  </dt>
                  <dd className="mt-0.5 text-ink-900">
                    {status.account.display_name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Email
                  </dt>
                  <dd className="mt-0.5 text-ink-900">
                    {status.account.email}
                  </dd>
                </div>
                {status.connected_at && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-ink-500">
                      Conectado el
                    </dt>
                    <dd className="mt-0.5 text-ink-900">
                      {new Date(status.connected_at).toLocaleString("es-CL")}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            <div className="mt-5 flex items-center gap-3">
              {status.connected ? (
                <>
                  <Link
                    href={"/admin/dropbox-connect" as never}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
                  >
                    <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
                    Re-conectar
                  </Link>
                </>
              ) : (
                <Link
                  href={"/admin/dropbox-connect" as never}
                  className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
                >
                  <Cloud className="h-4 w-4" strokeWidth={1.5} />
                  Conectar Dropbox
                </Link>
              )}
            </div>
          </div>
        </div>
      </Surface>

      {/* Data Madre card — solo si Dropbox está conectado */}
      {status.connected && (
        <Surface className="mb-6">
          <div className="flex items-start gap-4">
            <span
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                dataMadre?.found_data_madre
                  ? "bg-positive/10 text-positive"
                  : "bg-warning/10 text-warning"
              }`}
            >
              {dataMadre?.found_data_madre ? (
                <CheckCircle2 className="h-6 w-6" strokeWidth={1.5} />
              ) : (
                <AlertTriangle className="h-6 w-6" strokeWidth={1.5} />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-display font-semibold text-ink-900">
                Data Madre
              </h2>
              {dataMadre?.found_data_madre && dataMadre.data_madre ? (
                <>
                  <p className="mt-1 text-sm text-ink-500">
                    Excel detectado en Dropbox y disponible para el ETL.
                  </p>
                  <dl className="mt-4 space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-ink-500">Path:</dt>
                      <dd className="font-mono text-xs text-ink-900">
                        {dataMadre.data_madre.path}
                      </dd>
                    </div>
                    {dataMadre.data_madre.modified && (
                      <div className="flex gap-2">
                        <dt className="text-ink-500">Última modificación:</dt>
                        <dd className="text-ink-900 tabular-nums">
                          {new Date(
                            dataMadre.data_madre.modified,
                          ).toLocaleString("es-CL")}
                        </dd>
                      </div>
                    )}
                  </dl>
                </>
              ) : dataMadre?.found_inteligencia_negocios ? (
                <>
                  <p className="mt-1 text-sm text-ink-500">
                    Carpeta encontrada pero no contiene{" "}
                    <code className="rounded bg-ink-100/60 px-1.5 py-0.5 text-xs">
                      Data Madre.xlsx
                    </code>
                    .
                  </p>
                  <p className="mt-2 text-xs text-ink-500">
                    Sube el archivo a:{" "}
                    <span className="font-mono">
                      {dataMadre.inteligencia_negocios_path}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-ink-500">
                    No se encontró la carpeta{" "}
                    <code className="rounded bg-ink-100/60 px-1.5 py-0.5 text-xs">
                      Cehta Capital/00-Inteligencia de Negocios/
                    </code>
                    .
                  </p>
                  <Link
                    href="https://github.com/Nikolaaa11/Ram-Cehta/blob/main/docs/GUIA_CARPETAS.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cehta-green hover:underline"
                  >
                    Ver guía de estructura
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </Link>
                </>
              )}
            </div>
          </div>
        </Surface>
      )}

      {/* Inbox contactocehta@gmail.com */}
      <Surface className="mb-6">
        <div className="flex items-start gap-4">
          <span
            className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              mailbox?.imap_configured
                ? "bg-positive/10 text-positive"
                : "bg-warning/10 text-warning"
            }`}
          >
            {mailbox?.imap_configured ? (
              <Mail className="h-6 w-6" strokeWidth={1.5} />
            ) : (
              <MailX className="h-6 w-6" strokeWidth={1.5} />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-display font-semibold text-ink-900">
                Inbox · contactocehta@gmail.com
              </h2>
              {mailbox?.imap_configured ? (
                <Badge variant="success">IMAP activo</Badge>
              ) : (
                <Badge variant="neutral">Sin configurar</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-500">
              IMAP poll cada 15min · Claude clasifica + draft de respuesta · Adjuntos a Dropbox /00-Inbox/.
              Nicolás aprueba cada respuesta antes de enviar.
            </p>

            {mailbox && (
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Cuenta IMAP
                  </dt>
                  <dd className="mt-0.5 text-ink-900 truncate">
                    {mailbox.imap_user ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Total mails
                  </dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-ink-900">
                    {totalEmails}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Pendientes revisión
                  </dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-ink-900">
                    {(mailbox.counts_by_status.classified ?? 0) +
                      (mailbox.counts_by_status.received ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">
                    Último recibido
                  </dt>
                  <dd className="mt-0.5 text-ink-900 tabular-nums">
                    {mailbox.last_received_at
                      ? new Date(mailbox.last_received_at).toLocaleString(
                          "es-CL",
                          {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )
                      : "—"}
                  </dd>
                </div>
              </dl>
            )}

            {/* Sub-status de dependencias */}
            {mailbox && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    mailbox.imap_configured
                      ? "bg-positive/10 text-positive"
                      : "bg-warning/10 text-warning"
                  }`}
                >
                  {mailbox.imap_configured ? "✓" : "⚠"} IMAP Gmail
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    mailbox.anthropic_enabled
                      ? "bg-positive/10 text-positive"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {mailbox.anthropic_enabled ? "✓" : "—"} Claude clasificador
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    mailbox.resend_enabled
                      ? "bg-positive/10 text-positive"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {mailbox.resend_enabled ? "✓" : "—"} Resend (envío respuestas)
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    mailbox.dropbox_enabled
                      ? "bg-positive/10 text-positive"
                      : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {mailbox.dropbox_enabled ? "✓" : "—"} Dropbox (adjuntos)
                </span>
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <Link
                href={"/admin/mailbox" as never}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
              >
                <Mail className="h-4 w-4" strokeWidth={1.5} />
                Abrir inbox
              </Link>
              {!mailbox?.imap_configured && (
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
                >
                  Generar Gmail App Password
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                </a>
              )}
            </div>
          </div>
        </div>
      </Surface>

      {/* Próximas integraciones */}
      <Surface variant="glass">
        <Surface.Header>
          <Surface.Title>Próximas integraciones</Surface.Title>
          <Surface.Subtitle>
            Servicios planificados para fases siguientes V3.
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <ul className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <li className="rounded-xl bg-white/60 p-3 ring-1 ring-hairline">
              <div className="font-medium text-ink-900">
                OCR Cartolas Bancarias
              </div>
              <div className="text-xs text-ink-500">
                PDFs en /04-Financiero/Cartolas Bancarias/ → core.movimientos
                automático para conciliación.
              </div>
            </li>
            <li className="rounded-xl bg-white/60 p-3 ring-1 ring-hairline">
              <div className="font-medium text-ink-900">
                AI Auto-fill Voucher (V5.4)
              </div>
              <div className="text-xs text-ink-500">
                Factura PDF → voucher COMPRA pre-llenado en draft.
              </div>
            </li>
            <li className="rounded-xl bg-white/60 p-3 ring-1 ring-hairline">
              <div className="font-medium text-ink-900">F22 anual</div>
              <div className="text-xs text-ink-500">
                Calendario abril + alerta vencimiento + sync Dropbox.
              </div>
            </li>
            <li className="rounded-xl bg-white/60 p-3 ring-1 ring-hairline">
              <div className="font-medium text-ink-900">API Nubox directa</div>
              <div className="text-xs text-ink-500">
                Cuando esté disponible, eliminar paso CSV manual.
              </div>
            </li>
          </ul>
        </Surface.Body>
      </Surface>
    </div>
  );
}
