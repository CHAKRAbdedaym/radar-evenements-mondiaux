/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#0A1020",
        panel: "#121B30",
        panel2: "#16223B",
        line: "#1E2A47",
        line2: "#2A3A5E",
        cyan: { DEFAULT: "#3FD0C9", soft: "#3FD0C933", dim: "#2A8F8A" },
        alert: { DEFAULT: "#FF8A4C", soft: "#FF8A4C26" },
        ink: { DEFAULT: "#E6EDF7", 2: "#A9B4CC", 3: "#7D89A6" },
        lang: { ar: "#869A1A", fr: "#3987E5", en: "#D55181" },
        plus: "#5DD39E",
        minus: "#F27A7A",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', "system-ui", "sans-serif"],
        arabic: ['"IBM Plex Sans Arabic"', '"IBM Plex Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "inset 0 1px 0 rgba(255,255,255,0.03), inset 0 0 48px rgba(63,208,201,0.035)",
        glow: "0 0 24px rgba(63,208,201,0.25)",
      },
    },
  },
  plugins: [],
};
