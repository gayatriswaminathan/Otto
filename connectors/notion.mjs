// connectors/notion.mjs
// Read-only Notion connector. Queries a database and turns each row into a
// `signal` (type "note", or risk/decision/blocker by keyword in the title).
// Emits `signals[]`, no work tree.
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY.

import { SIGNAL_RX, classify } from "./slack.mjs";
import { validateDatabaseId, validateLimit } from "../core/validate_input.mjs";

const NOTION_VERSION = "2022-06-28";

/**
 * Query a Notion database → ProgramState with populated signals[].
 *
 * @param {object} opts
 * @param {string} opts.token       - Notion integration token (Bearer).
 * @param {string} opts.databaseId  - Database id to query.
 * @param {number} [opts.pageSize]  - Rows to pull (default 100, Notion max 100).
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ token, databaseId, pageSize = 100 } = {}) {
  if (!token) throw new Error("notion.fetchProgramState: `token` is required");
  if (!databaseId) throw new Error("notion.fetchProgramState: `databaseId` is required");

  // Allow-list the database id (hex/UUID) and clamp page size to Notion's max.
  const safeDatabaseId = validateDatabaseId(databaseId);
  const safePageSize = validateLimit(pageSize, { def: 100, max: 100 });

  const url = `https://api.notion.com/v1/databases/${encodeURIComponent(safeDatabaseId)}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ page_size: safePageSize }),
  });
  if (!res.ok) {
    // Don't echo the upstream body — status only.
    throw new Error(`Notion request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const rows = Array.isArray(data.results) ? data.results : [];
  const signals = [];

  for (const row of rows) {
    const title = titleOf(row);
    const type = SIGNAL_RX.test(title) ? classify(title) : "note";
    signals.push({
      source: "notion",
      type,
      text: title,
      ref: row.url || `https://www.notion.so/${(row.id || "").replace(/-/g, "")}`,
      ts: (row.last_edited_time || today()).slice(0, 10),
    });
  }

  return {
    program: `Notion ${safeDatabaseId.slice(0, 8)}`,
    source: "notion",
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

/** Extract the first "title"-typed property's plain text from a Notion page. */
function titleOf(row) {
  const props = row.properties || {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === "title" && Array.isArray(p.title)) {
      const text = p.title.map((t) => t.plain_text || "").join("").trim();
      if (text) return text;
    }
  }
  return "(untitled)";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
