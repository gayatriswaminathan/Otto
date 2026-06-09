#!/usr/bin/env node
// Otto — brand consistency gate.
// Asserts core/theme.mjs matches the CANONICAL landing page (autonomous-tpm-offer.html).
// The landing page is the single source of truth; theme.mjs must mirror it exactly.
// Dependency-free. Prints a PASS/FAIL diff and exits 1 on any mismatch.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The landing page is now the hosted homepage and the single source of truth.
const LANDING = resolve(__dirname, "../web/index.html");
const THEME = resolve(__dirname, "../core/theme.mjs");

const landing = readFileSync(LANDING, "utf8");
const theme = readFileSync(THEME, "utf8");

// --- extractors -----------------------------------------------------------

// Pull the first CSS var value, e.g. --bg:#faf6ea  -> "#faf6ea"
function cssVar(src, name) {
  const re = new RegExp("--" + name + "\\s*:\\s*([^;]+);");
  const m = src.match(re);
  return m ? m[1].trim().toLowerCase() : null;
}

// .logo width (the brand mark size) — first occurrence of `.logo{ ... width:NN`
function logoWidth(src) {
  const m = src.match(/\.logo\s*\{[^}]*?width\s*:\s*([0-9]+px)/);
  return m ? m[1].trim() : null;
}

// font-family on a selector that contains `needle` (a font name we expect to lead).
// Returns the first quoted family name in the first font-family declaration that
// starts with that needle.
function leadFont(src, needle) {
  const re = new RegExp('font-family\\s*:\\s*"(' + needle + ')"', "i");
  const m = src.match(re);
  return m ? m[1] : null;
}

// --- the brand fields we compare -------------------------------------------
// Note: the landing page names tinted-fill `--yellow-soft`, theme.mjs names it
// `--soft`; both must carry the SAME value. We map names accordingly.

const checks = [
  { label: ".logo width", expected: logoWidth(landing), actual: logoWidth(theme) },
  { label: "--bg", expected: cssVar(landing, "bg"), actual: cssVar(theme, "bg") },
  { label: "--paper", expected: cssVar(landing, "paper"), actual: cssVar(theme, "paper") },
  { label: "--ink", expected: cssVar(landing, "ink"), actual: cssVar(theme, "ink") },
  { label: "--muted", expected: cssVar(landing, "muted"), actual: cssVar(theme, "muted") },
  { label: "--line", expected: cssVar(landing, "line"), actual: cssVar(theme, "line") },
  { label: "--yellow", expected: cssVar(landing, "yellow"), actual: cssVar(theme, "yellow") },
  { label: "--yellow-deep", expected: cssVar(landing, "yellow-deep"), actual: cssVar(theme, "yellow-deep") },
  // tinted fill: landing's --yellow-soft must equal theme's --soft
  { label: "soft fill (--yellow-soft / --soft)", expected: cssVar(landing, "yellow-soft"), actual: cssVar(theme, "soft") },
  // fonts: heading family must lead with Fraunces, body with Geist, in BOTH files
  { label: "heading font (Fraunces) — landing", expected: "Fraunces", actual: leadFont(landing, "Fraunces") },
  { label: "heading font (Fraunces) — theme", expected: "Fraunces", actual: leadFont(theme, "Fraunces") },
  { label: "body font (Geist) — landing", expected: "Geist", actual: leadFont(landing, "Geist") },
  { label: "body font (Geist) — theme", expected: "Geist", actual: leadFont(theme, "Geist") },
];

// --- report ----------------------------------------------------------------

let failed = 0;
const pad = Math.max(...checks.map((c) => c.label.length));

console.log("Otto brand gate — theme.mjs vs autonomous-tpm-offer.html (canonical)\n");
for (const c of checks) {
  const ok = c.expected != null && c.actual != null && c.expected === c.actual;
  if (!ok) failed++;
  const tag = ok ? "PASS" : "FAIL";
  const line = `[${tag}] ${c.label.padEnd(pad)}  canonical=${c.expected ?? "<not found>"}  theme=${c.actual ?? "<not found>"}`;
  console.log(line);
}

console.log("");
if (failed > 0) {
  console.error(`Brand gate FAILED: ${failed} mismatch(es). theme.mjs must mirror the landing page exactly.`);
  process.exit(1);
}
console.log("Brand gate PASSED: theme.mjs matches the canonical landing page.");
