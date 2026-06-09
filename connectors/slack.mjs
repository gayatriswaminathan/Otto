// connectors/slack.mjs
// Read-only Slack connector. Pulls recent messages from a channel via the
// Slack Web API and scans them for risk/blocker/decision language, emitting
// `signals[]` (NOT a work tree). See core/CONTRACT.md "Multi-source".
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY: never posts or mutates Slack.

import { validateChannel, validateLimit } from "../core/validate_input.mjs";

// Shared regex that flags "interesting" project-status language in free text.
// Exported so confluence/notion connectors classify identically.
export const SIGNAL_RX = /block(ed|er)|at risk|slip|delay|deadline|decision|approved|won'?t make/i;

/**
 * Classify a chunk of text into a signal type.
 * Order matters: blocker > risk > decision > note (most-urgent wins).
 * @param {string} text
 * @returns {"blocker"|"risk"|"decision"|"note"}
 */
export function classify(text) {
  const t = text || "";
  if (/block(ed|er)/i.test(t)) return "blocker";
  if (/at risk|slip|delay|deadline|won'?t make/i.test(t)) return "risk";
  if (/decision|approved/i.test(t)) return "decision";
  return "note";
}

/**
 * Fetch recent messages from a Slack channel and return a ProgramState whose
 * `epics`/`orphans` are empty and whose `signals[]` carry the findings.
 *
 * @param {object} opts
 * @param {string} opts.token    - Slack bot/user token (Bearer).
 * @param {string} opts.channel  - Channel ID (e.g. "C0123ABC"); used as ref fallback.
 * @param {number} [opts.limit]  - Max messages to scan (default 200).
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ token, channel, limit = 200 } = {}) {
  if (!token) throw new Error("slack.fetchProgramState: `token` is required");
  if (!channel) throw new Error("slack.fetchProgramState: `channel` is required");

  // Allow-list the channel id and clamp the limit before building the URL.
  const safeChannel = validateChannel(channel);
  const safeLimit = validateLimit(limit, { def: 200, max: 1000 });

  const url =
    `https://slack.com/api/conversations.history` +
    `?channel=${encodeURIComponent(safeChannel)}&limit=${encodeURIComponent(safeLimit)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // Don't echo the upstream body — status only.
    throw new Error(`Slack request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // Slack returns { ok:false, error:"..." } on logical failures (200 status).
  if (!data.ok) throw new Error(`Slack API error: ${data.error || "unknown"}`);

  const messages = Array.isArray(data.messages) ? data.messages : [];
  const signals = [];

  for (const m of messages) {
    const text = (m.text || "").trim();
    if (!text || !SIGNAL_RX.test(text)) continue; // only keep flagged chatter
    signals.push({
      source: "slack",
      type: classify(text),
      text,
      ref: permalink({ channel: safeChannel, ts: m.ts }),
      ts: tsToDate(m.ts),
    });
  }

  return {
    program: `Slack #${safeChannel}`,
    source: "slack",
    generated_at: today(),
    totals: { by_type: {}, by_status: {}, total: 0 },
    epics: [],
    orphans: [],
    signals,
    flags: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort permalink; without a workspace domain we fall back to the channel. */
function permalink({ channel, ts }) {
  if (channel && ts) return `slack://channel?id=${channel}&message=${ts}`;
  return channel || "";
}

/** Slack ts is "epoch.micros" — turn it into an ISO date (YYYY-MM-DD). */
function tsToDate(ts) {
  const secs = Number.parseFloat(ts);
  if (!Number.isFinite(secs)) return today();
  return new Date(secs * 1000).toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
