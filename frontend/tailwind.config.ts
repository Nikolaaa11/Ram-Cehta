import type { Config } from "tailwindcss";
import animatePlugin from "tailwindcss-animate";

const config: Config = {
  // R152xx — darkMode removido. El script en app/layout.tsx remueve
  // forzosamente la class .dark del html (Round 26 fix de FOUC). Sin
  // ThemeProvider y sin dark mode funcional, las ~410 classes "dark:"
  // que hay en el JSX generaban CSS que NUNCA se activaba (~5-10 kB
  // gzipped de dead CSS). Al sacar este config, Tailwind ignora el
  // variant "dark:" y las classes en JSX quedan como strings sin efecto
  // pero NO generan CSS. Si en el futuro se reactiva dark mode,
  // restaurar: darkMode: ["class"]
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ─── Apple-style design tokens ────────────────────────────────────
        "cehta-green": {
          DEFAULT: "#1d6f42",
          50: "#f0f9f4",
          100: "#dcf0e3",
          500: "#1d6f42",
          600: "#155832",
          700: "#0e3f23",
        },
        positive: "#34c759",
        negative: "#ff3b30",
        warning: "#ff9500",
        "sf-blue": "#0a84ff",
        "sf-purple": "#5e5ce6",
        "sf-teal": "#64d2ff",
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f5f5f7",
          raised: "#ffffff",
        },
        ink: {
          900: "#1d1d1f",
          700: "#424245",
          500: "#6e6e73",
          300: "#a1a1a6",
          100: "#d2d2d7",
        },
        hairline: "rgba(0,0,0,0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        display: [
          '"SF Pro Display"',
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "sans-serif",
        ],
        mono: ['"SF Mono"', "ui-monospace", "Menlo", "monospace"],
        // Firma manuscrita: MISMA tipografía que estampa el PDF de la OC
        // (Great Vibes, OFL, self-hosted en /public/fonts). Así la vista
        // previa del diálogo de firma es fiel a lo que sale impreso.
        firma: ['"Great Vibes"', "cursive"],
      },
      fontSize: {
        "kpi-lg": [
          "2rem",
          { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "kpi-sm": [
          "1.25rem",
          { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.04)",
        "card-hover":
          "0 4px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06)",
        glass:
          "0 1px 0 rgba(255,255,255,0.6) inset, 0 1px 2px rgba(0,0,0,0.04)",
        // V5++ ola CA — premium shadow system
        "glow-green":
          "0 0 0 1px rgba(29,111,66,0.15), 0 6px 24px -8px rgba(29,111,66,0.35)",
        "glow-gold":
          "0 0 0 1px rgba(212,175,55,0.20), 0 6px 24px -8px rgba(212,175,55,0.45)",
        "glow-blue":
          "0 0 0 1px rgba(10,132,255,0.15), 0 6px 24px -8px rgba(10,132,255,0.35)",
        "glow-red":
          "0 0 0 1px rgba(255,59,48,0.15), 0 6px 24px -8px rgba(255,59,48,0.35)",
        "inner-glow":
          "inset 0 0 0 1px rgba(255,255,255,0.7), 0 1px 3px rgba(0,0,0,0.06)",
        "elevated-lg":
          "0 20px 40px -12px rgba(0,0,0,0.10), 0 8px 16px -8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
      },
      backdropBlur: {
        xl: "24px",
        "2xl": "40px",
      },
      backgroundImage: {
        // V5++ ola CA — premium gradients
        "gradient-cehta":
          "linear-gradient(135deg, #1d6f42 0%, #34c759 50%, #0a84ff 100%)",
        "gradient-gold":
          "linear-gradient(135deg, #b8860b 0%, #d4af37 50%, #f5cf5b 100%)",
        "gradient-radial":
          "radial-gradient(ellipse at center, var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "mesh-default":
          "radial-gradient(at 12% 18%, hsla(155, 60%, 35%, 0.18) 0px, transparent 50%), radial-gradient(at 82% 22%, hsla(43, 92%, 56%, 0.14) 0px, transparent 55%), radial-gradient(at 50% 88%, hsla(212, 96%, 52%, 0.10) 0px, transparent 50%)",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.16, 1, 0.3, 1)",
        "out-expo": "cubic-bezier(0.19, 1, 0.22, 1)",
        "out-back": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(0.85)" },
        },
        // V5++ ola CA — new animations
        "slide-up-fade": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down-fade": {
          from: { opacity: "0", transform: "translateY(-12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-fade-in": {
          from: { opacity: "0", transform: "scale(0.92)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "blur-in": {
          from: { opacity: "0", filter: "blur(8px)" },
          to: { opacity: "1", filter: "blur(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "gradient-flow": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.4)", opacity: "0" },
        },
        "bounce-soft": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
      },
      animation: {
        shimmer: "shimmer 2s linear infinite",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        "slide-up-fade": "slide-up-fade 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down-fade": "slide-down-fade 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-fade-in": "scale-fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "blur-in": "blur-in 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.3s ease-out",
        "gradient-flow": "gradient-flow 8s ease infinite",
        float: "float 4s ease-in-out infinite",
        "spin-slow": "spin-slow 4s linear infinite",
        "pulse-ring": "pulse-ring 1.6s ease-out infinite",
        "bounce-soft": "bounce-soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [animatePlugin],
};

export default config;
