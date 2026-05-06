/**
 * /admin/mailbox — Server Component (V5++ perf refactor).
 *
 * SSR fetch de la lista de emails sin filtros para el primer paint.
 * Si el endpoint da 401/error (sesión SSR no propagada, IMAP sin
 * configurar todavía), el client hace su propio fetch con loading.tsx
 * skeleton fallback.
 */
import { serverApiGet } from "@/lib/api/server";
import { MailboxClientView } from "./MailboxClientView";

interface MailboxItem {
  inbox_id: number;
  message_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  received_at: string;
  has_attachments: boolean;
  category: string | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  ai_suggested_action: string | null;
  status: string;
  classified_at: string | null;
  replied_at: string | null;
}

async function safeGet<T>(path: string): Promise<T | undefined> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return undefined;
  }
}

export default async function MailboxPage() {
  const initialItems = await safeGet<MailboxItem[]>("/admin/mailbox");
  return <MailboxClientView initialItems={initialItems} />;
}
