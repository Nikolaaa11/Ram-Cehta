/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typedRoutes: true,

  // V5++ ola BF — Optimizaciones de bundle y compilación
  // - swcMinify ya default en Next 15
  // - compress: gzip automático para responses static (ya default)
  // - reactCompiler experimental (opt-in cuando estable)
  experimental: {
    // Compresión más agresiva en respuestas streaming
    serverComponentsHmrCache: true,
    // Optimiza package imports — tree-shaking más estricto
    optimizePackageImports: [
      "lucide-react",
      "@tanstack/react-query",
      "date-fns",
      "framer-motion",
    ],
  },

  // V5++ ola BG — Compresión + imágenes
  compress: true,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400, // 24h cache de imágenes optimizadas
  },

  // Redirects a nivel edge (HTTP 308 permanente) — más confiables que
  // `redirect()` server-component cuando hay typed routes strict.
  async redirects() {
    return [
      {
        source: "/portafolio",
        destination: "/reportes/portafolio",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      // V5++ ola BF — Cache CDN agresivo para assets inmutables (Next.js
      // genera _next/static con hash en filename → safe forever cache)
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // V5++ ola BF — Cache CDN moderado para imágenes/iconos del public/
      {
        source: "/:path*(svg|jpg|jpeg|png|webp|avif|ico|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      // V5++ ola BF — Service Worker NUNCA debe cachearse
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
