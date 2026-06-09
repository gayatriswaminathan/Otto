// connectors/github.fixture.mjs
// Offline fixture for the GitHub connector. A small but valid ProgramState in
// the canonical shape (see core/CONTRACT.md). Use this when no GitHub token is
// available — `fetchProgramState()` ignores its args and returns FIXTURE,
// mirroring the live connector's signature.
//
// Milestones → epics, issues → children grouped by milestone, an un-milestoned
// issue → orphan. (PRs are excluded by the live connector and so are absent here.)

export const FIXTURE = {
  program: "acme/otto",
  source: "github",
  generated_at: "2026-06-08",
  totals: {
    by_type: { Epic: 2, Issue: 6 },
    by_status: { "In Progress": 4, Done: 2, "To Do": 2 },
    total: 8,
  },
  epics: [
    {
      key: "M-1",
      summary: "v0.1 — Read-only rollups",
      status: "In Progress",
      duedate: "2026-06-30T00:00:00Z",
      children: [
        {
          key: "#12",
          summary: "Jira connector normalizes to ProgramState",
          type: "Issue",
          status: "Done",
          priority: "High",
          duedate: null,
          assignee: "octocat",
        },
        {
          key: "#13",
          summary: "Analyze engine + watermelon flags",
          type: "Issue",
          status: "In Progress",
          priority: "Medium",
          duedate: null,
          assignee: "hubot",
        },
        {
          key: "#14",
          summary: "Render rollup HTML with shared theme",
          type: "Issue",
          status: "To Do",
          priority: "Low",
          duedate: null,
          assignee: null,
        },
      ],
      child_counts: { Done: 1, "In Progress": 1, "To Do": 1 },
    },
    {
      key: "M-2",
      summary: "v0.2 — Multi-source",
      status: "In Progress",
      duedate: "2026-07-31T00:00:00Z",
      children: [
        {
          key: "#21",
          summary: "Linear connector",
          type: "Issue",
          status: "In Progress",
          priority: "Urgent",
          duedate: null,
          assignee: "octocat",
        },
        {
          key: "#22",
          summary: "GitHub connector",
          type: "Issue",
          status: "Done",
          priority: "High",
          duedate: null,
          assignee: "octocat",
        },
      ],
      child_counts: { "In Progress": 1, Done: 1 },
    },
  ],
  orphans: [
    {
      key: "#30",
      summary: "Triage: flaky CI on Windows runners",
      type: "Issue",
      status: "To Do",
      priority: null,
      duedate: null,
      assignee: null,
    },
  ],
  flags: [],
};

/** Offline stand-in: ignores args, returns the canned FIXTURE. */
export async function fetchProgramState() {
  return FIXTURE;
}
