#!/usr/bin/env node
// Otto — honest-status rollup engine (KAN-24 F1 + KAN-25 F2 watermelon)
// Zero dependencies, zero cost. Reads a normalized program-state JSON and
// emits an honest weekly rollup as HTML. The deterministic core runs with no
// LLM; the prose/voice step (three-altitude rewrite, KAN-26) is layered on top
// later via the Claude proxy (KAN-28).
//
// Usage:  node engine/generate_rollup.mjs data/program_state_kan.json > rollup.html

import { readFileSync } from "node:fs";

const DONE = new Set(["done", "closed", "resolved", "complete"]);
const PROGRESS = new Set(["in progress", "in review", "in dev", "doing"]);

function norm(s) { return (s || "").toLowerCase().trim(); }

function flatten(state) {
  const items = [];
  for (const e of state.epics || []) for (const c of e.children || []) items.push({ ...c, epic: e.key, epicName: e.summary });
  for (const o of state.orphans || []) items.push({ ...o, epic: null, epicName: "(no epic)" });
  return items;
}

// --- deterministic metrics ---------------------------------------------------
function metrics(items) {
  const total = items.length || 1;
  const done = items.filter(i => DONE.has(norm(i.status))).length;
  const inprog = items.filter(i => PROGRESS.has(norm(i.status))).length;
  const todo = total - done - inprog;
  return {
    total, done, inprog, todo,
    readiness: Math.round((done / total) * 100),     // % complete
    momentum: Math.round((inprog / total) * 100),    // % actively moving
  };
}

// --- watermelon detection (looks green, isn't) -------------------------------
// A "watermelon" board reports healthy while the underlying signal is missing
// or contradicts the green. We flag the *absence of evidence*, not just red items.
function watermelonFlags(items, m) {
  const flags = [];
  const today = new Date();

  const overdue = items.filter(i => i.duedate && new Date(i.duedate) < today && !DONE.has(norm(i.status)));
  const dated = items.filter(i => i.duedate).length;
  const prioritized = new Set(items.map(i => norm(i.priority)).filter(Boolean));

  if (dated === 0)
    flags.push({ level: "amber", title: "No schedule signal",
      detail: `0 of ${m.total} items have a due date. On-track vs. slipping is unverifiable — any green status here is a guess.` });

  if (prioritized.size <= 1)
    flags.push({ level: "amber", title: "No prioritization",
      detail: `Every item shares one priority (${[...prioritized][0] || "unset"}). Nothing is marked must-do, so the work can't be sequenced.` });

  if (m.done === 0 && m.inprog === 0)
    flags.push({ level: "red", title: "Not started",
      detail: `${m.todo}/${m.total} items are To Do. 0% momentum — the program exists on paper but no work is in flight.` });

  for (const o of overdue)
    flags.push({ level: "red", title: `Overdue · ${o.key}`, detail: `${o.summary} — due ${o.duedate}, still ${o.status}.` });

  return flags;
}

// --- dependency-root heuristic ----------------------------------------------
// The epic most things rely on (named "Foundation"/"infra"/"platform") is the
// one to schedule first; flag if it's unstarted.
function dependencyRoot(state, items) {
  const root = (state.epics || []).find(e => /foundation|infra|platform|core/i.test(e.summary));
  if (!root) return null;
  const started = (root.children || []).some(c => !c.status || norm(c.status) === "to do" ? false : true);
  return { key: root.key, name: root.summary, started };
}

// --- render ------------------------------------------------------------------
function badge(level) { return { green: "On track", amber: "At risk", red: "Slipping" }[level] || level; }

function render(state, m, flags, root) {
  const epicsRows = (state.epics || []).map(e => {
    const counts = e.child_counts || {};
    const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "—";
    const allTodo = Object.keys(counts).every(k => norm(k) === "to do");
    return `<tr><td class="k">${e.key}</td><td>${e.summary}</td><td>${summary}</td>
      <td><span class="b ${allTodo ? "red" : "green"}">${allTodo ? "Not started" : "Active"}</span></td></tr>`;
  }).join("");

  const flagRows = flags.map(f =>
    `<div class="flag ${f.level}"><span class="b ${f.level}">${badge(f.level)}</span>
       <div><b>${f.title}</b><br><small>${f.detail}</small></div></div>`).join("");

  const rootLine = root
    ? `<div class="foot">⚑ Needs your call: <b>${root.key} — ${root.name}</b> is the dependency root and is ${root.started ? "in progress" : "unscheduled / not started"}. Sequence and date it first, or nothing downstream can get a trustworthy status.</div>`
    : "";

  const date = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Otto Rollup — ${state.program}</title>
<style>
:root{--bg:#faf6ea;--ink:#15140f;--muted:#6f6a5c;--line:#ece4d2;--yellow:#ffcb2d;--soft:#fff3cf;--good:#1f8a52;--warn:#c98a16;--red:#c0341d;--panel:#15140f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,-apple-system,system-ui,sans-serif;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:32px 22px}
.card{background:#fffdf6;border:1px solid var(--line);border-radius:18px;box-shadow:0 14px 38px rgba(20,18,15,.07);overflow:hidden}
.bar{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
.bar b{font-size:14px}.ex{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#7a5c00;background:var(--soft);border:1px solid #f3df9e;padding:4px 10px;border-radius:999px}
.body{padding:22px}
h1{font-size:21px;letter-spacing:-.02em;margin:0 0 2px}.meta{color:var(--muted);font-size:12.5px;margin-bottom:18px}
.kpis{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.kpi{flex:1;min-width:120px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .n{font-size:26px;font-weight:800;letter-spacing:-.02em}.kpi .l{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:6px 0 18px;font-size:13.5px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:9px 8px;border-bottom:1px solid var(--line)}td.k{font-weight:700;color:#7a5c00;white-space:nowrap}
.b{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
.b.green{background:#e6f4ec;color:var(--good)}.b.amber{background:#fbf0d8;color:var(--warn)}.b.red{background:#fdeae6;color:var(--red)}
.flag{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-top:1px dashed var(--line)}
.flag small{color:var(--muted)}
.foot{margin-top:18px;padding:13px 15px;background:var(--soft);border:1px solid #f3df9e;border-radius:12px;font-size:13px;color:#7a5c00}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 4px}
.altitude{background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--yellow);border-radius:8px;padding:12px 14px;margin:8px 0;font-size:13.5px}
.altitude b{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.foothint{color:var(--muted);font-size:11.5px;text-align:center;margin-top:16px}
</style></head><body><div class="wrap"><div class="card">
<div class="bar"><b>Otto · Weekly Program Rollup</b><span class="ex">Live · from Jira</span></div>
<div class="body">
<h1>${state.program} · Launch readiness: ${m.readiness}%</h1>
<div class="meta">${date} · auto-generated from ${m.total} issues · source: ${state.source}</div>
<div class="kpis">
  <div class="kpi"><div class="n">${m.readiness}%</div><div class="l">Readiness (done)</div></div>
  <div class="kpi"><div class="n">${m.momentum}%</div><div class="l">Momentum (in progress)</div></div>
  <div class="kpi"><div class="n">${m.todo}/${m.total}</div><div class="l">Not started</div></div>
</div>
<table><thead><tr><th>Epic</th><th>Workstream</th><th>Breakdown</th><th>State</th></tr></thead><tbody>${epicsRows}</tbody></table>
<h3>What Otto flagged</h3>
${flagRows}
${rootLine}
<h3>The honest status, three altitudes</h3>
<div class="altitude"><b>Exec</b><br>Program is fully scoped (7 epics, ${m.total} stories) but <b>not yet underway</b> — 0% complete, 0% in flight. No dates or priorities set, so there is nothing to report as on-track. First real milestone is standing up the foundation.</div>
<div class="altitude"><b>Eng</b><br>Every issue is To Do. Epic G (Foundation: Worker+Claude proxy, D1, Jira connector, eval) gates A–F. Recommend dating + sequencing G now; without it the board can't produce a trustworthy status.</div>
<div class="altitude"><b>Stakeholder</b><br>The plan is in place and clear. Next step is scheduling the first work and setting priorities so progress becomes measurable week over week.</div>
<div class="foothint">Generated by Otto · deterministic core (no LLM) · prose layer pending Claude proxy</div>
</div></div></div></body></html>`;
}

// --- main --------------------------------------------------------------------
const file = process.argv[2] || "data/program_state_kan.json";
const state = JSON.parse(readFileSync(file, "utf8"));
const items = flatten(state);
const m = metrics(items);
const flags = watermelonFlags(items, m);
const root = dependencyRoot(state, items);
process.stdout.write(render(state, m, flags, root));
