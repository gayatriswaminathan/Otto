// connectors/jira.mjs
// Read-only Jira Cloud connector. Reads a project's issues via REST v3 and
// normalizes them into the canonical ProgramState (see core/CONTRACT.md and
// data/program_state_kan.json for the exact output shape).
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY: this module never mutates Jira.

import { validateProjectKey, validateBaseUrl } from "../core/validate_input.mjs";

// Jira fields we request for each issue.
const FIELDS = ["summary", "status", "issuetype", "priority", "duedate", "parent", "assignee", "issuelinks"];

// Issue types we treat as epics (everything else is a child/leaf).
const EPIC_TYPES = new Set(["epic"]);

/**
 * Fetch a project from Jira Cloud and return a normalized ProgramState.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl  - Jira site base URL, e.g. https://your.atlassian.net
 *                                  (used to detect basic-auth mode and as a fallback host).
 * @param {string} opts.cloudId  - Atlassian cloud id (for the api.atlassian.com gateway).
 * @param {string} opts.token    - OAuth bearer token, OR an API token when using basic auth.
 * @param {string} opts.project  - Project key, e.g. "KAN".
 * @param {string} [opts.email]  - Atlassian account email; enables basic auth (email:token).
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ baseUrl, cloudId, token, project, email } = {}) {
  if (!project) throw new Error("jira.fetchProgramState: `project` is required");
  if (!token) throw new Error("jira.fetchProgramState: `token` is required");

  // Allow-list the project key BEFORE it is interpolated into JQL (injection guard).
  const safeProject = validateProjectKey(project);

  const { url, headers } = buildRequestContext({ baseUrl, cloudId, token, email });
  const jql = `project = ${quoteProject(safeProject)} ORDER BY created DESC`;

  // Pull every issue in the project (paginated).
  const issues = await fetchAllIssues({ url, headers, jql });

  // Normalize Jira issues → ProgramState.
  return normalize({ project, issues });
}

// ---------------------------------------------------------------------------
// Request context: choose endpoint + auth header.
// ---------------------------------------------------------------------------

/**
 * Decide which endpoint + auth to use.
 * - If `email` is provided AND baseUrl is a *.atlassian.net host, use the site
 *   base URL with HTTP Basic auth (email:token) — handy for personal API tokens.
 * - Otherwise use the api.atlassian.com gateway with an OAuth Bearer token.
 */
function buildRequestContext({ baseUrl, cloudId, token, email }) {
  const host = safeHost(baseUrl);
  const isAtlassianNet = host.endsWith(".atlassian.net");

  // Basic auth path (email:token) against the site host.
  if (email && isAtlassianNet) {
    // SSRF guard: only https *.atlassian.net hosts may carry the credential.
    const origin = validateBaseUrl(baseUrl);
    const basic = base64(`${email}:${token}`);
    return {
      url: `${origin}/rest/api/3/search/jql`,
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
  }

  // OAuth gateway path (default).
  if (!cloudId) {
    throw new Error(
      "jira.fetchProgramState: `cloudId` is required for OAuth (or pass `email` for basic auth on *.atlassian.net)"
    );
  }
  return {
    url: `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
}

// ---------------------------------------------------------------------------
// Pagination — POST /rest/api/3/search/jql (token-based pagination).
// Falls back to the legacy startAt/maxResults shape if nextPageToken is absent.
// ---------------------------------------------------------------------------

async function fetchAllIssues({ url, headers, jql }) {
  const all = [];
  let nextPageToken = undefined;
  let startAt = 0;
  const maxResults = 100;
  let guard = 0; // hard stop against runaway loops

  while (guard++ < 1000) {
    const body = {
      jql,
      fields: FIELDS,
      maxResults,
    };
    // Prefer token pagination; include startAt for legacy /search compatibility.
    if (nextPageToken) body.nextPageToken = nextPageToken;
    else body.startAt = startAt;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Do NOT echo the upstream body or full URL into the error — both can
      // reflect credentials/PII. Status + statusText only.
      throw new Error(`Jira request failed: ${res.status} ${res.statusText}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`Jira response was not valid JSON: ${e.message}`);
    }

    const page = Array.isArray(data.issues) ? data.issues : [];
    all.push(...page);

    // Token pagination (modern /search/jql).
    if (data.nextPageToken) {
      nextPageToken = data.nextPageToken;
      continue;
    }
    // Legacy startAt/total pagination (/search).
    if (typeof data.total === "number") {
      startAt += page.length;
      if (page.length === 0 || startAt >= data.total) break;
      continue;
    }
    // No more pages indicated — stop.
    if (data.isLast === true || page.length === 0) break;
    // Defensive: if we got a full page but no cursor, advance startAt anyway.
    startAt += page.length;
    if (page.length < maxResults) break;
  }

  return all;
}

// ---------------------------------------------------------------------------
// Normalization — Jira issues → ProgramState.
// ---------------------------------------------------------------------------

/**
 * Convert raw Jira issues into the canonical ProgramState.
 * Grouping rules (per CONTRACT):
 *  - Epics become top-level entries (epics with a parent are still listed as epics).
 *  - Non-epic issues are nested under their parent epic's `children`.
 *  - Non-epic issues whose parent is missing/unknown become `orphans`.
 */
function normalize({ project, issues }) {
  // Index by key, splitting epics from leaves.
  const epicsByKey = new Map(); // key -> epic node (ProgramState shape)
  const leaves = []; // { issue, parentKey }

  for (const issue of issues) {
    const f = issue.fields || {};
    const typeName = f.issuetype?.name || "";
    if (EPIC_TYPES.has(typeName.toLowerCase())) {
      const epicNode = {
        key: issue.key,
        summary: f.summary || "",
        status: f.status?.name || "",
        children: [],
        child_counts: {},
      };
      const epicLinks = normalizeLinks(f.issuelinks);
      if (epicLinks.length) epicNode.links = epicLinks;
      epicsByKey.set(issue.key, epicNode);
    } else {
      leaves.push({ issue, parentKey: f.parent?.key || null });
    }
  }

  const orphans = [];

  // Attach each leaf to its parent epic, or to orphans.
  for (const { issue, parentKey } of leaves) {
    const child = toChild(issue);
    const epic = parentKey ? epicsByKey.get(parentKey) : null;
    if (epic) epic.children.push(child);
    else orphans.push(child);
  }

  // Compute per-epic child_counts (by status).
  for (const epic of epicsByKey.values()) {
    epic.child_counts = countBy(epic.children, (c) => c.status);
  }

  const epics = [...epicsByKey.values()];

  // Program-wide totals across epics + all children + orphans.
  const allIssues = issues.map((i) => i.fields || {});
  const totals = {
    by_type: countBy(allIssues, (f) => f.issuetype?.name || "Unknown"),
    by_status: countBy(allIssues, (f) => f.status?.name || "Unknown"),
    total: issues.length,
  };

  return {
    program: deriveProgramName(project, issues),
    source: "jira",
    generated_at: today(),
    totals,
    epics,
    orphans,
    flags: [],
  };
}

/** Map a Jira issue → ProgramState child shape. */
function toChild(issue) {
  const f = issue.fields || {};
  const child = {
    key: issue.key,
    summary: f.summary || "",
    type: f.issuetype?.name || "Unknown",
    status: f.status?.name || "",
    priority: f.priority?.name ?? null,
    duedate: f.duedate ?? null,
    assignee: f.assignee?.displayName ?? null,
  };
  const links = normalizeLinks(f.issuelinks);
  if (links.length) child.links = links;
  return child;
}

/**
 * Normalize Jira's `issuelinks` array → [{ type, key }] for the dependency map.
 *
 * Jira gives each link a `type` object with `inward`/`outward` phrasings (e.g.
 * "is blocked by" / "blocks") plus EITHER `inwardIssue` OR `outwardIssue` (the
 * other end of the link). We map the directional phrase the linked issue plays
 * relative to THIS issue into our canonical vocabulary:
 *   - "blocks"          → "blocks"
 *   - "is blocked by"   → "is blocked by"
 *   - "depends"/"dependency"/"depends on" → "depends on"
 *   - anything else     → "relates to"
 * key = the linked issue's key. Read-only; ignores malformed entries.
 *
 * @param {any} issuelinks - raw `fields.issuelinks`
 * @returns {Array<{type:string,key:string}>}
 */
function normalizeLinks(issuelinks) {
  if (!Array.isArray(issuelinks)) return [];
  const out = [];
  for (const link of issuelinks) {
    if (!link || typeof link !== "object") continue;
    // Direction: an outwardIssue means we point OUT (use the outward phrase);
    // an inwardIssue means the relation points IN (use the inward phrase).
    let phrase;
    let other;
    if (link.outwardIssue) {
      phrase = link.type?.outward;
      other = link.outwardIssue;
    } else if (link.inwardIssue) {
      phrase = link.type?.inward;
      other = link.inwardIssue;
    } else {
      continue;
    }
    const key = other?.key;
    if (!key || typeof key !== "string") continue;
    out.push({ type: normalizeLinkType(phrase), key });
  }
  return out;
}

/** Map a Jira directional link phrase → our canonical link type. */
function normalizeLinkType(phrase) {
  const p = String(phrase || "").trim().toLowerCase();
  if (p === "blocks") return "blocks";
  if (p === "is blocked by") return "is blocked by";
  if (p.includes("depend")) return "depends on"; // Depends on / is a dependency of
  return "relates to";
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/** Count occurrences keyed by a selector, preserving insertion order. */
function countBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Build a friendly program name, e.g. "GS Space (KAN)" or just "KAN". */
function deriveProgramName(project, issues) {
  const projName = issues[0]?.fields?.project?.name;
  return projName ? `${projName} (${project})` : project;
}

/** ISO date (YYYY-MM-DD) for generated_at. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Quote a project key for JQL if it contains anything non-alphanumeric. */
function quoteProject(project) {
  return /^[A-Za-z0-9_]+$/.test(project) ? project : `"${project.replace(/"/g, '\\"')}"`;
}

/** Hostname of a URL, or "" if unparseable. */
function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

/** Base64 encode (Workers: btoa; Node: Buffer). */
function base64(s) {
  if (typeof btoa === "function") return btoa(s);
  // eslint-disable-next-line no-undef
  return Buffer.from(s, "utf8").toString("base64");
}
