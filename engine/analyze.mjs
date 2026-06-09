// Otto — deterministic analysis. No LLM. No I/O.
// export analyze(state, now?, prior?) -> { metrics, flags, dependencyRoot, actions, delta }
//
// "Watermelon" detection: a board reports healthy while the underlying signal
// is missing or contradicts the green. We flag the *absence of evidence*, not
// just red items. Every claim here is grounded in the data — no fabrication.

import { DONE, PROGRESS, BLOCKED, norm, flatten } from "../core/program_state.mjs";
import { buildDependencies } from "./dependencies.mjs";
import { assessReadiness } from "./readiness.mjs";

const TODAY = "2026-06-08"; // Otto's "now" for the demo; override via arg.

// Parse a "YYYY-MM-DD" string as LOCAL midnight (avoids UTC off-by-one).
function localDate(d) {
  return new Date(String(d) + "T00:00:00");
}

// A priority counts as "set" only when it is a real, non-default value.
// null / "" / "none" => UNSET. "medium" alone is treated as the default and
// does NOT count toward prioritization signal.
function priorityIsSet(p) {
  const v = norm(p);
  if (!v || v === "none") return false;
  if (v === "medium") return false; // default — not an intentional priority
  return true;
}

function computeMetrics(items) {
  const total = items.length;
  if (total === 0) {
    return {
      total: 0,
      done: 0,
      inprog: 0,
      blocked: 0,
      todo: 0,
      readiness: null,
      momentum: null,
      dated: 0,
      assigned: 0,
      prioritized: 0,
      confidence: 0,
    };
  }
  const done = items.filter((i) => DONE.has(norm(i.status))).length;
  const inprog = items.filter((i) => PROGRESS.has(norm(i.status))).length;
  const blocked = items.filter((i) => BLOCKED.has(norm(i.status))).length;
  const todo = total - done - inprog - blocked;
  const dated = items.filter((i) => i.duedate).length;
  const assigned = items.filter((i) => i.assignee).length;
  const prioritized = items.filter((i) => priorityIsSet(i.priority)).length;

  // Confidence — weighted data-completeness, 0..100.
  const started = done > 0 || inprog > 0 ? 1 : 0;
  const score =
    0.3 * (dated / total) +
    0.3 * (assigned / total) +
    0.2 * started +
    0.2 * (prioritized / total);
  const confidence = Math.round(score * 100);

  return {
    total,
    done,
    inprog,
    blocked,
    todo,
    readiness: Math.round((done / total) * 100), // % complete
    momentum: Math.round((inprog / total) * 100), // % actively moving
    dated,
    assigned,
    prioritized,
    confidence,
  };
}

function confidenceBand(n) {
  if (n == null) return "low";
  if (n >= 67) return "high";
  if (n >= 34) return "medium";
  return "low";
}

function watermelonFlags(items, m, now) {
  const flags = [];
  const today = localDate(now);

  // Empty board — nothing to analyze. Single amber flag, skip the rest.
  if (m.total === 0) {
    flags.push({
      level: "amber",
      title: "Empty board",
      detail: "No issues found. There is nothing to report a status on yet.",
    });
    return flags;
  }

  // Blocked items — explicit red.
  const blockedItems = items.filter((i) => BLOCKED.has(norm(i.status)));
  if (blockedItems.length > 0)
    flags.push({
      level: "red",
      title: "Blocked items",
      detail: `${blockedItems.length} item(s) blocked: ${blockedItems
        .map((b) => b.key)
        .join(", ")}. These are stalled until unblocked.`,
    });

  // No schedule signal — 0 due dates.
  if (m.dated === 0)
    flags.push({
      level: "amber",
      title: "No schedule signal",
      detail: `0 of ${m.total} items have a due date. On-track vs. slipping is unverifiable — any green status here is a guess.`,
    });

  // Prioritization: flag ONLY when every item is UNSET (null/empty/"none").
  // If items carry a real value (e.g. all "Medium"), that's a uniform-but-set
  // board — informational, not alarming.
  const anyReal = items.some((i) => {
    const v = norm(i.priority);
    return v && v !== "none";
  });
  if (!anyReal) {
    flags.push({
      level: "amber",
      title: "No prioritization",
      detail: `No item has a priority set. Nothing is marked must-do, so the work can't be sequenced.`,
    });
  } else if (m.prioritized === 0) {
    // Every item has a real value but all are the default "Medium" — note it,
    // don't alarm. (m.prioritized counts only non-default values.)
    const vals = new Set(items.map((i) => norm(i.priority)).filter(Boolean));
    flags.push({
      level: "info",
      title: "Uniform priority",
      detail: `All items share one priority (${
        [...vals][0] || "medium"
      }). Sequencing relies on dependencies, not priority rank.`,
    });
  }

  // Not started — 0 done & 0 in progress & 0 blocked (all To Do).
  if (m.done === 0 && m.inprog === 0 && m.blocked === 0)
    flags.push({
      level: "red",
      title: "Not started",
      detail: `${m.todo}/${m.total} items are To Do. 0% momentum — the program exists on paper but no work is in flight.`,
    });

  // Per-item: overdue (duedate < today, date-only, & not done).
  const overdue = items.filter(
    (i) =>
      i.duedate && localDate(i.duedate) < today && !DONE.has(norm(i.status))
  );
  for (const o of overdue)
    flags.push({
      level: "red",
      title: `Overdue · ${o.key}`,
      detail: `${o.summary} — due ${o.duedate}, still ${o.status}.`,
    });

  // Unassigned work — less than half have an owner.
  if (m.assigned / m.total < 0.5)
    flags.push({
      level: "amber",
      title: "Unassigned work",
      detail: `${m.total - m.assigned} of ${
        m.total
      } items have no assignee. Ownership is unclear, so accountability can't be tracked.`,
    });

  return flags;
}

// The epic most things rely on (Foundation / infra / platform / core) is the
// one to schedule first. This is a NAME match, not a verified Jira issue-link
// graph — we mark it inferred so render can hedge it.
function findDependencyRoot(state) {
  const root = (state?.epics || []).find((e) =>
    /foundation|infra|platform|core/i.test(e.summary || "")
  );
  if (!root) return null;
  const started = (root.children || []).some(
    (c) => DONE.has(norm(c.status)) || PROGRESS.has(norm(c.status))
  );
  return {
    key: root.key,
    name: root.summary,
    started,
    inferred: true,
    basis: "epic name match (not verified against Jira issue links)",
  };
}

// Unstructured sources contribute signals[]; fold risk/blocker signals into flags.
function signalFlags(state) {
  return (state?.signals || [])
    .filter((s) => s && (norm(s.type) === "risk" || norm(s.type) === "blocker"))
    .map((s) => ({
      level: norm(s.type) === "blocker" ? "red" : "amber",
      title: "Signal · " + (s.source || "source"),
      detail: s.text || "",
    }));
}

// Top-3 recommended actions, derived honestly from flags + metrics.
// owner/by are "TBD" — Otto recommends, it does not fabricate assignments.
function buildActions(m, flags, root) {
  const actions = [];
  const has = (t) => flags.some((f) => f.title === t);

  if (root && !root.started)
    actions.push({
      action: `Sequence & date ${root.key} (dependency root)`,
      owner: "TBD",
      by: "TBD",
    });

  if (has("Blocked items"))
    actions.push({
      action: `Unblock the ${m.blocked} stalled item(s) — they gate downstream work`,
      owner: "TBD",
      by: "TBD",
    });

  if (m.total > 0 && m.dated === 0)
    actions.push({
      action: `Set due dates — 0/${m.total} have one`,
      owner: "TBD",
      by: "TBD",
    });

  if (m.total > 0 && m.assigned / m.total < 0.5)
    actions.push({
      action: `Assign owners — ${m.total - m.assigned} unassigned`,
      owner: "TBD",
      by: "TBD",
    });

  if (has("No prioritization"))
    actions.push({
      action: `Set priorities — nothing is marked must-do`,
      owner: "TBD",
      by: "TBD",
    });

  return actions.slice(0, 3);
}

// Week-over-week diff vs. a prior ProgramState, by item key. Honest: only
// reports transitions visible in both snapshots.
function computeDelta(state, prior, now) {
  if (!prior) return null;
  const today = localDate(now);
  const cur = new Map(flatten(state).map((i) => [i.key, i]));
  const old = new Map(flatten(prior).map((i) => [i.key, i]));

  let newlyDone = 0;
  let newlyStarted = 0;
  let newlyOverdue = 0;
  const added = [];
  const removed = [];

  for (const [key, i] of cur) {
    if (!old.has(key)) {
      added.push(key);
      continue;
    }
    const o = old.get(key);
    const wasDone = DONE.has(norm(o.status));
    const isDone = DONE.has(norm(i.status));
    if (!wasDone && isDone) newlyDone++;

    const wasProg = PROGRESS.has(norm(o.status));
    const isProg = PROGRESS.has(norm(i.status));
    if (!wasProg && isProg && !isDone) newlyStarted++;

    const wasOverdue =
      o.duedate && localDate(o.duedate) < today && !DONE.has(norm(o.status));
    const isOverdue =
      i.duedate && localDate(i.duedate) < today && !DONE.has(norm(i.status));
    if (!wasOverdue && isOverdue) newlyOverdue++;
  }
  for (const key of old.keys()) if (!cur.has(key)) removed.push(key);

  return { newlyDone, newlyStarted, newlyOverdue, added, removed };
}

// Derive the legacy `dependencyRoot` (the single "needs your call" item) from
// the real dependency graph when links exist; else keep the name-regex inferred
// root so render's existing foot-hint still works honestly.
function deriveDependencyRoot(state, dependencies) {
  if (dependencies?.source === "links" && dependencies.roots?.length) {
    const rk = dependencies.roots[0];
    const node = (dependencies.nodes || []).find((n) => n.key === rk);
    const st = norm(node?.status);
    const started = PROGRESS.has(st) || DONE.has(st);
    return {
      key: rk,
      name: node ? node.summary : rk,
      started,
      inferred: false,
      basis: "verified from issue links (blocks / is blocked by / depends on)",
    };
  }
  return findDependencyRoot(state);
}

export function analyze(state, now = TODAY, prior = null) {
  const items = flatten(state);
  const metrics = computeMetrics(items);
  metrics.confidenceBand = confidenceBand(metrics.confidence);
  const flags = [...watermelonFlags(items, metrics, now), ...signalFlags(state)];
  const dependencies = buildDependencies(state);
  const readiness = assessReadiness(state);
  const dependencyRoot = deriveDependencyRoot(state, dependencies);
  const actions = buildActions(metrics, flags, dependencyRoot);
  const delta = computeDelta(state, prior, now);
  return { metrics, flags, dependencyRoot, dependencies, readiness, actions, delta };
}
