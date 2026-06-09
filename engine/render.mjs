// Otto — renderers. Pure, no I/O.
// export function renderRollupHTML(state, analysis, narrative) -> string
// export function renderRollupJSON(state, analysis, narrative) -> object
// Honest by construction: every % shows its underlying counts, inferred
// detection is tagged, and the foothint discloses who wrote the prose.

import { norm } from "../core/program_state.mjs";
import { THEME_HEAD, THEME_CSS } from "../core/theme.mjs";
import { cadenceLabel, sinceLabel } from "../core/cadence.mjs";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function badge(level) {
  return (
    { green: "On track", amber: "At risk", red: "Slipping", info: "Note" }[
      level
    ] || level
  );
}

const SIGNAL_LEVEL = { risk: "amber", blocker: "red", decision: "green", note: "amber" };

function epicRows(state) {
  return (state?.epics || [])
    .map((e) => {
      const counts = e.child_counts || {};
      const breakdown =
        Object.entries(counts)
          .map(([k, v]) => `${v} ${esc(k)}`)
          .join(" · ") || "—";
      const keys = Object.keys(counts);
      const allTodo = keys.length > 0 && keys.every((k) => norm(k) === "to do");
      return (
        `<tr><td class="k">${esc(e.key)}</td><td>${esc(e.summary)}</td><td>${breakdown}</td>` +
        `<td><span class="b ${allTodo ? "red" : "green"}">${
          allTodo ? "Not started" : "Active"
        }</span></td></tr>`
      );
    })
    .join("\n");
}

function flagBlocks(flags) {
  return (flags || [])
    .map(
      (f) =>
        `<div class="flag ${f.level}"><span class="b ${f.level}">${badge(
          f.level
        )}</span>` +
        `<div><b>${esc(f.title)}</b><br><small>${esc(f.detail)}</small></div></div>`
    )
    .join("\n");
}

function signalBlocks(signals) {
  return (signals || [])
    .map((s) => {
      const level = SIGNAL_LEVEL[norm(s.type)] || "amber";
      const ref = s.ref
        ? ` <a href="${esc(s.ref)}" target="_blank" rel="noopener">${esc(
            s.type || "ref"
          )} →</a>`
        : "";
      const ts = s.ts ? ` · ${esc(s.ts)}` : "";
      return (
        `<div class="signal">` +
        `<span class="b ${level}">${esc(s.type || "signal")}</span>` +
        `<div>${esc(s.text)}<br>` +
        `<span class="src">${esc(s.source || "source")}</span>${ts}${ref}</div></div>`
      );
    })
    .join("\n");
}

// Inner content (no wrapper) for "the one call" — reused by foot + answer strip.
function footInner(root) {
  if (!root) return "";
  const state = root.started ? "in progress" : "unscheduled / not started";
  const tag = root.inferred ? ` <span class="b amber">inferred</span>` : "";
  const hedge = root.inferred
    ? ` <small>(${esc(root.basis || "inferred")})</small>`
    : "";
  return (
    `⚑ Needs your call: <b>${esc(root.key)} — ${esc(root.name)}</b>${tag} ` +
    `is the dependency root and is ${state}.${hedge} Sequence and date it first, or nothing ` +
    `downstream can get a trustworthy status.`
  );
}

function footLine(root) {
  if (!root) return "";
  return `<div class="foot">${footInner(root)}</div>`;
}

function actionsSection(actions) {
  if (!actions || !actions.length) return "";
  const rows = actions
    .map(
      (a) =>
        `<tr><td>${esc(a.action)}</td><td>${esc(a.owner)}</td><td>${esc(
          a.by
        )}</td></tr>`
    )
    .join("\n");
  return (
    `<h3>Top 3 actions</h3>\n` +
    `<table><thead><tr><th>Action</th><th>Owner</th><th>By</th></tr></thead><tbody>\n` +
    `${rows}\n</tbody></table>`
  );
}

// Confidence + foothint merged into one trust line.
function confidenceSection(m, foothint) {
  const band = m.confidenceBand || "low";
  const n = m.confidence == null ? 0 : m.confidence;
  return (
    `<h3>Confidence</h3>\n` +
    `<div class="altitude"><b>${esc(band)} (${n}%)</b><br>` +
    `<small>Based on data completeness: due dates, owners, work started, and priorities set. · ${esc(
      foothint
    )}</small></div>`
  );
}

// Per-epic readiness breakdown only (for the collapsed <details>).
function perEpicReadiness(r) {
  if (!r || !(r.perEpic || []).length) return "";
  const rows = (r.perEpic || [])
    .map((e) => {
      const marks = (e.gates || [])
        .map((g) => `<span>${g.pass ? "✓" : "✗"}</span>`)
        .join("");
      return (
        `<div class="epicscore"><span class="k">${esc(e.key)}</span>` +
        `<span class="mini">${esc(e.summary || "")} — ${e.score}% · ${esc(
          e.grade || ""
        )}</span>` +
        `<span class="gates">${marks}</span></div>`
      );
    })
    .join("\n");
  return `<div class="scorecard">${rows}</div>`;
}

// "What changed" cell from the delta (or first-run note). `since` is the
// cadence phrasing ("since last week", "since last month", …) so the strip
// reflects the period the delta actually compares.
function whatChanged(delta, since) {
  if (!delta) return "First run — no prior snapshot.";
  const added = delta.added.length;
  const removed = delta.removed.length;
  const tail = since ? ` <span class="l">${esc(since)}</span>` : "";
  return (
    `${delta.newlyDone} newly done · ${delta.newlyStarted} newly started · ` +
    `${delta.newlyOverdue} newly overdue · ${added} added · ${removed} removed` +
    tail
  );
}

// "Top risk" cell = highest-severity flag (red beats amber).
function topRisk(flags) {
  const list = flags || [];
  const red = list.find((f) => f.level === "red");
  const pick = red || list.find((f) => f.level === "amber") || list[0];
  if (!pick) return `No flags — board looks clean.`;
  return (
    `<span class="b ${pick.level}">${badge(pick.level)}</span> ` +
    `<b>${esc(pick.title)}</b><br><small>${esc(pick.detail)}</small>`
  );
}

// --- Readiness scorecard -------------------------------------------------
function readinessSection(r) {
  if (!r) return "";
  const gateRows = (r.gates || [])
    .map(
      (g) =>
        `<div class="gate"><span class="mark ${g.pass ? "ok" : "no"}">${
          g.pass ? "✓" : "✗"
        }</span><span class="gn">${esc(g.name)}</span>` +
        `<span class="gd">${esc(g.detail || "")}</span></div>`
    )
    .join("\n");

  // Per-epic breakdown is rendered separately in Zone C (collapsed details).
  return (
    `<h3>Readiness scorecard</h3>\n` +
    `<div class="scorecard">` +
    `<div class="grade"><span class="g">${esc(r.grade)}</span>` +
    `<span class="s">${r.score}% of gates passed</span></div>` +
    `${gateRows}` +
    `</div>`
  );
}

// --- Risk & dependency map ----------------------------------------------
function nodeName(deps, key) {
  const n = (deps.nodes || []).find((x) => x.key === key);
  return n ? n.summary : "";
}

// Render a chain "A blocks B blocks C" given an ordered list of keys.
function chainEl(deps, keys, crit) {
  if (!keys || keys.length === 0) return "";
  const parts = [];
  keys.forEach((k, i) => {
    parts.push(
      `<span class="node" title="${esc(nodeName(deps, k))}">${esc(k)}</span>`
    );
    if (i < keys.length - 1) parts.push(`<span class="arrow">blocks →</span>`);
  });
  return `<div class="chain${crit ? " crit" : ""}">${parts.join("")}</div>`;
}

// Build the human "A blocks B" chains from the hard edges (one per edge),
// grouped so render shows the dependency structure plainly.
function dependencyChains(deps) {
  const hard = (deps.edges || []).filter((e) => !e.soft);
  if (!hard.length) return "";
  const rows = hard
    .map(
      (e) =>
        `<div class="chain"><span class="node" title="${esc(
          nodeName(deps, e.from)
        )}">${esc(e.from)}</span>` +
        `<span class="arrow">${esc(e.type)} →</span>` +
        `<span class="node" title="${esc(nodeName(deps, e.to))}">${esc(
          e.to
        )}</span></div>`
    )
    .join("\n");
  return `<div class="row"><div class="lbl">Dependency chains</div>${rows}</div>`;
}

function dependencySection(deps) {
  if (!deps) return "";

  if (deps.source === "inferred") {
    const rootKey = (deps.roots || [])[0];
    const rootName = rootKey ? nodeName(deps, rootKey) : "";
    const rootLine = rootKey
      ? `<div class="chain"><span class="node">${esc(rootKey)}</span>` +
        (rootName ? ` <span class="gd">${esc(rootName)}</span>` : "") +
        `</div>`
      : `<span class="gd">No Foundation epic matched.</span>`;
    return (
      `<h3>Risk &amp; dependency map</h3>\n` +
      `<div class="depmap"><div class="row">` +
      `<div class="lbl">Likely root</div>${rootLine}` +
      `<div class="infnote">⚑ Inferred from epic name — no issue links found. ` +
      `Add Jira "blocks" / "is blocked by" links for a verified map.</div>` +
      `</div></div>`
    );
  }

  const chains = dependencyChains(deps);

  const blockedRows = (deps.blocked || []).length
    ? `<div class="row"><div class="lbl">Blocked items</div>` +
      (deps.blocked || [])
        .map(
          (b) =>
            `<div class="chain"><span class="node">${esc(b.key)}</span>` +
            `<span class="arrow">blocked by</span>` +
            (b.blockedBy || [])
              .map((k) => `<span class="node">${esc(k)}</span>`)
              .join('<span class="arrow">,</span>') +
            `</div>`
        )
        .join("\n") +
      `</div>`
    : `<div class="row"><div class="lbl">Blocked items</div><span class="gd">None — no unresolved blockers.</span></div>`;

  const critRow =
    (deps.criticalPath || []).length > 1
      ? `<div class="row"><div class="lbl">Critical path (longest chain)</div>${chainEl(
          deps,
          deps.criticalPath,
          true
        )}</div>`
      : `<div class="row"><div class="lbl">Critical path</div><span class="gd">No multi-step chain.</span></div>`;

  const cycleRow = (deps.cycles || []).length
    ? `<div class="row"><div class="lbl">Cycles (must break)</div>` +
      (deps.cycles || [])
        .map(
          (c) =>
            `<div class="chain crit">` +
            c.map((k) => `<span class="node">${esc(k)}</span>`).join('<span class="arrow">→</span>') +
            `<span class="arrow">↺</span></div>`
        )
        .join("\n") +
      `</div>`
    : "";

  const rootsRow = (deps.roots || []).length
    ? `<div class="row"><div class="lbl">Roots (schedule first)</div>${chainEl(
        deps,
        deps.roots,
        false
      )}</div>`
    : "";

  return (
    `<h3>Risk &amp; dependency map</h3>\n` +
    `<div class="depmap">${rootsRow}${chains}${blockedRows}${critRow}${cycleRow}</div>`
  );
}

// NOTE: the standalone "Since last week" delta section has been folded into the
// answer strip's "What changed" cell (see whatChanged()). Kept here as a comment
// so the rationale is discoverable; nothing else references it.

export function renderRollupHTML(state, analysis, narrative) {
  const { metrics: m, flags, dependencyRoot: root, actions, delta } = analysis;
  const readiness = analysis.readiness;
  const dependencies = analysis.dependencies;
  // Cadence drives the rollup title and the "What changed" phrasing.
  // Defaults to weekly when the worker/cli didn't set it.
  const cadence = analysis.cadence || "weekly";
  const date = state?.generated_at || new Date().toISOString().slice(0, 10);
  const source = state?.source || "unknown source";
  const n = narrative || { exec: "", eng: "", stakeholder: "", fromModel: false };
  const signals = state?.signals || [];
  const signalsBlock = signals.length
    ? `<details><summary>Signals (${signals.length})</summary>\n${signalBlocks(
        signals
      )}</details>`
    : "";

  // Not-started reframing: when nothing is done and nothing is in progress,
  // show an explicit "Not started" readiness rather than a green-looking 0%.
  // (Stated ONCE here; not repeated in narrative altitudes.)
  const notStarted = m.readiness === 0 && m.inprog === 0;
  const pillClass = m.readiness == null
    ? "muted"
    : notStarted
    ? "red"
    : m.readiness >= 70
    ? "green"
    : m.readiness >= 40
    ? "amber"
    : "red";
  const readinessPill =
    m.readiness == null
      ? `Empty board`
      : notStarted
      ? `Not started`
      : `Launch readiness ${m.readiness}%`;

  const readinessCell =
    m.readiness == null
      ? `—`
      : `${m.readiness}% <span class="l">(${m.done}/${m.total} done)</span>`;
  const momentumCell =
    m.momentum == null
      ? `—`
      : `${m.momentum}% <span class="l">(${m.inprog}/${m.total} in progress)</span>`;

  const foothint =
    `Rule-based checks · prose ` +
    (n.fromModel ? "written by Claude" : "templated (no model key)");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Otto Rollup — ${esc(
    state?.program
  )}</title>
${THEME_HEAD}
<style>${THEME_CSS}</style></head><body><div class="wrap"><div class="card">
<div class="bar"><span class="brandrow"><span class="logo"></span><span class="name">Otto</span><span class="sub">${esc(cadenceLabel(cadence))} Program Rollup</span></span><span class="ex">Pulled ${esc(
    date
  )} · ${esc(source)}</span></div>
<div class="body">

<!-- ZONE A — Decision band -->
<div class="hero"><h1>${esc(state?.program)}</h1><span class="pill ${pillClass}">${esc(
    readinessPill
  )}</span></div>
<div class="meta">${esc(date)} · auto-generated from ${m.total} issues · source: ${esc(
    source
  )}</div>
<div class="answerstrip">
  <div class="answer"><div class="lbl">What changed</div><div class="v">${whatChanged(
    delta,
    sinceLabel(cadence)
  )}</div></div>
  <div class="answer"><div class="lbl">Top risk</div><div class="v">${topRisk(
    flags
  )}</div></div>
  <div class="answer"><div class="lbl">The one call</div><div class="v">${
    footInner(root) || "No dependency root identified."
  }</div></div>
</div>

<!-- ZONE B — Two-column body -->
<div class="grid2">
  <div class="col-left">
    <div class="kpis" style="flex-direction:column">
      <div class="kpi"><div class="n">${readinessCell}</div><div class="l">Readiness (done)</div></div>
      <div class="kpi"><div class="n">${momentumCell}</div><div class="l">Momentum (in progress)</div></div>
      <div class="kpi"><div class="n">${m.todo}/${m.total}</div><div class="l">To do</div></div>
    </div>
    ${readinessSection(readiness)}
    ${confidenceSection(m, foothint)}
  </div>
  <div class="col-right">
    <h3>What Otto flagged</h3>
    ${flagBlocks(flags)}
    ${actionsSection(actions)}
    <h3>Epics</h3>
    <table><thead><tr><th>Epic</th><th>Workstream</th><th>Breakdown</th><th>State</th></tr></thead><tbody>
${epicRows(state)}
    </tbody></table>
    ${dependencySection(dependencies)}
  </div>
</div>

<!-- ZONE C — Depth, collapsed -->
${
  perEpicReadiness(readiness)
    ? `<details><summary>Per-epic readiness</summary>\n${perEpicReadiness(
        readiness
      )}</details>`
    : ""
}
${signalsBlock}

<!-- ZONE D — Narrative + footer -->
<details><summary>Read the written status</summary>
<div class="altitude"><b>Exec</b><br>${n.exec}</div>
<div class="altitude"><b>Eng</b><br>${n.eng}</div>
<div class="altitude"><b>Stakeholder</b><br>${n.stakeholder}</div>
</details>
<div class="brandfoot"><span class="logo"></span><span><span class="name">Otto</span> · the autonomous TPM</span></div>
</div></div></div></body></html>`;
}

export function renderRollupJSON(state, analysis, narrative) {
  return {
    program: state?.program,
    source: state?.source,
    generated_at: state?.generated_at || new Date().toISOString().slice(0, 10),
    metrics: analysis.metrics,
    flags: analysis.flags,
    dependencyRoot: analysis.dependencyRoot,
    dependencies: analysis.dependencies,
    readiness: analysis.readiness,
    actions: analysis.actions,
    delta: analysis.delta,
    epics: (state?.epics || []).map((e) => ({
      key: e.key,
      summary: e.summary,
      status: e.status,
      child_counts: e.child_counts || {},
    })),
    narrative: narrative || { exec: "", eng: "", stakeholder: "", fromModel: false },
    signals: state?.signals || [],
  };
}
