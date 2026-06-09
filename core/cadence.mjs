// Otto — reporting cadence. Pure, no I/O.
// One source of truth for the four supported cadences and everything derived
// from them: human labels, the "since …" phrasing in the answer strip, the
// look-back window for the delta, and the cron expression for the worker.
//
// Threaded as `analysis.cadence` (set by worker/cli) so render can pick the
// right title + "What changed" phrasing without any new export signatures.

export const CADENCES = ["weekly", "biweekly", "monthly", "quarterly"];

const LABEL = {
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const SINCE = {
  weekly: "since last week",
  biweekly: "since two weeks ago",
  monthly: "since last month",
  quarterly: "since last quarter",
};

// Look-back window (days) used to find the prior snapshot to diff against.
// Approximations: a "month" ≈ 30d, a "quarter" ≈ 91d (13 weeks).
const DAYS = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
};

// Cron expressions (UTC). All fire 14:00 to mirror the existing weekly trigger.
//   weekly    — every Monday
//   biweekly  — 1st & 15th (≈ every two weeks; cron can't express "every other Monday")
//   monthly   — 1st of the month
//   quarterly — 1st of Jan/Apr/Jul/Oct
const CRON = {
  weekly: "0 14 * * 1",
  biweekly: "0 14 1,15 * *",
  monthly: "0 14 1 * *",
  quarterly: "0 14 1 1,4,7,10 *",
};

// Normalize + validate. Default to "weekly" on null/empty; THROW on an
// unrecognized value so a bad ?cadence= is a clean 400 upstream, not a
// silently-wrong report.
export function validateCadence(c) {
  if (c == null || c === "") return "weekly";
  const v = String(c).trim().toLowerCase();
  if (!CADENCES.includes(v)) throw new Error(`unknown cadence "${c}"`);
  return v;
}

export function cadenceLabel(c) {
  return LABEL[validateCadence(c)];
}

export function sinceLabel(c) {
  return SINCE[validateCadence(c)];
}

export function periodDays(c) {
  return DAYS[validateCadence(c)];
}

export function cronFor(c) {
  return CRON[validateCadence(c)];
}
