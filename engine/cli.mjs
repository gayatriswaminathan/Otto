#!/usr/bin/env node
// Otto — composed rollup pipeline (replaces generate_rollup.mjs).
// Usage:  node engine/cli.mjs [stateFile] [--cadence=weekly|biweekly|monthly|quarterly] > rollup.html
//
// Reads a program-state JSON (default ../data/demo_program.json — the rich
// multi-source demo; pass a path arg for the real KAN board), runs
// analyze -> narrate (no LLM) -> renderRollupHTML, writes HTML to stdout.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { analyze } from "./analyze.mjs";
import { narrate } from "./narrate.mjs";
import { renderRollupHTML } from "./render.mjs";
import { validateCadence } from "../core/cadence.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function resolveStateFile(arg) {
  if (arg) return resolve(process.cwd(), arg);
  const def = resolve(here, "../data/demo_program.json");
  if (existsSync(def)) return def;
  const kan = resolve(here, "../data/program_state_kan.json");
  if (existsSync(kan)) return kan;
  return resolve(here, "../eval/cases/kan_fixture.json"); // fixture fallback
}

// Pull --cadence=<v> from argv (default weekly); positional arg = state file.
function parseArgs(argv) {
  let stateFile;
  let cadence = "weekly";
  for (const a of argv) {
    const m = /^--cadence=(.*)$/.exec(a);
    if (m) cadence = validateCadence(m[1]); // throws on unknown
    else if (!a.startsWith("--") && stateFile === undefined) stateFile = a;
  }
  return { stateFile, cadence };
}

async function main() {
  const { stateFile, cadence } = parseArgs(process.argv.slice(2));
  const file = resolveStateFile(stateFile);
  const state = JSON.parse(readFileSync(file, "utf8"));

  const analysis = analyze(state); // deterministic, now defaults to 2026-06-08
  analysis.cadence = cadence; // render the right label locally (no D1 -> no delta)
  const narrative = await narrate(state, analysis); // no callClaude -> templates
  const html = renderRollupHTML(state, analysis, narrative);

  process.stdout.write(html);
}

main().catch((err) => {
  process.stderr.write(`otto/cli: ${err?.stack || err}\n`);
  process.exit(1);
});
