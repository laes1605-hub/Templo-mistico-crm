/** @type {import('tailwindcss').Config} */

// Genera una escala de color basada en variables CSS (permite temas dinámicos)
const varScale = (name, shades) => {
  const scale = {};
  shades.forEach((s) => {
    scale[s] = `rgb(var(--${name}-${s}) / <alpha-value>)`;
  });
  return scale;
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

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
        // Escala de grises adaptable (se invierte en modo claro)
        gray: varScale("gray", SHADES),
        // El acento (por defecto púrpura) se controla con --accent-*
        purple: varScale("accent", SHADES),
        violet: varScale("accent", SHADES),
      },
    },
  },
  plugins: [],
};
