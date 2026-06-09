// otto/reporting/store.mjs
// D1 persistence. ALL SQL uses parameterized prepared statements (.bind()) —
// never string-concatenated values. No I/O beyond the passed-in D1 binding.
//
// Tables (db/schema.sql): rollups, runs, snapshots, decisions.
//
// Exports:
//   saveRun(db, run)
//   saveSnapshot(db, { program, source, state, captured_at? })
//   priorSnapshot(db, program, beforeDays)
//   saveRollup(db, { program, generated_at, readiness, momentum, html, json })
//   listReports(db, program, limit=20)
//   getReport(db, id)
//   readinessTrend(db, program, limit=12)

// Coerce to a finite number or null (D1 REAL columns).
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Serialize a value for a TEXT column: pass strings through, JSON-encode objects.
function asText(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Insert one traced run row (observability).
 * run: { run_id, route?, source?, program?, ok?, ms?, ts? }
 * Returns the new row id, or null if db is missing.
 */
export async function saveRun(db, run = {}) {
  if (!db) return null;
  const ok = run.ok === false || run.ok === 0 ? 0 : 1;
  const stmt = db
    .prepare(
      `INSERT INTO runs (run_id, route, source, program, ok, ms, ts)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .bind(
      String(run.run_id || ""),
      run.route != null ? String(run.route) : null,
      run.source != null ? String(run.source) : null,
      run.program != null ? String(run.program) : null,
      ok,
      num(run.ms),
      run.ts != null ? String(run.ts) : null
    );
  const res = await stmt.run();
  return res?.meta?.last_row_id ?? null;
}

/**
 * Insert one raw ProgramState capture (snapshots table). The `state` object is
 * JSON-serialized into state_json; `captured_at` defaults to now() so the
 * cadence delta can look back a fixed number of days.
 * snap: { program, source?, state, captured_at? }
 * Returns the new row id, or null if db is missing.
 */
export async function saveSnapshot(db, snap = {}) {
  if (!db) return null;
  const stmt = db
    .prepare(
      `INSERT INTO snapshots (program, source, captured_at, state_json)
       VALUES (?, ?, COALESCE(?, datetime('now')), ?)`
    )
    .bind(
      String(snap.program || ""),
      snap.source != null ? String(snap.source) : "unknown",
      snap.captured_at != null ? String(snap.captured_at) : null,
      asText(snap.state)
    );
  const res = await stmt.run();
  return res?.meta?.last_row_id ?? null;
}

/**
 * The most recent snapshot captured at or before (now - beforeDays) — i.e. the
 * state one cadence period back, used as the delta baseline. Returns the parsed
 * ProgramState object, or null if none exists (first run / no DB / parse fail).
 *
 * beforeDays is clamped to a non-negative integer and interpolated as a SQLite
 * datetime modifier ("-N days"); it is NEVER user-supplied free text — callers
 * pass periodDays(cadence) which returns a fixed integer per cadence.
 */
export async function priorSnapshot(db, program, beforeDays) {
  if (!db) return null;
  const days = Math.max(0, Math.floor(Number(beforeDays)) || 0);
  const cutoff = `-${days} days`;
  const row = await db
    .prepare(
      `SELECT state_json, captured_at
         FROM snapshots
        WHERE program = ?
          AND captured_at <= datetime('now', ?)
        ORDER BY captured_at DESC, id DESC
        LIMIT 1`
    )
    .bind(String(program || ""), cutoff)
    .first();
  if (!row || typeof row.state_json !== "string" || !row.state_json) return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}

/**
 * Insert one generated rollup. `html` and `json` are stored verbatim
 * (json may be an object — it is JSON-stringified).
 * Returns the new row id, or null if db is missing.
 */
export async function saveRollup(db, rollup = {}) {
  if (!db) return null;
  const stmt = db
    .prepare(
      `INSERT INTO rollups (program, generated_at, readiness, momentum, html, json)
       VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`
    )
    .bind(
      String(rollup.program || ""),
      rollup.generated_at != null ? String(rollup.generated_at) : null,
      num(rollup.readiness),
      num(rollup.momentum),
      rollup.html != null ? String(rollup.html) : null,
      asText(rollup.json)
    );
  const res = await stmt.run();
  return res?.meta?.last_row_id ?? null;
}

/**
 * List recent rollups for a program (metadata only — no html/json blobs).
 * Returns [{ id, program, generated_at, readiness, momentum }] newest-first.
 */
export async function listReports(db, program, limit = 20) {
  if (!db) return [];
  const lim = clampLimit(limit, 20);
  const { results } = await db
    .prepare(
      `SELECT id, program, generated_at, readiness, momentum
         FROM rollups
        WHERE program = ?
        ORDER BY generated_at DESC, id DESC
        LIMIT ?`
    )
    .bind(String(program || ""), lim)
    .all();
  return results || [];
}

/**
 * Fetch one rollup by id (full row, including html + parsed json).
 * Returns the row, or null if not found.
 */
export async function getReport(db, id) {
  if (!db) return null;
  const row = await db
    .prepare(
      `SELECT id, program, generated_at, readiness, momentum, html, json
         FROM rollups
        WHERE id = ?`
    )
    .bind(Number(id))
    .first();
  if (!row) return null;
  // Best-effort parse of the stored JSON blob.
  if (typeof row.json === "string" && row.json) {
    try {
      row.json = JSON.parse(row.json);
    } catch {
      /* leave as string if it isn't valid JSON */
    }
  }
  return row;
}

/**
 * Readiness/momentum trend, oldest-first (so a sparkline reads left→right).
 * Returns [{ generated_at, readiness, momentum }].
 */
export async function readinessTrend(db, program, limit = 12) {
  if (!db) return [];
  const lim = clampLimit(limit, 12);
  const { results } = await db
    .prepare(
      `SELECT generated_at, readiness, momentum FROM (
         SELECT generated_at, readiness, momentum, id
           FROM rollups
          WHERE program = ?
          ORDER BY generated_at DESC, id DESC
          LIMIT ?
       ) ORDER BY generated_at ASC, id ASC`
    )
    .bind(String(program || ""), lim)
    .all();
  return results || [];
}

// Keep LIMIT a sane positive integer (it is bound as a parameter, never concatenated).
function clampLimit(v, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}
