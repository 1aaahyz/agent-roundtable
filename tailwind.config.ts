import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dfe3ea",
          300: "#c5ccd8",
          400: "#98a2b3",
          500: "#6b7688",
          600: "#4d586b",
          700: "#364153",
          800: "#232b3a",
          900: "#141a24",
        },
        brand: {
          50: "#eef4ff",
          100: "#dbe8ff",
          200: "#bcd4ff",
          500: "#3b6fe0",
          600: "#2d59c4",
          700: "#24479e",
        },
        semantic: {
          success: "#16855b",
          warning: "#b7791f",
          danger: "#c0392b",
          info: "#3b6fe0",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(20,26,36,.04), 0 1px 3px rgba(20,26,36,.06)",
        pop: "0 12px 32px rgba(20,26,36,.14), 0 2px 8px rgba(20,26,36,.08)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in .18s ease-out both",
        "slide-in": "slide-in .2s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
