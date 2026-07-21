import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // MIGRACIÓN de marca: de violeta a verde KA (DY Knowledge Assistant).
        // El accent verde (#10a37f) es la palanca visual principal: recolorea
        // todos los botones, enlaces y estados activos de la app de una vez.
        brand: { DEFAULT: "#10a37f", dark: "#0d8a6a" },
      },
      fontFamily: {
        // Stack system-ui igual que el KA de referencia.
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
