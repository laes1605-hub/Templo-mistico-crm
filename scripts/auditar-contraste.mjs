// Audita el contraste (WCAG) de las combinaciones fondo/texto que realmente
// aparecen juntas en el código, para los temas claro y oscuro.
// Uso: node scripts/auditar-contraste.mjs
import fs from "node:fs";
import path from "node:path";

const cssFile = "src/app/_colors.generated.css";
const css = fs.readFileSync(cssFile, "utf8");

function varsOf(selector) {
  const i = css.indexOf(selector + " {");
  if (i < 0) throw new Error("No existe el bloque " + selector);
  const j = css.indexOf("\n}", i);
  const out = {};
  for (const line of css.slice(i, j).split("\n")) {
    const m = line.match(/--([\w-]+):\s*([\d]+ [\d]+ [\d]+);/);
    if (m) out[m[1]] = m[2].split(" ").map(Number);
  }
  return out;
}

const dark = varsOf(":root");
const light = { ...dark, ...varsOf("html.light") };

const SURFACES = {
  dark: { surface: [17, 24, 39], background: [9, 13, 22] },
  light: { surface: [255, 255, 255], background: [241, 243, 247] },
};

const lum = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const mix = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// purple/violet son alias del acento
const alias = (n) => (n === "purple" || n === "violet" ? "accent" : n);

function color(vars, token, fallbackBg) {
  // token: "gray-400", "white", "red-950/30", "surface", ...
  const [name, alphaRaw] = token.split("/");
  const alpha = alphaRaw ? Number(alphaRaw) / 100 : 1;
  let rgb;
  if (name === "white") rgb = [255, 255, 255];
  else if (name === "black") rgb = [0, 0, 0];
  else if (name === "surface") rgb = fallbackBg.surface;
  else if (name === "background") rgb = fallbackBg.background;
  else if (name === "surfaceHover") rgb = vars["tm-surface-hover"] || fallbackBg.surface;
  else {
    const m = name.match(/^([a-z]+)-(\d+)$/);
    if (!m) return null;
    rgb = vars[`${alias(m[1])}-${m[2]}`];
  }
  if (!rgb) return null;
  return { rgb, alpha };
}

// NOTA: el emparejamiento es heurístico. Cuando un mismo literal contiene un
// ternario (`activo ? "bg-purple-600 text-white" : "text-gray-400"`) se generan
// pares que nunca coexisten en pantalla; por eso el informe puede incluir
// falsos positivos como "bg-purple-600 + text-gray-400".

// --- extraer combinaciones bg+text del código -------------------------------
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(p)) files.push(p);
  }
})("src");

const TOKEN = "(?:white|black|surfaceHover|surface|background|[a-z]+-\\d{2,3})(?:\\/\\d{1,3})?";
const combos = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const chunk of src.match(/"[^"\n]*"|`[^`\n]*`/g) || []) {
    const bgs = chunk.match(new RegExp(`(?<![\\w:-])bg-${TOKEN}`, "g")) || [];
    const txts = chunk.match(new RegExp(`(?<![\\w:-])text-${TOKEN}`, "g")) || [];
    for (const bg of bgs)
      for (const t of txts) {
        const key = `${bg} + ${t}`;
        if (!combos.has(key)) combos.set(key, `${path.basename(f)}`);
      }
  }
}

let fails = 0;
for (const [theme, vars] of [["claro", light], ["oscuro", dark]]) {
  const surf = SURFACES[theme === "claro" ? "light" : "dark"];
  const bad = [];
  for (const [key] of combos) {
    const [bgTok, txtTok] = key.split(" + ");
    const bg = color(vars, bgTok.slice(3), surf);
    const fg = color(vars, txtTok.slice(5), surf);
    if (!bg || !fg) continue;
    const bgSolid = mix(bg.rgb, bg.alpha, surf.surface);
    const fgSolid = mix(fg.rgb, fg.alpha, bgSolid);
    const r = ratio(fgSolid, bgSolid);
    if (r < 4.5) bad.push([key, r.toFixed(2)]);
  }
  console.log(`\n== Tema ${theme}: ${bad.length} combinaciones por debajo de 4.5:1 ==`);
  bad.sort((a, b) => a[1] - b[1]).forEach(([k, r]) => console.log(`  ${r.padStart(5)}  ${k}`));
  fails += bad.length;
}
console.log(`\nCombinaciones analizadas: ${combos.size}`);
