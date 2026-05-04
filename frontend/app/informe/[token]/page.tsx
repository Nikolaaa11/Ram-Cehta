"use client";

/**
 * /informe/[token] — vista pública del informe LP.
 *
 * Sin auth (token = auth). Tracking automático: dispara `open` event
 * al cargar, `time_spent` al salir, `scroll` events en 25/50/75/100%.
 *
 * Soft-fail: si el endpoint no responde, mostrar página minimalista
 * con CTA para contactar a Camilo.
 */
import { use, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Download, Mail, Share2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { HeroSection } from "@/components/informe-lp/HeroSection";
import { PerformanceSection } from "@/components/informe-lp/PerformanceSection";
import { OutlookSection } from "@/components/informe-lp/OutlookSection";
import { EmpresaShowcaseGrid } from "@/components/informe-lp/EmpresaShowcase";
import { TuPosicionSection } from "@/components/informe-lp/TuPosicionSection";
import { ESGImpactSection } from "@/components/informe-lp/ESGImpactSection";
import { ShareCard } from "@/components/informe-lp/ShareCard";
import type { InformeLpPublicView } from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function InformePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const startTimeRef = useRef<number>(Date.now());
  const [scrollMilestones, setScrollMilestones] = useState<Set<number>>(
    new Set(),
  );
  const [shareOpen, setShareOpen] = useState(false);

  const query = useQuery<InformeLpPublicView, Error>({
    queryKey: ["informe", token],
    queryFn: async () => {
      // Endpoint público — no necesita session
      const url = `${API_BASE}/informes-lp/by-token/${token}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body?.detail ?? detail;
        } catch {
          // ignore
        }
        throw new ApiError(res.status, detail);
      }
      return res.json();
    },
    retry: false,
  });

  // ─── Tracking effects ───────────────────────────────────────────────────

  // Track open inicial
  useEffect(() => {
    if (!query.data) return;
    void track(token, { tipo: "open" });
  }, [query.data, token]);

  // Track time_spent al salir / cerrar pestaña
  useEffect(() => {
    const onBeforeUnload = () => {
      const seconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
      // sendBeacon es la forma confiable durante unload
      const payload = JSON.stringify({
        tipo: "time_spent",
        valor_numerico: seconds,
      });
      try {
        navigator.sendBeacon(
          `${API_BASE}/informes-lp/by-token/${token}/track`,
          new Blob([payload], { type: "application/json" }),
        );
      } catch {
        // best-effort
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [token]);

  // Track scroll milestones (25/50/75/100%)
  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const scrollHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;
      const pct = Math.round((scrollTop / scrollHeight) * 100);
      const milestones = [25, 50, 75, 100];
      for (const m of milestones) {
        if (pct >= m && !scrollMilestones.has(m)) {
          setScrollMilestones((prev) => new Set([...prev, m]));
          void track(token, { tipo: "scroll", valor_numerico: m });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [token, scrollMilestones]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-ink-500">Cargando tu informe…</div>
      </div>
    );
  }

  if (query.isError) {
    return <ErrorState error={query.error} />;
  }

  const informe = query.data!;

  return (
    <main className="min-h-screen bg-white">
      <HeroSection informe={informe} />

      {/* Indicador de "scroll para más" */}
      <div className="flex justify-center -mt-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-ink-500 shadow-md ring-1 ring-hairline">
          <ArrowDown className="h-3 w-3" strokeWidth={2} />
          Continuar
        </span>
      </div>

      <PerformanceSection informe={informe} />

      <TuPosicionSection informe={informe} />

      <EmpresaShowcaseGrid informe={informe} />

      <ESGImpactSection informe={informe} />

      <OutlookSection informe={informe} />

      {/* CTA section con share */}
      <section className="bg-gradient-to-b from-cehta-green-700 to-ink-900 px-6 py-20 text-white">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">
            ¿Querés saber más?
          </h2>
          <p className="mt-3 text-base text-white/80">
            Agendá una conversación con Camilo Salazar (GP del fondo) y
            conversemos sobre tu posición.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="mailto:camilo@cehtacapital.cl?subject=Reunión sobre el FIP CEHTA ESG"
              onClick={() =>
                track(token, { tipo: "agendar_click", seccion: "cta" })
              }
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-cehta-green-700 transition-colors hover:bg-white/90"
            >
              <Mail className="h-4 w-4" strokeWidth={2} />
              Agendar 30 min con Camilo
            </a>
            <button
              type="button"
              onClick={() => {
                setShareOpen(true);
                void track(token, {
                  tipo: "share_click",
                  seccion: "cta",
                });
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20"
            >
              <Share2 className="h-4 w-4" strokeWidth={2} />
              Pasarlo a un colega
            </button>
            <button
              type="button"
              onClick={() => {
                void track(token, { tipo: "pdf_download", seccion: "cta" });
                window.print();
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20 print:hidden"
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              Descargar PDF
            </button>
          </div>

          {informe.is_expired && (
            <p className="mt-8 text-xs text-white/60">
              Este informe es de {informe.periodo}. Pedile a Camilo el último
              actualizado.
            </p>
          )}
        </div>
      </section>

      {/* Sticky FAB de share en mobile — escondido en print */}
      <button
        type="button"
        onClick={() => {
          setShareOpen(true);
          void track(token, { tipo: "share_click", seccion: "fab" });
        }}
        aria-label="Compartir informe"
        className="fixed bottom-6 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-cehta-green text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 sm:hidden print:hidden"
      >
        <Share2 className="h-5 w-5" strokeWidth={2} />
      </button>

      {shareOpen && (
        <ShareCard token={token} onClose={() => setShareOpen(false)} />
      )}

      {/* Footer */}
      <footer className="bg-ink-900 px-6 py-8 text-center text-xs text-white/40">
        <p>
          Cehta Capital · FIP CEHTA ESG · AFIS S.A. RUT 77.423.556-6
        </p>
        {informe.lp_nombre && (
          <p className="mt-1 text-[10px]">
            Generado para {informe.lp_nombre}
            {informe.lp_apellido && ` ${informe.lp_apellido}`}
            {informe.publicado_at && (
              <span>
                {" "}
                · {new Date(informe.publicado_at).toLocaleDateString("es-CL")}
              </span>
            )}
          </p>
        )}
      </footer>
    </main>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function track(
  token: string,
  body: { tipo: string; seccion?: string; valor_numerico?: number },
): Promise<void> {
  try {
    await fetch(`${API_BASE}/informes-lp/by-token/${token}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Tracking best-effort. Si falla, no rompe la UX.
  }
}

function ErrorState({ error }: { error: Error }) {
  const isApi = error instanceof ApiError;
  const status = isApi ? error.status : 0;
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-cehta-green via-cehta-green-700 to-ink-900 px-6 text-white">
      <div className="max-w-md text-center">
        <p className="font-display text-5xl font-bold text-white/30">
          {status === 404 ? "404" : "Error"}
        </p>
        <h1 className="mt-4 font-display text-2xl font-semibold">
          {status === 404
            ? "Informe no encontrado"
            : "Algo salió mal"}
        </h1>
        <p className="mt-3 text-sm text-white/70">
          {status === 404
            ? "El link puede haber expirado o ser inválido. Pedile a tu relationship manager el último."
            : isApi
            ? error.detail
            : "Intentá nuevamente en unos segundos."}
        </p>
        <a
          href="mailto:camilo@cehtacapital.cl"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-cehta-green-700"
        >
          <Mail className="h-4 w-4" strokeWidth={2} />
          Contactar a Camilo
        </a>
      </div>
    </div>
  );
}
