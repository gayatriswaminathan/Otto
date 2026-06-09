// connectors/confluence.mjs
// Read-only Confluence connector. Pulls pages from a space and turns each into
// a `signal` (type "note", or "decision"/"risk"/"blocker" when the title/body
// matches our status-language regex). Emits `signals[]`, no work tree.
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY.

import { SIGNAL_RX, classify } from "./slack.mjs";
import { validateSpaceKey, validateBaseUrl, validateLimit } from "../core/validate_input.mjs";

/**
 * Fetch pages from a Confluence space → ProgramState with populated signals[].
 *
 * @param {object} opts
 * @param {string} opts.baseUrl  - Confluence/Atlassian base, e.g. https://site.atlassian.net
 * @param {string} [opts.cloudId] - Cloud id; when present we use the api.atlassian.com gateway.
 * @param {string} opts.token    - OAuth bearer token.
 * @param {string} opts.spaceKey - Space key, e.g. "ENG".
 * @param {number} [opts.limit]  - Max pages to pull (default 50).
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ baseUrl, cloudId, token, spaceKey, limit = 50 } = {}) {
  if (!token) throw new Error("confluence.fetchProgramState: `token` is required");
  if (!spaceKey) throw new Error("confluence.fetchProgramState: `spaceKey` is required");

  // Allow-list the space key and clamp the page limit.
  const safeSpaceKey = validateSpaceKey(spaceKey);
  const safeLimit = validateLimit(limit, { def: 50, max: 100 });

  // SSRF guard: when no cloudId, the attacker-influenceable baseUrl carries the
  // bearer token — restrict it to https *.atlassian.net. With a cloudId we use
  // the fixed api.atlassian.com gateway.
  const root = cloudId
    ? `https://api.atlassian.com/ex/confluence/${cloudId}`
    : validateBaseUrl(baseUrl);
  if (!root) throw new Error("confluence.fetchProgramState: `baseUrl` or `cloudId` is required");

  const url =
    `${root}/wiki/rest/api/content` +
    `?spaceKey=${encodeURIComponent(safeSpaceKey)}&expand=body.storage&limit=${encodeURIComponent(safeLimit)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // Don't echo the upstream body — status only.
    throw new Error(`Confluence request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const pages = Array.isArray(data.results) ? data.results : [];
  const signals = [];

  for (const page of pages) {
    const title = page.title || "(untitled)";
    const storage = page.body?.storage?.value || "";
    const excerpt = stripHtml(storage).slice(0, 160);
    const haystack = `${title} ${excerpt}`;
    // Default these pages to "note"; upgrade to risk/decision/blocker on a match.
    const type = SIGNAL_RX.test(haystack) ? classify(haystack) : "note";

    signals.push({
      source: "confluence",
      type,
      text: excerpt ? `${title} — ${excerpt}` : title,
      ref: pageUrl({ root, page }),
      ts: (page.version?.when || today()).slice(0, 10),
    });
  }

  return {
    program: `Confluence ${safeSpaceKey}`,
    source: "confluence",
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

/** Build a human page URL when the API gives us a webui link, else a tinyui/id fallback. */
function pageUrl({ root, page }) {
  const webui = page._links?.webui;
  if (webui) return `${root}/wiki${webui}`;
  if (page.id) return `${root}/wiki/pages/viewpage.action?pageId=${page.id}`;
  return root;
}

/** Crude HTML→text: drop tags, collapse whitespace, decode a few entities. */
function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
