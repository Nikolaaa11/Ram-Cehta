import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
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
      },
      backdropBlur: {
        xl: "24px",
      },
      transitionTimingFunction: {
        apple: "cubic-bezier(0.16, 1, 0.3, 1)",
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
      },
      animation: {
        shimmer: "shimmer 2s linear infinite",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
