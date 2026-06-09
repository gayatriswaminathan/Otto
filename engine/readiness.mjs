// Otto — readiness scorecard. Pure, deterministic, no LLM, no I/O.
// export function assessReadiness(state) ->
//   { score, grade, gates, perEpic }
//
// Gates (program + per-epic), each pass/fail:
//   Scoped       — has children (>0 items)
//   Owned        — >=50% assigned
//   Scheduled    — >=50% dated
//   Prioritized  — priorities set, not all-default
//   Unblocked    — no blocked items
//   In motion    — >0 done or in progress
// Score = % of gates passed (0..100). Grade derived from score + activity.

import { DONE, PROGRESS, BLOCKED, norm } from "../core/program_state.mjs";

function priorityIsSet(p) {
  const v = norm(p);
  if (!v || v === "none") return false;
  if (v === "medium") return false; // default — not an intentional priority
  return true;
}

// Evaluate the six gates over a list of items. Returns the gate list and the
// numeric score (% passed).
function gatesFor(items) {
  const total = items.length;
  const assigned = items.filter((i) => i.assignee).length;
  const dated = items.filter((i) => i.duedate).length;
  const prioritized = items.filter((i) => priorityIsSet(i.priority)).length;
  const done = items.filter((i) => DONE.has(norm(i.status))).length;
  const inprog = items.filter((i) => PROGRESS.has(norm(i.status))).length;
  const blocked = items.filter((i) => BLOCKED.has(norm(i.status))).length;

  const gates = [
    {
      name: "Scoped",
      pass: total > 0,
      detail: total > 0 ? `${total} item(s)` : "no children",
    },
    {
      name: "Owned",
      pass: total > 0 && assigned / total >= 0.5,
      detail: `${assigned}/${total} assigned`,
    },
    {
      name: "Scheduled",
      pass: total > 0 && dated / total >= 0.5,
      detail: `${dated}/${total} dated`,
    },
    {
      name: "Prioritized",
      pass: prioritized > 0,
      detail: `${prioritized}/${total} prioritized (non-default)`,
    },
    {
      name: "Unblocked",
      pass: blocked === 0,
      detail: blocked === 0 ? "none blocked" : `${blocked} blocked`,
    },
    {
      name: "In motion",
      pass: done + inprog > 0,
      detail: `${done} done · ${inprog} in progress`,
    },
  ];

  const passed = gates.filter((g) => g.pass).length;
  const score = gates.length ? Math.round((passed / gates.length) * 100) : 0;
  return { gates, score, started: done + inprog > 0 };
}

// Map a score (+activity) to a four-band grade.
function gradeFor(score, started) {
  if (!started && score < 50) return "Not started";
  if (score >= 85) return "Ready";
  if (score >= 60) return "On track";
  return "At risk";
}

export function assessReadiness(state) {
  // Program-level: flatten epics + orphans the same way the engine does.
  const allItems = [];
  for (const e of state?.epics || [])
    for (const c of e.children || []) allItems.push(c);
  for (const o of state?.orphans || []) allItems.push(o);

  const program = gatesFor(allItems);

  const perEpic = (state?.epics || []).map((e) => {
    const r = gatesFor(e.children || []);
    return {
      key: e.key,
      summary: e.summary,
      score: r.score,
      grade: gradeFor(r.score, r.started),
      gates: r.gates.map((g) => ({ name: g.name, pass: g.pass })),
    };
  });

  return {
    score: program.score,
    grade: gradeFor(program.score, program.started),
    gates: program.gates,
    perEpic,
  };
}
