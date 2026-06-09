// Otto — core program-state model.
// The canonical status sets + helpers every layer shares. No deps, no LLM.
// See core/CONTRACT.md for the ProgramState shape.

// Status names (lowercased) that count as "done" for readiness/completion.
export const DONE = new Set(["done", "closed", "resolved", "complete", "completed"]);

// Status names (lowercased) that count as "in progress".
export const PROGRESS = new Set(["in progress", "in review", "in dev", "doing", "review"]);

// Status names (lowercased) that count as "blocked" / stalled.
export const BLOCKED = new Set(["blocked", "on hold", "on-hold", "paused"]);

// Normalize a status / priority string for set comparisons.
export function norm(s) {
  return (s || "").toLowerCase().trim();
}

// Flatten epics + orphans into a single list of items, each tagged with its epic.
// Note: epics themselves are NOT emitted as rows — only their children + orphans,
// which is the shape the engine (engine/analyze.mjs) iterates over.
export function flatten(state) {
  const items = [];
  for (const e of state?.epics || [])
    for (const c of e.children || [])
      items.push({ ...c, epic: e.key, epicName: e.summary });
  for (const o of state?.orphans || [])
    items.push({ ...o, epic: null, epicName: "(no epic)" });
  return items;
}

// Structural validation against the ProgramState contract.
// THROWS an Error with a clear message on the first problem found.
// Returns true when valid (so callers can `validate(state)` as a guard).
export function validate(state) {
  if (!state || typeof state !== "object")
    throw new Error("ProgramState: expected an object");

  for (const field of ["program", "source", "generated_at"]) {
    if (typeof state[field] !== "string" || !state[field].trim())
      throw new Error(`ProgramState: "${field}" must be a non-empty string`);
  }

  // totals
  const t = state.totals;
  if (!t || typeof t !== "object")
    throw new Error('ProgramState: "totals" must be an object');
  if (!t.by_type || typeof t.by_type !== "object")
    throw new Error('ProgramState: "totals.by_type" must be an object');
  if (!t.by_status || typeof t.by_status !== "object")
    throw new Error('ProgramState: "totals.by_status" must be an object');
  if (!Number.isInteger(t.total) || t.total < 0)
    throw new Error('ProgramState: "totals.total" must be a non-negative integer');

  // epics
  if (!Array.isArray(state.epics))
    throw new Error('ProgramState: "epics" must be an array');
  for (const e of state.epics) {
    assertIssueLike(e, "epic");
    if (!Array.isArray(e.children))
      throw new Error(`ProgramState: epic "${e.key}" must have a children array`);
    if (!e.child_counts || typeof e.child_counts !== "object")
      throw new Error(`ProgramState: epic "${e.key}" must have a child_counts object`);
    for (const c of e.children) {
      assertIssueLike(c, `child of ${e.key}`);
      if (typeof c.type !== "string")
        throw new Error(`ProgramState: child "${c.key}" must have a string "type"`);
    }
  }

  // orphans
  if (!Array.isArray(state.orphans))
    throw new Error('ProgramState: "orphans" must be an array');
  for (const o of state.orphans) assertIssueLike(o, "orphan");

  // flags is reserved (engine-filled) but must be an array when present
  if (state.flags !== undefined && !Array.isArray(state.flags))
    throw new Error('ProgramState: "flags" must be an array when present');

  return true;
}

// Internal: assert an issue-shaped object has the required string fields.
function assertIssueLike(issue, label) {
  if (!issue || typeof issue !== "object")
    throw new Error(`ProgramState: ${label} must be an object`);
  if (typeof issue.key !== "string" || !issue.key)
    throw new Error(`ProgramState: ${label} must have a non-empty "key"`);
  if (typeof issue.summary !== "string")
    throw new Error(`ProgramState: ${label} "${issue.key}" must have a string "summary"`);
  if (typeof issue.status !== "string")
    throw new Error(`ProgramState: ${label} "${issue.key}" must have a string "status"`);
}

// Merge many ProgramStates (one per source) into a single ProgramState.
// - epics: concatenated, deduped by `key` (first occurrence wins).
// - totals: by_type / by_status summed key-by-key; total summed.
// - orphans + signals: concatenated (no dedupe — they carry their own source).
// - program: source program names joined with " + ".
// - source:  source ids joined with "+".
// See core/CONTRACT.md "Multi-source".
export function mergeStates(states) {
  const list = (states || []).filter(Boolean);

  const epics = [];
  const seenEpicKeys = new Set();
  const orphans = [];
  const signals = [];
  const by_type = {};
  const by_status = {};
  let total = 0;

  for (const s of list) {
    // epics — dedupe by key, keep the first one we see.
    for (const e of s.epics || []) {
      if (e?.key && seenEpicKeys.has(e.key)) continue;
      if (e?.key) seenEpicKeys.add(e.key);
      epics.push(e);
    }
    // orphans + signals — straight concat.
    for (const o of s.orphans || []) orphans.push(o);
    for (const sig of s.signals || []) signals.push(sig);
    // totals — sum each bucket.
    sumInto(by_type, s.totals?.by_type);
    sumInto(by_status, s.totals?.by_status);
    total += Number(s.totals?.total) || 0;
  }

  return {
    program: list.map((s) => s.program).filter(Boolean).join(" + "),
    source: list.map((s) => s.source).filter(Boolean).join("+"),
    generated_at: new Date().toISOString().slice(0, 10),
    totals: { by_type, by_status, total },
    epics,
    orphans,
    signals,
    flags: [],
  };
}

// Internal: add every numeric value of `src` into the accumulator `acc`.
function sumInto(acc, src) {
  if (!src || typeof src !== "object") return;
  for (const k of Object.keys(src)) {
    acc[k] = (acc[k] || 0) + (Number(src[k]) || 0);
  }
}
