import type { Config } from "tailwindcss";

/**
 * Dispatch design system — source: Figma "Ecran" (YJmfPIN235xRo0TZQcEYpx, node 67:632)
 * Tokens live in client/src/index.css. Usage rules: client/src/components/ui/DESIGN_SYSTEM.md
 * Never hardcode hex / rgba / text-[Npx] / rounded-[Npx] in pages: add a token here instead.
 */
export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      screens: {
        wide: "1440px", // full sidebar from here; icon rail between lg and wide
      },
      borderRadius: {
        xs: "4px", // highlight marks
        sm: "6px", // segmented items, skill tags
        md: "10px", // small buttons, menu items, inner tiles
        lg: "12px", // buttons, nav items, inputs
        xl: "12px", // inputs, textareas
        "2xl": "16px", // cards, rows, inner panels
        "3xl": "20px", // section panels
        "4xl": "24px", // auth frame, hero
      },
      fontSize: {
        "2xs": ["12px", { lineHeight: "16px" }], // readability floor: nothing below 12px
        eyebrow: ["14px", { lineHeight: "19px", letterSpacing: "0.2em" }],
        "eyebrow-sm": ["12px", { lineHeight: "16px", letterSpacing: "0.16em" }],
        display: ["44px", { lineHeight: "1.15", letterSpacing: "-0.035em" }],
        "display-lg": ["48px", { lineHeight: "1", letterSpacing: "-0.025em" }],
      },
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        field: "hsl(var(--field) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          strong: "hsl(var(--primary-strong) / <alpha-value>)",
          soft: "hsl(var(--primary-soft) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "hsl(var(--primary) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          soft: "hsl(var(--destructive-soft) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "hsl(var(--destructive) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          strong: "hsl(var(--success-strong) / <alpha-value>)",
          soft: "hsl(var(--success-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          strong: "hsl(var(--warning-strong) / <alpha-value>)",
          soft: "hsl(var(--warning-soft) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          soft: "hsl(var(--info) / 0.1)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--primary) / <alpha-value>)",
          "2": "hsl(var(--info) / <alpha-value>)",
          "3": "hsl(var(--success) / <alpha-value>)",
          "4": "hsl(var(--warning) / <alpha-value>)",
          "5": "hsl(var(--destructive) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--surface) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "hsl(var(--primary) / <alpha-value>)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--foreground) / <alpha-value>)",
          border: "hsl(var(--border) / <alpha-value>)",
        },
      },
      boxShadow: {
        cta: "0 10px 15px -3px hsl(var(--primary) / 0.2), 0 4px 6px -4px hsl(var(--primary) / 0.2)",
        "cta-sm": "0 1px 1px hsl(var(--primary) / 0.2)",
        nav: "0 2px 4px -2px hsl(var(--primary) / 0.2)",
        document: "0 2px 24px 0 rgb(0 0 0 / 0.07)",
        card: "0 1px 2px 0 hsl(var(--foreground) / 0.03), 0 12px 32px -16px hsl(var(--primary) / 0.12)",
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      backgroundImage: {
        "cta-gradient": "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary-strong)) 93%)",
        "highlight-panel": "linear-gradient(180deg, hsl(var(--primary-soft) / 0.35) 0%, hsl(var(--background)) 35%)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      maxWidth: {
        content: "1427px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
