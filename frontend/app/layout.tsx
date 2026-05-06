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
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
