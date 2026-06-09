// connectors/github.mjs
// Read-only GitHub connector. Reads a repo's issues via the REST API and
// normalizes them into the canonical ProgramState (see core/CONTRACT.md and
// data/program_state_kan.json for the exact output shape).
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY: this module never mutates GitHub (GET only).
//
// Mapping model:
//   GitHub milestones  → epics
//   GitHub issues      → children, grouped under their milestone
//   issues w/o a milestone → orphans
//   PRs are excluded (the issues endpoint returns PRs too; we drop them).

import { validateOwner, validateRepo } from "../core/validate_input.mjs";

const API = "https://api.github.com";

// GitHub returns up to 100 items per page.
const PER_PAGE = 100;

// Label substrings that mark an OPEN issue as actively in progress.
// (Case-insensitive contains-match against each label name.)
const IN_PROGRESS_LABELS = ["in progress", "in-progress", "doing", "wip"];

// Label substrings → canonical priority. Checked in order; first hit wins.
const PRIORITY_LABEL_RULES = [
  { match: ["urgent", "p0", "critical", "priority: urgent"], label: "Urgent" },
  { match: ["high", "p1", "priority: high"], label: "High" },
  { match: ["medium", "p2", "priority: medium"], label: "Medium" },
  { match: ["low", "p3", "priority: low"], label: "Low" },
];

/**
 * Fetch a GitHub repo and return a normalized ProgramState.
 *
 * @param {object} opts
 * @param {string} opts.token - GitHub token (sent as `Authorization: Bearer <token>`).
 * @param {string} opts.owner - Repo owner (user or org), e.g. "anthropics".
 * @param {string} opts.repo  - Repo name, e.g. "otto".
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ token, owner, repo } = {}) {
  if (!token) throw new Error("github.fetchProgramState: `token` is required");
  if (!owner) throw new Error("github.fetchProgramState: `owner` is required");
  if (!repo) throw new Error("github.fetchProgramState: `repo` is required");

  // Allow-list owner/repo before interpolating into the API path.
  owner = validateOwner(owner);
  repo = validateRepo(repo);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "otto-connector",
  };

  // Pull every issue (open + closed, all pages). PRs are filtered out below.
  const rawIssues = await fetchAllIssues({ owner, repo, headers });

  return normalize({ owner, repo, rawIssues });
}

// ---------------------------------------------------------------------------
// Pagination — GET /repos/{owner}/{repo}/issues?state=all (page-based).
// ---------------------------------------------------------------------------

async function fetchAllIssues({ owner, repo, headers }) {
  const all = [];
  let page = 1;
  let guard = 0; // hard stop against runaway loops

  while (guard++ < 1000) {
    const url =
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/issues?state=all&per_page=${PER_PAGE}&page=${page}`;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      throw new Error(`GitHub request failed (network): ${e.message}`);
    }

    if (!res.ok) {
      // Don't echo the upstream body/URL — keep secrets and PII out of errors.
      throw new Error(`GitHub request failed: ${res.status} ${res.statusText}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error(`GitHub response was not valid JSON: ${e.message}`);
    }

    const items = Array.isArray(data) ? data : [];
    all.push(...items);

    // A short page means we've reached the end.
    if (items.length < PER_PAGE) break;
    page += 1;
  }

  // Drop pull requests — the issues endpoint includes PRs (they carry a
  // `pull_request` key); only real issues should become work items.
  return all.filter((it) => !it.pull_request);
}

// ---------------------------------------------------------------------------
// Normalization — GitHub issues → ProgramState.
// ---------------------------------------------------------------------------

function normalize({ owner, repo, rawIssues }) {
  const epicsByKey = new Map(); // milestone key -> epic node
  const orphans = [];

  for (const issue of rawIssues) {
    const child = toChild(issue);
    const ms = issue.milestone;

    if (!ms) {
      orphans.push(child);
      continue;
    }

    const key = `M-${ms.number}`;
    if (!epicsByKey.has(key)) {
      epicsByKey.set(key, {
        key,
        summary: ms.title || `Milestone ${ms.number}`,
        // Epic-level due date comes from the milestone (CONTRACT: due = milestone.due_on).
        status: "To Do",
        duedate: ms.due_on ?? null,
        children: [],
        child_counts: {},
      });
    }
    epicsByKey.get(key).children.push(child);
  }

  // Compute per-epic child_counts (by status) and roll the epic status up.
  for (const epic of epicsByKey.values()) {
    epic.child_counts = countBy(epic.children, (c) => c.status);
    epic.status = rollUpEpicStatus(epic.children);
  }

  const epics = [...epicsByKey.values()];

  // Program-wide totals across epics + all children + orphans.
  const all = [...epics, ...epics.flatMap((e) => e.children), ...orphans];
  const totals = {
    by_type: countBy(all, (x) => x.type),
    by_status: countBy(all, (x) => x.status),
    total: all.length,
  };

  return {
    program: `${owner}/${repo}`,
    source: "github",
    generated_at: today(),
    totals,
    epics,
    orphans,
    flags: [],
  };
}

/** Map a GitHub issue → ProgramState child shape. */
function toChild(issue) {
  const labels = labelNames(issue);
  return {
    key: `#${issue.number}`,
    summary: issue.title || "",
    type: "Issue",
    status: mapStatus(issue.state, labels),
    priority: mapPriority(labels),
    // Per-issue due dates aren't a native GitHub field; milestones carry the date.
    duedate: null,
    assignee: issue.assignee?.login ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers.
// ---------------------------------------------------------------------------

/** Normalize an issue's labels to an array of lowercase name strings. */
function labelNames(issue) {
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  return labels
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/**
 * GitHub state + labels → canonical status.
 *   closed → "Done"
 *   open   → "In Progress" if an in-progress label is present, else "To Do"
 */
function mapStatus(state, labels) {
  if (state === "closed") return "Done";
  const inProgress = labels.some((name) =>
    IN_PROGRESS_LABELS.some((needle) => name.includes(needle))
  );
  return inProgress ? "In Progress" : "To Do";
}

/** Labels → canonical priority (null if no priority label matches). */
function mapPriority(labels) {
  for (const rule of PRIORITY_LABEL_RULES) {
    if (labels.some((name) => rule.match.some((needle) => name.includes(needle)))) {
      return rule.label;
    }
  }
  return null;
}

/**
 * Roll an epic's status up from its children:
 *  - all Done            → "Done"
 *  - any In Progress / a mix with some Done → "In Progress"
 *  - otherwise           → "To Do"
 */
function rollUpEpicStatus(children) {
  if (!children.length) return "To Do";
  const statuses = children.map((c) => c.status);
  if (statuses.every((s) => s === "Done")) return "Done";
  if (statuses.some((s) => s === "In Progress") || statuses.some((s) => s === "Done")) {
    return "In Progress";
  }
  return "To Do";
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

/** ISO date (YYYY-MM-DD) for generated_at. */
function today() {
  return new Date().toISOString().slice(0, 10);
}
