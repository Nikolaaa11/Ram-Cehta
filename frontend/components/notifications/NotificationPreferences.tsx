"use client";

/**
 * NotificationPreferences — V4 fase 7.10.
 *
 * Panel de preferencias para controlar qué notificaciones recibís por
 * email vs in-app. Persiste en `app.user_preferences` con key
 * `notification_preferences`.
 *
 * Cada toggle es independiente — no requiere "Guardar" explícito.
 * Cambia, debounce 600ms, hace PUT y muestra check verde.
 */
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Check,
  Loader2,
  Mail,
  MailX,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Preferences {
  email_digest_weekly: boolean;
  email_critical_alerts: boolean;
  email_daily_summary: boolean;
  inapp_f29: boolean;
  inapp_contratos: boolean;
  inapp_oc_pendientes: boolean;
  inapp_legal: boolean;
  inapp_entregables: boolean;
}

const DEFAULT_PREFS: Preferences = {
  email_digest_weekly: true,
  email_critical_alerts: true,
  email_daily_summary: false,
  inapp_f29: true,
  inapp_contratos: true,
  inapp_oc_pendientes: true,
  inapp_legal: true,
  inapp_entregables: true,
};

const PREF_KEY = "notification_preferences";

const EMAIL_GROUP: Array<{
  key: keyof Preferences;
  title: string;
  description: string;
}> = [
  {
    key: "email_digest_weekly",
    title: "Digest semanal",
    description:
      "Lunes 8 AM Chile. Resumen de entregables vencidos / hoy / próx 7d + tasa YTD.",
  },
  {
    key: "email_critical_alerts",
    title: "Alertas críticas",
    description:
      "Email inmediato cuando un entregable vence en ≤3 días. Bypass del digest.",
  },
  {
    key: "email_daily_summary",
    title: "Resumen diario",
    description: "Email cada mañana con tu pipeline del día (próximos 7 días).",
  },
];

const INAPP_GROUP: Array<{
  key: keyof Preferences;
  title: string;
  description: string;
}> = [
  {
    key: "inapp_entregables",
    title: "Entregables regulatorios",
    description: "Alertas en la campana cuando un entregable se vuelve crítico.",
  },
  {
    key: "inapp_f29",
    title: "F29 por vencer",
    description:
      "Notificación cuando un F29 está próximo a vencer (5 días o menos).",
  },
  {
    key: "inapp_contratos",
    title: "Contratos por vencer",
    description: "Aviso 30 / 15 / 7 días antes del fin de vigencia.",
  },
  {
    key: "inapp_oc_pendientes",
    title: "OCs pendientes",
    description: "OCs sin movimiento por más de 7 días.",
  },
  {
    key: "inapp_legal",
    title: "Documentos legales",
    description: "Vencimientos de pólizas, contratos, escrituras.",
  },
];

export function NotificationPreferences() {
  const { session } = useSession();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedKey, setSavedKey] = useState<keyof Preferences | null>(null);
  const [savingKey, setSavingKey] = useState<keyof Preferences | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) return;
    let canceled = false;
    apiClient
      .get<{ key: string; value: Preferences }>(
        `/me/preferences/${PREF_KEY}`,
        session,
      )
      .then((res) => {
        if (canceled) return;
        // Merge con defaults para soportar nuevas keys agregadas más tarde
        setPrefs({ ...DEFAULT_PREFS, ...(res.value || {}) });
      })
      .catch((err) => {
        if (canceled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Primera vez — usar defaults
          setPrefs(DEFAULT_PREFS);
        } else {
          toast.error("No se pudo cargar tus preferencias");
          setPrefs(DEFAULT_PREFS);
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [session]);

  const saveDebounced = (next: Preferences, key: keyof Preferences) => {
    setSavingKey(key);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await apiClient.put(`/me/preferences/${PREF_KEY}`, { value: next }, session);
        setSavingKey(null);
        setSavedKey(key);
        setTimeout(() => setSavedKey(null), 2000);
      } catch (err) {
        setSavingKey(null);
        toast.error(
          err instanceof ApiError
            ? `Error guardando: ${err.detail}`
            : "Error guardando preferencias",
        );
      }
    }, 500);
  };

  const toggle = (key: keyof Preferences) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveDebounced(next, key);
  };

  if (loading || !prefs) {
    return (
      <Surface>
        <Surface.Header>
          <Surface.Title>Preferencias de notificaciones</Surface.Title>
        </Surface.Header>
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </Surface>
    );
  }

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <Surface.Title>Preferencias de notificaciones</Surface.Title>
        <Surface.Subtitle>
          Controlá qué te llega por mail y qué solo aparece en la campana de
          la app. Los cambios se guardan automáticamente.
        </Surface.Subtitle>
      </Surface.Header>

      <div className="mt-4 space-y-5">
        {/* EMAIL */}
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            <Mail className="h-3.5 w-3.5" strokeWidth={1.5} />
            Por email
          </p>
          <div className="space-y-1.5">
            {EMAIL_GROUP.map((item) => (
              <PrefRow
                key={item.key}
                title={item.title}
                description={item.description}
                checked={prefs[item.key]}
                onToggle={() => toggle(item.key)}
                saving={savingKey === item.key}
                saved={savedKey === item.key}
                Icon={prefs[item.key] ? Mail : MailX}
              />
            ))}
          </div>
        </section>

        {/* IN-APP */}
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />
            En la app (campana)
          </p>
          <div className="space-y-1.5">
            {INAPP_GROUP.map((item) => (
              <PrefRow
                key={item.key}
                title={item.title}
                description={item.description}
                checked={prefs[item.key]}
                onToggle={() => toggle(item.key)}
                saving={savingKey === item.key}
                saved={savedKey === item.key}
                Icon={prefs[item.key] ? Bell : BellOff}
              />
            ))}
          </div>
        </section>
      </div>

      <p className="mt-4 border-t border-hairline pt-3 text-[10px] text-ink-500">
        Las alertas críticas (vencimientos &lt; 24h) siempre llegan por
        ambos canales por seguridad operativa, independiente de estos
        ajustes.
      </p>
    </Surface>
  );
}

function PrefRow({
  title,
  description,
  checked,
  onToggle,
  saving,
  saved,
  Icon,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  saving: boolean;
  saved: boolean;
  Icon: typeof Mail;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        checked
          ? "border-cehta-green/30 bg-cehta-green/5 hover:bg-cehta-green/10"
          : "border-hairline bg-white hover:bg-ink-50",
      )}
    >
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          checked
            ? "bg-cehta-green/15 text-cehta-green"
            : "bg-ink-100 text-ink-400",
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="text-[11px] text-ink-500">{description}</p>
      </div>
      {/* Estado feedback */}
      <div className="w-5 shrink-0">
        {saving && (
          <Loader2
            className="h-4 w-4 animate-spin text-ink-400"
            strokeWidth={2}
          />
        )}
        {saved && !saving && (
          <Check className="h-4 w-4 text-positive" strokeWidth={2.5} />
        )}
      </div>
      {/* Toggle visual */}
      <div
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-cehta-green" : "bg-ink-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </div>
    </button>
  );
}
