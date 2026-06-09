// otto/eval/eval_deps.mjs
// Offer-parity eval (v2). Tests the TWO new engine outputs Otto's landing page
// sells — "Risk & dependency map" and "Full readiness assessment + scorecard" —
// directly against their exports, so CI blocks a regression in either.
//
//   node eval/eval_deps.mjs   (npm run eval:deps)
//
// Why a SECOND eval file (not folded into eval.mjs): eval.mjs is the watermelon
// flag harness — it loads JSON fixtures through analyze() and asserts flag
// titles. This one imports buildDependencies()/assessReadiness() and asserts
// graph + gate structure. Different shapes, different exports — kept separate so
// one can stay green while the other is mid-build, and the rollup-flag eval is
// untouched.
//
// Contract under test (core/CONTRACT.md "Offer parity v2"):
//   engine/dependencies.mjs → buildDependencies(state) ->
//     { source:"links"|"inferred", nodes:[{key,summary,status}],
//       edges:[{from,to,type}], roots:[key],
//       blocked:[{key, blockedBy:[key]}], criticalPath:[key], cycles:[[key]] }
//   engine/readiness.mjs → assessReadiness(state) ->
//     { score:0-100, grade:"Not started"|"At risk"|"On track"|"Ready",
//       gates:[{name,pass,detail}], perEpic:[{key, score, gates:[{name,pass}]}] }
//
// Cases are inline (self-contained) so this file runs even before the JSON
// fixtures exist. Zero deps — node built-ins only.

import { buildDependencies } from "../engine/dependencies.mjs";
import { assessReadiness } from "../engine/readiness.mjs";

// ---------------------------------------------------------------------------
// Tiny assertion helpers — collect failures, never throw mid-case.
// ---------------------------------------------------------------------------
function makeCheck(failures) {
  return function check(label, cond) {
    if (!cond) failures.push(label);
  };
}

// Gate lookup by name (case-insensitive) from a gates[] list.
function gate(gates, name) {
  return (gates || []).find(
    (g) => String(g.name).toLowerCase() === name.toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// State builders — minimal ProgramStates matching the canonical model.
// ---------------------------------------------------------------------------
function epic(key, summary, status, children) {
  const child_counts = {};
  for (const c of children) child_counts[c.status] = (child_counts[c.status] || 0) + 1;
  return { key, summary, status, children, child_counts };
}
function story(key, summary, status, extra = {}) {
  return {
    key,
    summary,
    type: "Story",
    status,
    priority: extra.priority ?? "Medium",
    duedate: extra.duedate ?? null,
    assignee: extra.assignee ?? null,
    links: extra.links ?? [],
  };
}
function state(program, epics) {
  const items = epics.flatMap((e) => e.children);
  const by_status = {};
  for (const i of items) by_status[i.status] = (by_status[i.status] || 0) + 1;
  return {
    program,
    source: "jira",
    generated_at: "2026-06-08",
    totals: {
      by_type: { Epic: epics.length, Story: items.length },
      by_status,
      total: items.length,
    },
    epics,
    orphans: [],
    flags: [],
  };
}

// ===========================================================================
// CASE 1 — Linked chain: A blocks B, B blocks C (via real issue links).
// Expect: source "links", 2 edges, critical path of length >=3, B & C blocked
// (their blockers aren't Done).
// ===========================================================================
function caseLinkedChain() {
  const failures = [];
  const check = makeCheck(failures);

  const s = state("Linked chain", [
    epic("CH-1", "Delivery", "In Progress", [
      story("CH-A", "A — schema", "In Progress", {
        priority: "High",
        duedate: "2026-06-20",
        assignee: "Asha",
        links: [{ type: "blocks", key: "CH-B" }],
      }),
      story("CH-B", "B — API", "To Do", {
        priority: "High",
        duedate: "2026-06-25",
        assignee: "Beto",
        links: [
          { type: "is blocked by", key: "CH-A" },
          { type: "blocks", key: "CH-C" },
        ],
      }),
      story("CH-C", "C — client", "To Do", {
        priority: "Medium",
        duedate: "2026-06-30",
        assignee: "Cira",
        links: [{ type: "is blocked by", key: "CH-B" }],
      }),
    ]),
  ]);

  const d = buildDependencies(s);

  check('source === "links"', d.source === "links");
  // A→B and B→C => exactly 2 directed edges.
  check("edges count === 2", Array.isArray(d.edges) && d.edges.length === 2);
  check(
    "criticalPath length >= 3",
    Array.isArray(d.criticalPath) && d.criticalPath.length >= 3
  );

  const blockedKeys = new Set((d.blocked || []).map((b) => b.key));
  // B is blocked by A (A is In Progress, not Done) — must appear blocked.
  check("B in blocked", blockedKeys.has("CH-B"));
  // C is blocked by B (B is To Do, not Done) — must appear blocked.
  check("C in blocked", blockedKeys.has("CH-C"));

  return { name: "1 · linked chain", failures, info: `source=${d.source} edges=${d.edges?.length}` };
}

// ===========================================================================
// CASE 2 — Cycle: A blocks B, B blocks A. Expect cycles non-empty.
// ===========================================================================
function caseCycle() {
  const failures = [];
  const check = makeCheck(failures);

  const s = state("Cycle", [
    epic("CY-1", "Loop", "In Progress", [
      story("CY-A", "A", "To Do", { links: [{ type: "blocks", key: "CY-B" }] }),
      story("CY-B", "B", "To Do", { links: [{ type: "blocks", key: "CY-A" }] }),
    ]),
  ]);

  const d = buildDependencies(s);

  check('source === "links"', d.source === "links");
  check(
    "cycles non-empty",
    Array.isArray(d.cycles) && d.cycles.length > 0 && d.cycles[0].length > 0
  );

  return {
    name: "2 · cycle",
    failures,
    info: `cycles=${JSON.stringify(d.cycles)}`,
  };
}

// ===========================================================================
// CASE 3 — No links anywhere: fall back to inferred root. Expect
// source "inferred" and roots = the Foundation/name-matched epic.
// ===========================================================================
function caseNoLinks() {
  const failures = [];
  const check = makeCheck(failures);

  const s = state("No links", [
    epic("NL-1", "Foundation — platform", "In Progress", [
      story("NL-2", "Auth", "In Progress", { assignee: "Asha" }),
      story("NL-3", "Data model", "To Do", { assignee: "Beto" }),
    ]),
    epic("NL-9", "Reporting", "To Do", [
      story("NL-10", "Dashboards", "To Do", { assignee: "Cira" }),
    ]),
  ]);

  const d = buildDependencies(s);

  check('source === "inferred"', d.source === "inferred");
  // Inferred root must be the name-matched (foundation/infra/platform/core) epic.
  check(
    "roots === [NL-1] (name-matched epic)",
    Array.isArray(d.roots) && d.roots.includes("NL-1")
  );

  return {
    name: "3 · no links → inferred",
    failures,
    info: `source=${d.source} roots=${JSON.stringify(d.roots)}`,
  };
}

// ===========================================================================
// CASE 4 — Readiness gates.
// 4a: board missing owners + dates → "Owned" and "Scheduled" gates FAIL, low grade.
// 4b: healthy board (owned, dated, in motion, no blocks) → all gates PASS, high grade.
// ===========================================================================
function caseReadinessGates() {
  const failures = [];
  const check = makeCheck(failures);

  // ---- 4a: unowned + undated board ----------------------------------------
  const bad = state("Unowned undated", [
    epic("RB-1", "Work", "To Do", [
      story("RB-2", "Task one", "To Do", { priority: "High", duedate: null, assignee: null }),
      story("RB-3", "Task two", "To Do", { priority: "Low", duedate: null, assignee: null }),
    ]),
  ]);
  const rBad = assessReadiness(bad);
  const owned = gate(rBad.gates, "Owned");
  const scheduled = gate(rBad.gates, "Scheduled");

  check("bad: Owned gate present", !!owned);
  check("bad: Owned gate FAILS", owned && owned.pass === false);
  check("bad: Scheduled gate present", !!scheduled);
  check("bad: Scheduled gate FAILS", scheduled && scheduled.pass === false);
  // Low grade — not "Ready"/"On track" — and a low score.
  check(
    'bad: grade is low (Not started/At risk)',
    rBad.grade === "Not started" || rBad.grade === "At risk"
  );
  check("bad: score <= 50", typeof rBad.score === "number" && rBad.score <= 50);

  // ---- 4b: healthy board ---------------------------------------------------
  // owned (assignees), dated (duedates), in motion (done+in progress), no blocks,
  // mixed real priorities, has children.
  const good = state("Healthy", [
    epic("RG-1", "Core delivery", "In Progress", [
      story("RG-2", "Ship API", "Done", { priority: "High", duedate: "2026-06-20", assignee: "Asha" }),
      story("RG-3", "Wire client", "In Progress", { priority: "High", duedate: "2026-06-25", assignee: "Beto" }),
      story("RG-4", "Docs", "To Do", { priority: "Low", duedate: "2026-07-01", assignee: "Cira" }),
      story("RG-5", "Telemetry", "To Do", { priority: "Medium", duedate: "2026-07-05", assignee: "Dev" }),
    ]),
  ]);
  const rGood = assessReadiness(good);

  for (const name of ["Scoped", "Owned", "Scheduled", "Prioritized", "Unblocked", "In motion"]) {
    const g = gate(rGood.gates, name);
    check(`good: ${name} gate present`, !!g);
    check(`good: ${name} gate PASSES`, g && g.pass === true);
  }
  check(
    'good: grade is high (On track/Ready)',
    rGood.grade === "On track" || rGood.grade === "Ready"
  );
  check("good: score >= 80", typeof rGood.score === "number" && rGood.score >= 80);

  return {
    name: "4 · readiness gates",
    failures,
    info: `bad=${rBad.grade}/${rBad.score} good=${rGood.grade}/${rGood.score}`,
  };
}

// ---------------------------------------------------------------------------
// Runner — PASS/FAIL table, exit(1) on any failure.
// ---------------------------------------------------------------------------
function main() {
  const cases = [caseLinkedChain, caseCycle, caseNoLinks, caseReadinessGates];

  console.log(`\nOtto deps/readiness eval — ${cases.length} case(s)\n`);

  const rows = [];
  let failed = 0;

  for (const fn of cases) {
    let res;
    try {
      res = fn();
    } catch (err) {
      res = { name: fn.name, failures: [`threw: ${err.message}`], info: "" };
    }
    const pass = res.failures.length === 0;
    if (!pass) failed++;
    rows.push({ result: pass ? "PASS" : "FAIL", ...res });
  }

  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  console.log(`  ${"RESULT".padEnd(6)} ${"CASE".padEnd(nameW)}  INFO`);
  console.log(`  ${"-".repeat(6)} ${"-".repeat(nameW)}  ----`);
  for (const r of rows) {
    console.log(`  ${r.result.padEnd(6)} ${r.name.padEnd(nameW)}  ${r.info || ""}`);
    for (const f of r.failures) console.log(`         ↳ ${f}`);
  }

  console.log(`\n${rows.length - failed}/${rows.length} passed.\n`);
  if (failed > 0) {
    console.error(`✗ ${failed} case(s) failed — blocking.`);
    process.exit(1);
  }
  console.log("✓ All deps/readiness eval cases passed.");
}

main();
