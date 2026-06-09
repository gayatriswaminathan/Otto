// Otto — three-altitude narration. Optional LLM, deterministic fallback.
// export async function narrate(state, analysis, { callClaude } = {})
//   -> { exec, eng, stakeholder, fromModel }
// MUST never throw. If callClaude is absent or throws, return deterministic
// template strings grounded ONLY in analysis + state. The three altitudes are
// DISTINCT — each says something the others don't, and each is DATA-DRIVEN:
// it pulls real keys/numbers from analysis so it reads specifically for THIS
// board. The fallback discloses nothing false: where data is missing, it says so.

import { DONE, PROGRESS, BLOCKED, norm } from "../core/program_state.mjs";

// --- small helpers -----------------------------------------------------------

function pct(n) {
  return n == null ? "unknown" : `${n}%`;
}

// Human-readable epic label "KAN-27 (G — Foundation …)" trimmed for prose.
function label(key, name) {
  if (!key) return null;
  if (!name) return key;
  return `${key} (${name})`;
}

// Which readiness gates are FAILING, by name, in scorecard order.
function failingGates(readiness) {
  return (readiness?.gates || []).filter((g) => g && g.pass === false);
}

// Turn a small list of strings into "a, b and c".
function join(list) {
  const a = list.filter(Boolean);
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
}

// A one-line "what changed" clause from delta, or null when nothing moved.
function deltaClause(delta) {
  if (!delta) return null;
  const parts = [];
  if (delta.newlyDone) parts.push(`${delta.newlyDone} item(s) finished`);
  if (delta.newlyStarted) parts.push(`${delta.newlyStarted} started`);
  if (delta.newlyOverdue) parts.push(`${delta.newlyOverdue} slipped overdue`);
  if (delta.added?.length) parts.push(`${delta.added.length} added`);
  if (delta.removed?.length) parts.push(`${delta.removed.length} removed`);
  if (parts.length === 0) return "No item changed status since the last snapshot.";
  return `Since last week: ${join(parts)}.`;
}

// --- deterministic templates -------------------------------------------------
// exec        = the bottom line + top risk + the ONE decision + recommended action
// eng         = critical path / what gates what / which readiness gates fail
// stakeholder = plain progress + what changes next week (no jargon)
function deterministic(state, analysis) {
  const {
    metrics: m,
    dependencyRoot: root,
    dependencies: deps,
    readiness,
    flags,
    actions,
    delta,
  } = analysis;

  const rootLabel = root ? label(root.key, root.name) : null;
  const rootHedge = root && root.inferred
    ? " (inferred from the epic name, not from verified issue links)"
    : "";
  const topAction = actions && actions[0] ? actions[0].action : null;
  const fails = failingGates(readiness);
  const failNames = fails.map((g) => g.name);
  const change = deltaClause(delta);

  // Top risk: first red flag, else first amber, else none.
  const reds = (flags || []).filter((f) => f.level === "red");
  const ambers = (flags || []).filter((f) => f.level === "amber");
  const topRisk = reds[0] || ambers[0] || null;

  // ---------------------------------------------------------------- exec ----
  // Lead with judgment, name the single risk, the one decision, the action.
  let exec;
  if (m.total === 0) {
    exec =
      `Nothing to report: the board is empty, so any rollup would be fiction. ` +
      `Decision this week — load the program (epics and stories) into the board; ` +
      `until then there is no status to govern.`;
  } else {
    const grade = readiness?.grade || "unknown";
    // Bottom line keyed off readiness + momentum, not a raw count dump.
    let bottom;
    if (m.readiness === 0 && m.momentum === 0) {
      bottom =
        `${state?.program || "The program"} is planned but not yet executable: ` +
        `all ${m.total} items are still To Do and nothing is in flight (readiness ${grade}, confidence ${m.confidenceBand}).`;
    } else if (m.blocked > 0) {
      bottom =
        `${state?.program || "The program"} is moving but partly stalled: ` +
        `${m.blocked} of ${m.total} items are blocked while ${m.done} are done (readiness ${grade}).`;
    } else {
      bottom =
        `${state?.program || "The program"} is in motion: ${m.done}/${m.total} done, ` +
        `${m.inprog} in progress (readiness ${grade}, ${pct(m.readiness)} complete).`;
    }

    const riskClause = topRisk
      ? `Biggest risk: ${topRisk.title.toLowerCase()} — ${topRisk.detail}`
      : `No blocking risk is visible in the current data.`;

    // The ONE decision: schedule the dependency root if it's unstarted; else
    // the highest-leverage missing signal.
    let decision;
    if (root && !root.started) {
      decision =
        `Decision needed this week: sequence and date ${rootLabel}${rootHedge} — ` +
        `it gates everything downstream and is currently unscheduled.`;
    } else if (m.dated === 0) {
      decision =
        `Decision needed this week: commit due dates (0 of ${m.total} items have one), ` +
        `because "on track" cannot be claimed without a schedule.`;
    } else if (failNames.length) {
      decision =
        `Decision needed this week: close the ${join(failNames)} gap${failNames.length > 1 ? "s" : ""} ` +
        `that keep readiness at ${pct(readiness?.score)}.`;
    } else {
      decision = `No decision is forced this week; keep execution moving and watch the critical path.`;
    }

    const actionClause = topAction ? ` Recommended first move: ${topAction}.` : "";
    exec = [bottom, riskClause, decision].join(" ") + actionClause;
    if (change) exec += ` ${change}`;
  }

  // ----------------------------------------------------------------- eng ----
  // Critical path, what gates what, which gates fail — concrete & sequencing-led.
  let eng;
  if (m.total === 0) {
    eng = `No backlog is loaded, so there is no critical path to sequence and no gates to evaluate.`;
  } else {
    // Critical path: prefer the verified link chain; else the inferred root.
    const cp = deps?.criticalPath || [];
    let pathClause;
    if (deps?.source === "links" && cp.length >= 2) {
      pathClause = `Critical path (from issue links): ${cp.join(" → ")}.`;
    } else if (root) {
      const state2 = root.started ? "is already in flight" : "has not started";
      pathClause =
        `No verified link graph exists yet, so the lead epic is inferred: ${rootLabel} ${state2}${rootHedge}. ` +
        `Schedule and start it first — nothing downstream can be trusted as on-track until it moves.`;
    } else {
      pathClause =
        `No dependency links and no foundation/infra epic are detectable, so build order must be set by hand before any sequencing claim holds.`;
    }

    // Blocked chain, if the link graph found any.
    const blocked = deps?.blocked || [];
    let blockClause = "";
    if (blocked.length) {
      const b = blocked
        .slice(0, 3)
        .map((x) => `${x.key} (waiting on ${(x.blockedBy || []).join(", ")})`);
      blockClause = ` Blocked by predecessors: ${join(b)}.`;
    }

    // Which readiness gates fail — the engineering checklist to clear.
    let gateClause;
    if (failNames.length) {
      gateClause = ` Failing readiness gates: ${join(failNames)} — clear these to lift the score above ${pct(readiness?.score)}.`;
    } else {
      gateClause = ` All readiness gates pass (${pct(readiness?.score)}); focus is execution, not setup.`;
    }

    eng = pathClause + blockClause + gateClause;
  }

  // --------------------------------------------------------- stakeholder ----
  // Plain language. No jargon. What's happening, what changes next week.
  let stakeholder;
  if (m.total === 0) {
    stakeholder =
      `There's nothing to show yet — the plan hasn't been entered. ` +
      `Next week we expect the first pieces of work to appear so we can start tracking progress.`;
  } else if (m.readiness === 0 && m.momentum === 0) {
    const epicCount = (state?.epics || []).length;
    stakeholder =
      `The plan is laid out — ${m.total} pieces of work across ${epicCount} areas — but none have started yet, ` +
      `so there's no progress to show this week. ` +
      `Next week we'll pick the first area to build, put dates on it, and you'll start seeing things move.`;
  } else if (m.blocked > 0) {
    stakeholder =
      `Work is underway: ${m.done} of ${m.total} pieces are finished, but ${m.blocked} are stuck waiting on something. ` +
      `Next week we focus on clearing what's stuck so the rest can keep moving.`;
  } else {
    stakeholder =
      `Good progress: ${m.done} of ${m.total} pieces are done and ${m.inprog} are actively being built. ` +
      `Next week we expect the in-progress work to wrap up and new pieces to begin.`;
  }
  if (change && m.total > 0) stakeholder += ` ${change.replace(/^Since last week: /, "What changed: ").replace(/^No item changed.*$/, "Nothing moved since the last update.")}`;

  return { exec, eng, stakeholder };
}

// --- prompt builder for the Claude proxy -------------------------------------
function buildPrompt(state, analysis) {
  const {
    metrics: m,
    flags,
    dependencyRoot: root,
    dependencies: deps,
    readiness,
    actions,
    delta,
  } = analysis;

  const facts = {
    program: state?.program,
    source: state?.source,
    epics: (state?.epics || []).map((e) => ({
      key: e.key,
      summary: e.summary,
      child_counts: e.child_counts || {},
    })),
    metrics: m,
    flags: (flags || []).map((f) => ({
      level: f.level,
      title: f.title,
      detail: f.detail,
    })),
    dependencyRoot: root,
    dependencies: deps
      ? {
          source: deps.source,
          criticalPath: deps.criticalPath,
          blocked: deps.blocked,
          roots: deps.roots,
        }
      : null,
    readiness: readiness
      ? {
          score: readiness.score,
          grade: readiness.grade,
          gates: (readiness.gates || []).map((g) => ({ name: g.name, pass: g.pass })),
        }
      : null,
    actions,
    delta,
  };

  return [
    `You are Otto, an honest TPM status writer. The JSON below is the ONLY ground truth.`,
    `Hard rules:`,
    `- Use ONLY facts present in the JSON. Never invent dates, owners, names, percentages, or progress.`,
    `- If dependencyRoot.inferred is true, say it is inferred from the epic name (not verified issue links).`,
    `- Never claim "on track" when readiness has no schedule signal (e.g. dated is 0).`,
    `- Use delta for "what changed" only if it is present and non-null.`,
    ``,
    `FACTS (JSON):`,
    JSON.stringify(facts, null, 2),
    ``,
    `Write a weekly status at THREE DISTINCT altitudes. Each MUST add information the others do not —`,
    `do NOT restate the same fact across altitudes, and do NOT dump raw counts:`,
    `- "exec" (3-4 sentences, for a VP): lead with the bottom-line judgment, name the single biggest RISK,`,
    `  state the ONE decision needed this week, and the recommended first action. Lead with judgment, not numbers.`,
    `- "eng" (3-4 sentences, for engineers): the critical path and what gates what. Use dependencies.criticalPath,`,
    `  dependencies.blocked, and the readiness gates that fail. Be concrete, technical, sequencing-focused.`,
    `- "stakeholder" (2-3 sentences, plain language, NO jargon — no "watermelon", "RAID", "gates", "critical path"):`,
    `  what is happening in plain terms and what changes next week. Honest but reassuring.`,
    ``,
    `Respond with ONLY a JSON object: {"exec":"...","eng":"...","stakeholder":"..."}. No prose, no markdown, no code fences.`,
  ].join("\n");
}

function parseNarrative(raw) {
  if (raw == null) throw new Error("empty response");
  let text = typeof raw === "string" ? raw : JSON.stringify(raw);
  // Strip code fences if the model added them.
  text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Extract the first {...} block to be resilient to stray prose.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start)
    throw new Error("no JSON object found");
  const obj = JSON.parse(text.slice(start, end + 1));
  const pick = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");
  return {
    exec: pick(obj.exec),
    eng: pick(obj.eng),
    stakeholder: pick(obj.stakeholder),
  };
}

export async function narrate(state, analysis, { callClaude } = {}) {
  const fallback = deterministic(state, analysis);
  if (typeof callClaude !== "function") return { ...fallback, fromModel: false };
  try {
    const prompt = buildPrompt(state, analysis);
    const raw = await callClaude(prompt);
    const parsed = parseNarrative(raw);
    // Merge: any missing/empty altitude falls back to the template. fromModel
    // is true only when the model produced at least one usable altitude.
    const produced =
      parsed.exec || parsed.eng || parsed.stakeholder ? true : false;
    if (!produced) return { ...fallback, fromModel: false };
    return {
      exec: parsed.exec || fallback.exec,
      eng: parsed.eng || fallback.eng,
      stakeholder: parsed.stakeholder || fallback.stakeholder,
      fromModel: true,
    };
  } catch {
    return { ...fallback, fromModel: false };
  }
}
