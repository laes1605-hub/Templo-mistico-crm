/** @type {import('tailwindcss').Config} */

// Genera una escala de color basada en variables CSS (permite temas dinámicos).
// Las variables se definen en src/app/_colors.generated.css
// (generado por `node scripts/generar-tema-css.mjs`).
const varScale = (name, shades) => {
  const scale = {};
  shades.forEach((s) => {
    scale[s] = `rgb(var(--${name}-${s}) / <alpha-value>)`;
  });
  return scale;
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Colores semánticos que se remapean en modo claro
const SEMANTIC = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "fuchsia", "pink", "rose",
];

const semanticColors = Object.fromEntries(
  SEMANTIC.map((c) => [c, varScale(c, SHADES)])
);

module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--tm-background) / <alpha-value>)",
        surface: "rgb(var(--tm-surface) / <alpha-value>)",
        surfaceHover: "rgb(var(--tm-surface-hover) / <alpha-value>)",
        border: "rgb(var(--tm-border) / <alpha-value>)",
        primary: "rgb(var(--accent-600) / <alpha-value>)",
        primaryHover: "rgb(var(--accent-700) / <alpha-value>)",
        // Velo de los modales: oscuro en ambos temas, pero más suave en claro
        scrim: "rgb(var(--tm-scrim) / var(--tm-scrim-alpha))",
        // Escala de grises adaptable (se invierte en modo claro)
        gray: varScale("gray", SHADES),
        // El acento (por defecto púrpura) se controla con --accent-*
        purple: varScale("accent", SHADES),
        violet: varScale("accent", SHADES),
        // Paletas semánticas adaptables al tema
        ...semanticColors,
      },
      boxShadow: {
        card: "0 1px 2px rgb(var(--tm-shadow) / calc(var(--tm-shadow-strength) * 0.6)), 0 1px 3px rgb(var(--tm-shadow) / calc(var(--tm-shadow-strength) * 0.4))",
      },
    },
  },
  plugins: [],
};
