// Genera los bloques de variables de color de src/app/globals.css
// a partir de la paleta oficial de Tailwind.
//
// Idea: TODAS las escalas de color se exponen como variables CSS
// (--red-500, --emerald-300, ...). En modo oscuro valen lo mismo que
// en Tailwind; en modo claro se remapean para que la MISMA clase
// (p.ej. bg-red-950/30 o text-emerald-300) siga teniendo el sentido
// visual correcto sobre fondos blancos.
//
// Uso: node scripts/generar-tema-css.mjs  (reescribe la sección auto-generada)

import fs from "node:fs";
import path from "node:path";
import colors from "tailwindcss/colors.js";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Colores semánticos usados en la app (además de gris y acento)
const COLOR_NAMES = [
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "fuchsia", "pink", "rose",
];

// Acentos configurables
const ACCENTS = {
  purple: "purple",
  blue: "blue",
  emerald: "emerald",
  rose: "rose",
  amber: "amber",
  cyan: "cyan",
};

/**
 * Mapa de remapeo para modo claro.
 * origen -> tono real de la paleta que se usará en claro.
 *  - tonos altos (800-950): se usan como bordes/fondos tenues => se aclaran
 *  - tonos bajos (100-400): se usan como TEXTO/iconos => se oscurecen
 *  - tonos medios (500-700): botones sólidos con texto blanco => casi intactos
 */
const LIGHT_MAP = {
  50: 950,   // texto casi negro del color
  100: 900,
  200: 800,
  300: 700,  // texto/iconos de color sobre blanco
  400: 700,
  500: 600,
  600: 600,  // botones sólidos con texto blanco
  700: 700,  // hover de esos botones
  800: 400,  // bordes tintados (visibles incluso con alfa 0.4-0.6)
  900: 200,  // fondos tintados suaves
  950: 200,  // fondos tintados muy suaves (se usan con opacidad baja)
};

// Tonos que se usan como texto/icono o como fondo sólido con texto blanco:
// deben cumplir contraste AA (>= 4.5:1) frente al blanco. Si el tono mapeado
// no llega, se busca automáticamente uno más oscuro de la misma paleta.
const AA_SHADES = [200, 300, 400, 500, 600, 700];
// Se exige algo más que 4.5:1 sobre blanco porque estos tonos suelen ir sobre
// fondos LIGERAMENTE tintados (bg-amber-950/40, etc.), que restan contraste.
const AA_RATIO = 5.5;

function hexToRgb(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgb = (hex) => hexToRgb(hex).join(" ");

function relLuminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastOnWhite(hex) {
  const l = relLuminance(hexToRgb(hex));
  return 1.05 / (l + 0.05);
}

/** Primer tono >= 600 que cumple AA sobre blanco (base de los botones sólidos). */
function solidBase(name) {
  for (const s of [600, 700, 800, 900]) {
    if (contrastOnWhite(colors[name][s]) >= AA_RATIO) return s;
  }
  return 700;
}

/** Devuelve el tono de `name` a usar en modo claro para la clase `shade`. */
function lightShade(name, shade) {
  const base = solidBase(name);

  // 500/600/700 son fondos sólidos con texto blanco (botones y sus hovers):
  // hay que conservar SIEMPRE tres escalones distintos para que el hover se note.
  if (shade === 600) return base;
  if (shade === 700) return Math.min(900, base + 100);
  if (shade === 500) return Math.max(500, base - 100);

  // Tonos usados como texto/icono de color sobre blanco: forzar AA.
  if (AA_SHADES.includes(shade)) {
    for (const s of SHADES.filter((x) => x >= LIGHT_MAP[shade])) {
      if (contrastOnWhite(colors[name][s]) >= AA_RATIO) return s;
    }
    return 900;
  }

  return LIGHT_MAP[shade];
}

function darkVars(name, prefix = name) {
  return SHADES.map((s) => `  --${prefix}-${s}: ${rgb(colors[name][s])};`).join("\n");
}

function lightVars(name, prefix = name) {
  return SHADES.map(
    (s) => `  --${prefix}-${s}: ${rgb(colors[name][lightShade(name, s)])};`
  ).join("\n");
}

// Grises: escala propia y afinada a mano para garantizar contraste (WCAG AA)
// sobre fondos blancos/casi blancos.
const LIGHT_GRAY = {
  50: "3 7 18",        // títulos casi negros
  100: "17 24 39",     // texto principal
  200: "31 41 55",     // texto fuerte
  300: "55 65 81",     // texto secundario fuerte
  400: "71 85 105",    // texto secundario
  500: "93 101 116",   // texto terciario (AA sobre blanco y sobre gris-800)
  600: "104 112 127",  // hints / placeholders (AA sobre blanco)
  700: "203 209 218",  // bordes marcados
  800: "228 232 238",  // superficies alternas
  900: "240 242 246",  // superficies suaves
  950: "248 249 251",
};

const DARK_GRAY = SHADES.map((s) => `  --gray-${s}: ${rgb(colors.gray[s])};`).join("\n");
const LIGHT_GRAY_CSS = SHADES.map((s) => `  --gray-${s}: ${LIGHT_GRAY[s]};`).join("\n");

let out = "";
out += "/* === AUTO-GENERADO por scripts/generar-tema-css.mjs — no editar a mano === */\n\n";

/* ---------- MODO OSCURO (raíz) ---------- */
out += ":root {\n";
out += "  color-scheme: dark;\n\n";
out += "  /* Superficies */\n";
out += "  --tm-background: 9 13 22;\n";
out += "  --tm-surface: 17 24 39;\n";
out += "  --tm-surface-hover: 31 41 55;\n";
out += "  --tm-border: 30 41 59;\n";
out += "  --tm-scrim: 2 6 14;\n";
out += "  --tm-scrim-alpha: 0.7;\n";
out += "  --tm-shadow: 0 0 0;\n";
out += "  --tm-shadow-strength: 0.5;\n\n";
out += "  /* Grises */\n" + DARK_GRAY + "\n\n";
out += "  /* Acento por defecto: púrpura místico */\n" + darkVars("purple", "accent") + "\n\n";
for (const c of COLOR_NAMES) {
  out += `  /* ${c} */\n` + darkVars(c) + "\n\n";
}
out += "  --scrollbar-track: #090d16;\n";
out += "  --scrollbar-thumb: #1f2937;\n";
out += "  --scrollbar-thumb-hover: #374151;\n";
out += "}\n\n";

/* ---------- MODO CLARO ---------- */
out += "/* ===================== MODO CLARO ===================== */\n";
out += "html.light {\n";
out += "  color-scheme: light;\n\n";
out += "  /* Superficies: blanco puro sobre un lienzo gris muy suave */\n";
out += "  --tm-background: 241 243 247;\n";
out += "  --tm-surface: 255 255 255;\n";
out += "  --tm-surface-hover: 243 245 249;\n";
out += "  --tm-border: 219 224 232;\n";
out += "  --tm-scrim: 15 23 42;\n";
out += "  --tm-scrim-alpha: 0.45;\n";
out += "  --tm-shadow: 15 23 42;\n";
out += "  --tm-shadow-strength: 0.08;\n\n";
out += "  /* Grises (invertidos y ajustados para contraste AA) */\n" + LIGHT_GRAY_CSS + "\n\n";
out += "  /* Acento por defecto en claro */\n" + lightVars("purple", "accent") + "\n\n";
for (const c of COLOR_NAMES) {
  out += `  /* ${c} */\n` + lightVars(c) + "\n\n";
}
out += "  --scrollbar-track: #eceef3;\n";
out += "  --scrollbar-thumb: #c3cad6;\n";
out += "  --scrollbar-thumb-hover: #9aa4b4;\n";
out += "}\n\n";

/* ---------- ACENTOS ---------- */
out += "/* ===================== ACENTOS ===================== */\n";
for (const [id, name] of Object.entries(ACCENTS)) {
  out += `html[data-accent="${id}"] {\n${darkVars(name, "accent")}\n}\n`;
  out += `html.light[data-accent="${id}"] {\n${lightVars(name, "accent")}\n}\n\n`;
}

const target = path.join(process.cwd(), "src/app/_colors.generated.css");
fs.writeFileSync(target, out);
console.log("✔ Escrito", target);
