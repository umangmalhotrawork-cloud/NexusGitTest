import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./desktop/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        heading: ["'Inter'", "system-ui", "-apple-system", "sans-serif"],
        body: ["'Inter'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "liberation mono", "courier new", "monospace"],
      },
      colors: {
        background: "#0A0B0D",
        surface: "#0E1013",
        "surface-border": "#22252B",
        "surface-hover": "#1A1C22",
        "surface-card": "#111318",
        "surface-raised": "#1A1C22",
        "surface-input": "#14161B",
        "border-strong": "#2E323B",
        cyan: {
          glow: "#4CC2DE",
          dim: "#173747",
        },
      },
      borderRadius: {
        "24": "12px",
      },
      boxShadow: {
        popover: "0 4px 16px rgba(0, 0, 0, 0.4)",
        modal: "0 8px 32px rgba(0, 0, 0, 0.5)",
        "cyan-glow": "none",
        "cyan-glow-lg": "none",
        "violet-glow": "none",
      },
    },
  },
  plugins: [],
};
export default config;
