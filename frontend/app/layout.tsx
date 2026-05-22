import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cehta Capital",
  description: "Plataforma administrativa-financiera FIP CEHTA ESG",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Cehta",
  },
  icons: {
    icon: "/logos/cehta.png",
    apple: "/logos/cehta.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1d6f42",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // V5++ perf: preconnect al backend ahorra ~200-500ms en el primer fetch
  // (TLS handshake + DNS resolution se hacen mientras el HTML aún está
  // parseando, en paralelo). Sin esto, el browser espera hasta que React
  // monta para empezar a conectar.
  const apiOrigin = (
    process.env.NEXT_PUBLIC_API_URL ?? "https://cehta-backend.fly.dev/api/v1"
  ).replace(/\/api\/v1\/?$/, "");
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* V5++ ola CA hotfix 2: LIGHT MODE FORZADO PERMANENTE.
            Migración: limpia cualquier preference 'dark' previa en
            localStorage de TODOS los users. La plataforma está diseñada
            light-first (verde Cehta sobre blanco). Si en el futuro se
            quiere restaurar dark mode con toggle, remover el migration
            flag y la línea `removeItem`. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              try {
                // Limpieza forzada — borra cualquier value 'dark' previo
                localStorage.removeItem('cehta-theme');
                // Garantiza que html.dark NO esté nunca presente
                document.documentElement.classList.remove('dark');
              } catch (_) {}
            })();`,
          }}
        />
        {/* V5++ perf: warmup de TCP/TLS al backend antes que React monte. */}
        <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={apiOrigin} />
        {/* V5++ ola BG — preconnect a Supabase Auth (login JWT verify) */}
        <link
          rel="preconnect"
          href="https://supabase.co"
          crossOrigin="anonymous"
        />
        <link rel="dns-prefetch" href="https://supabase.co" />
        {/* V5++ ola BG — Resource hints adicionales */}
        <meta name="format-detection" content="telephone=no" />
        {/* V5++ ola CA fix: forzar color-scheme=light por default para que
            inputs/scrollbars no se pinten dark automáticamente. */}
        <meta name="color-scheme" content="light" />
        {/* Round 133 — Marker visible para validar que el bundle Vercel
            servido es el más reciente. Se puede leer con curl en el HTML
            sin necesidad de auth. Si este marker se ve === bundle nuevo
            está deployado. Si no se ve === Vercel sirve build viejo. */}
        <meta name="x-cehta-build" content="2026-05-22-R144-adjunto-no-obligatorio" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
