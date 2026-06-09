// otto/eval/eval.mjs
// Otto's quality moat (KAN-31 / G4). Runs every fixture in eval/cases/*.json
// through the deterministic analyze() and asserts the watermelon flags Otto
// MUST produce — and the ones it MUST NOT — so CI blocks a regression in the
// engine's judgment.
//
//   node eval/eval.mjs
//
// A case file is:
//   {
//     name, why,
//     expect:        [titles that MUST be present],
//     expectAbsent:  [titles that MUST be absent],
//     expectReadinessNull?: true,   // optional: assert metrics.readiness === null
//     state: <ProgramState>
//   }
//
// Back-compat: the older nested shape `expect: { present:[], absent:[] }` is
// still honored.
//
// Expected titles are matched as a PREFIX of the real flag title, split on
// " · ", so "Overdue" (or "Overdue · ") matches the per-item flag
// "Overdue · SP-2".

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../engine/analyze.mjs";

const NOW = "2026-06-08"; // pin "today" so date-based flags are deterministic
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

// A flag satisfies an expected title if the title equals the whole flag title
// or its "Title · KEY" head. We compare on the segment before " · " so a
// case can assert "Overdue" / "Overdue · " without naming a specific key.
function flagMatches(flagTitle, expected) {
  const wantHead = String(expected).split(" · ")[0].trim();
  const gotHead = flagTitle.split(" · ")[0].trim();
  return gotHead === wantHead || flagTitle === expected;
}

function hasFlag(flags, expected) {
  return flags.some((f) => flagMatches(f.title, expected));
}

// Normalize either case shape into { present:[], absent:[] }.
function expectations(c) {
  const present = [
    ...(Array.isArray(c.expect) ? c.expect : c.expect?.present || []),
  ];
  const absent = [
    ...(Array.isArray(c.expectAbsent) ? c.expectAbsent : []),
    ...(Array.isArray(c.expect) ? [] : c.expect?.absent || []),
  ];
  return { present, absent };
}

function loadCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"));
      return { file, ...raw };
    });
}

function runCase(c) {
  const failures = [];
  const { flags, metrics } = analyze(c.state, NOW);
  const titles = flags.map((f) => f.title);
  const { present, absent } = expectations(c);

  for (const want of present) {
    if (!hasFlag(flags, want))
      failures.push(`expected flag "${want}" — got [${titles.join(", ") || "none"}]`);
  }
  for (const banned of absent) {
    if (hasFlag(flags, banned))
      failures.push(`flag "${banned}" should be ABSENT — but it fired`);
  }
  if (c.expectReadinessNull === true && metrics?.readiness !== null) {
    failures.push(
      `readiness should be null (no items) — got ${JSON.stringify(metrics?.readiness)}`
    );
  }
  return { failures, flagCount: flags.length };
}

function main() {
  const cases = loadCases();
  if (cases.length === 0) {
    console.error("No eval cases found in eval/cases/*.json");
    process.exit(1);
  }

  console.log(`\nOtto eval harness — ${cases.length} case(s), now=${NOW}\n`);
  const rows = [];
  let failed = 0;

  for (const c of cases) {
    const { failures, flagCount } = runCase(c);
    const pass = failures.length === 0;
    if (!pass) failed++;
    rows.push({
      result: pass ? "PASS" : "FAIL",
      case: c.name || c.file,
      flags: flagCount,
      detail: pass ? "" : failures.join("; "),
    });
  }

  // Print a simple aligned table.
  const nameW = Math.max(...rows.map((r) => r.case.length), 4);
  console.log(`  ${"RESULT".padEnd(6)} ${"CASE".padEnd(nameW)}  FLAGS`);
  console.log(`  ${"-".repeat(6)} ${"-".repeat(nameW)}  -----`);
  for (const r of rows) {
    console.log(`  ${r.result.padEnd(6)} ${r.case.padEnd(nameW)}  ${r.flags}`);
    if (r.detail) console.log(`         ↳ ${r.detail}`);
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed.\n`);
  if (failed > 0) {
    console.error(`✗ ${failed} case(s) failed — blocking.`);
    process.exit(1);
  }
  console.log("✓ All eval cases passed.");
}

main();
