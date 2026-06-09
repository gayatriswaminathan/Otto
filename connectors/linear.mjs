// connectors/linear.mjs
// Read-only Linear connector. Reads a team's issues via the Linear GraphQL API
// and normalizes them into the canonical ProgramState (see core/CONTRACT.md and
// data/program_state_kan.json for the exact output shape).
//
// Zero deps. Uses the global `fetch` (Cloudflare Workers + Node 20).
// READ-ONLY: this module never mutates Linear (queries only).

import { validateTeamKey } from "../core/validate_input.mjs";

const ENDPOINT = "https://api.linear.app/graphql";

// Linear page size for the issues connection (max 250).
const PAGE_SIZE = 100;

// Linear state.type → canonical status.
//   completed             → "Done"
//   started               → "In Progress"
//   unstarted | backlog   → "To Do"
//   canceled / triage / … → "To Do" (default)
const STATE_TYPE_TO_STATUS = {
  completed: "Done",
  started: "In Progress",
  unstarted: "To Do",
  backlog: "To Do",
};

// Linear priority (0-4) → canonical priority label.
//   0 = No priority (null), 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
const PRIORITY_TO_LABEL = {
  0: null,
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

/**
 * Fetch a Linear team and return a normalized ProgramState.
 *
 * @param {object} opts
 * @param {string} opts.token - Linear API key (sent as the raw `Authorization` header value).
 * @param {string} opts.team  - Team key (e.g. "ENG") or team name; matched against either.
 * @returns {Promise<object>} ProgramState
 */
export async function fetchProgramState({ token, team } = {}) {
  if (!token) throw new Error("linear.fetchProgramState: `token` is required");
  if (!team) throw new Error("linear.fetchProgramState: `team` is required");

  // Allow-list the team key before it goes into the GraphQL variables.
  const safeTeam = validateTeamKey(team);

  // Pull every issue for the team (paginated), plus the team display name.
  const { issues, teamName } = await fetchAllIssues({ token, team: safeTeam });

  // Normalize Linear issues → ProgramState.
  return normalize({ team: safeTeam, teamName, issues });
}

// ---------------------------------------------------------------------------
// GraphQL fetch + pagination.
// ---------------------------------------------------------------------------

// We filter issues by team key OR name so callers can pass either.
// `parent` is requested so issues nested under a parent issue can fall back to
// it when they have no project.
const ISSUES_QUERY = `
  query OttoTeamIssues($team: String!, $after: String, $first: Int!) {
    teams(filter: { or: [{ key: { eq: $team } }, { name: { eq: $team } }] }, first: 1) {
      nodes { id key name }
    }
    issues(
      first: $first
      after: $after
      filter: { team: { or: [{ key: { eq: $team } }, { name: { eq: $team } }] } }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        identifier
        title
        priority
        dueDate
        state { name type }
        assignee { name }
        project { id name state }
        parent { id identifier title }
      }
    }
  }
`;

async function fetchAllIssues({ token, team }) {
  const all = [];
  let teamName = null;
  let after = null;
  let guard = 0; // hard stop against runaway loops

  while (guard++ < 1000) {
    const data = await graphql({
      token,
      query: ISSUES_QUERY,
      variables: { team, after, first: PAGE_SIZE },
    });

    if (teamName == null) {
      teamName = data.teams?.nodes?.[0]?.name ?? null;
    }

    const conn = data.issues || {};
    const page = Array.isArray(conn.nodes) ? conn.nodes : [];
    all.push(...page);

    if (conn.pageInfo?.hasNextPage && conn.pageInfo?.endCursor) {
      after = conn.pageInfo.endCursor;
      continue;
    }
    break;
  }

  return { issues: all, teamName };
}

/** Execute one GraphQL request and return `data`, throwing on any error. */
async function graphql({ token, query, variables }) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: token, // Linear expects the raw key (no "Bearer ").
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new Error(`Linear request failed (network): ${e.message}`);
  }

  if (!res.ok) {
    // Don't echo the upstream body — it can reflect token/PII. Status only.
    throw new Error(`Linear request failed: ${res.status} ${res.statusText}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`Linear response was not valid JSON: ${e.message}`);
  }

  if (Array.isArray(body.errors) && body.errors.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(`Linear GraphQL error: ${msg}`);
  }
  if (!body.data) throw new Error("Linear GraphQL error: response had no `data`");

  return body.data;
}

// ---------------------------------------------------------------------------
// Normalization — Linear issues → ProgramState.
// ---------------------------------------------------------------------------

/**
 * Convert raw Linear issues into the canonical ProgramState.
 * Grouping rules:
 *  - Linear Projects become epics; issues are grouped under their project.
 *  - If an issue has no project but has a parent issue, that parent becomes a
 *    synthetic epic (so nested issues still nest sensibly).
 *  - Issues with neither project nor parent become `orphans`.
 */
function normalize({ team, teamName, issues }) {
  const epicsByKey = new Map(); // epic key -> epic node (ProgramState shape)
  const orphans = [];

  for (const issue of issues) {
    const child = toChild(issue);
    const epicKey = epicKeyFor(issue);

    if (!epicKey) {
      orphans.push(child);
      continue;
    }

    // Lazily create the epic node the first time we see its key.
    if (!epicsByKey.has(epicKey)) {
      epicsByKey.set(epicKey, makeEpic(issue));
    }
    epicsByKey.get(epicKey).children.push(child);
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
    program: teamName ? `${teamName} (${team})` : team,
    source: "linear",
    generated_at: today(),
    totals,
    epics,
    orphans,
    flags: [],
  };
}

/** The epic this issue belongs to: its project, else its parent issue, else none. */
function epicKeyFor(issue) {
  if (issue.project?.id) return `project:${issue.project.id}`;
  if (issue.parent?.id) return `issue:${issue.parent.id}`;
  return null;
}

/** Build a fresh epic node from the project (preferred) or parent issue. */
function makeEpic(issue) {
  if (issue.project?.id) {
    return {
      key: `project:${issue.project.id}`,
      summary: issue.project.name || "(untitled project)",
      status: mapStatus(null), // filled in by rollUpEpicStatus after children attach
      children: [],
      child_counts: {},
    };
  }
  return {
    key: issue.parent.identifier || `issue:${issue.parent.id}`,
    summary: issue.parent.title || "(untitled parent)",
    status: "To Do",
    children: [],
    child_counts: {},
  };
}

/** Map a Linear issue → ProgramState child shape. */
function toChild(issue) {
  return {
    key: issue.identifier || issue.id,
    summary: issue.title || "",
    type: "Issue",
    status: mapStatus(issue.state?.type),
    priority: mapPriority(issue.priority),
    duedate: issue.dueDate ?? null,
    assignee: issue.assignee?.name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers.
// ---------------------------------------------------------------------------

/** Linear state.type → canonical status (defaults to "To Do"). */
function mapStatus(type) {
  return STATE_TYPE_TO_STATUS[type] || "To Do";
}

/** Linear priority (0-4) → canonical priority label (0 → null). */
function mapPriority(p) {
  if (p == null) return null;
  return PRIORITY_TO_LABEL[p] ?? null;
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
