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
        {/* Anti-FOUC: aplica dark class antes de hidratar React.
            Sin esto, en SSR se renderea light y al hidratar
            cambia → flash blanco→negro fea. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              try {
                var t = localStorage.getItem('cehta-theme');
                var prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
                var dark = t === 'dark' || (t === 'system' && prefers) || (!t && prefers);
                if (dark) document.documentElement.classList.add('dark');
              } catch (_) {}
            })();`,
          }}
        />
        {/* V5++ perf: warmup de TCP/TLS al backend antes que React monte. */}
        <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={apiOrigin} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
