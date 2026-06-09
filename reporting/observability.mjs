// otto/reporting/observability.mjs
// Lightweight, self-contained tracer (Phoenix/OpenTelemetry-flavored, zero deps).
// Times a unit of work, emits ONE structured JSON log line per span, returns the
// wrapped fn's result. The span line carries only counts / ids / durations —
// NEVER secrets, tokens, prompts, or free-text PII.
//
// Exports:
//   trace(name, attrs, fn) -> Promise<fn result>
//   newRunId() -> string
//   span(name, attrs, fn)  (alias of trace)

// Attribute keys that are safe to emit. Anything else is dropped, so callers
// can't accidentally leak a token or a prompt body into the logs.
const SAFE_KEYS = new Set([
  "run_id",
  "route",
  "source",
  "program",
  "project",
  "count",
  "total",
  "items",
  "epics",
  "flags",
  "readiness",
  "momentum",
  "status",
  "kind",
  "usingFixture",
  "cron",
]);

// Coarse types only — we never emit raw string values unless the key is an id/route.
const ID_KEYS = new Set(["run_id", "route", "source", "program", "project", "status", "kind", "cron"]);

function sanitize(attrs) {
  const out = {};
  if (!attrs || typeof attrs !== "object") return out;
  for (const [k, v] of Object.entries(attrs)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (ID_KEYS.has(k)) {
      // Allow short id/label strings; truncate defensively, strip newlines.
      out[k] = String(v).replace(/\s+/g, " ").slice(0, 120);
    }
    // Any other string-valued attr on a non-id key is intentionally dropped.
  }
  return out;
}

// monotonic-ish clock; Date.now() is fine on Workers (performance may be absent).
function clock() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function emit(record) {
  // One line, structured, stable shape. console.log is captured by Workers logs.
  try {
    console.log(JSON.stringify({ ev: "span", ...record }));
  } catch {
    /* logging must never throw */
  }
}

/**
 * Generate a short, collision-resistant run id (no PII). Format: otto-<ts36>-<rand>.
 */
export function newRunId() {
  const ts = Date.now().toString(36);
  let rand;
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    }
  } catch {
    /* fall through */
  }
  if (!rand) rand = Math.random().toString(36).slice(2, 10);
  return `otto-${ts}-${rand}`;
}

/**
 * Trace an async (or sync) unit of work.
 *   await trace("rollup", { run_id, route:"rollup", program }, async () => { ... })
 * Emits one span line { ev:"span", name, ok, ms, ...safeAttrs } and re-throws
 * on failure (after emitting ok:false). Returns the fn's resolved value.
 */
export async function trace(name, attrs, fn) {
  // Allow trace(name, fn) shorthand.
  if (typeof attrs === "function") {
    fn = attrs;
    attrs = {};
  }
  const safe = sanitize(attrs);
  const start = clock();
  try {
    const result = await fn();
    const ms = Math.round((clock() - start) * 1000) / 1000;
    emit({ name: String(name), ok: true, ms, ...safe });
    return result;
  } catch (err) {
    const ms = Math.round((clock() - start) * 1000) / 1000;
    // Emit a coarse error class only — never the message (may contain data).
    emit({
      name: String(name),
      ok: false,
      ms,
      ...safe,
      err: err && err.name ? String(err.name) : "Error",
    });
    throw err;
  }
}

// Alias.
export const span = trace;
