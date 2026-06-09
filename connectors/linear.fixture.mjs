// connectors/linear.fixture.mjs
// Offline fixture for the Linear connector. A small but valid 2-epic
// ProgramState in the canonical shape (see core/CONTRACT.md). Use this when no
// Linear token is available — `fetchProgramState()` ignores its args and
// returns FIXTURE, mirroring the live connector's signature.

export const FIXTURE = {
  program: "Engineering (ENG)",
  source: "linear",
  generated_at: "2026-06-08",
  totals: {
    by_type: { Epic: 2, Issue: 6 },
    by_status: { "In Progress": 4, Done: 2, "To Do": 2 },
    total: 8,
  },
  epics: [
    {
      key: "project:onboarding",
      summary: "Onboarding revamp",
      status: "In Progress",
      children: [
        {
          key: "ENG-101",
          summary: "Redesign welcome screen",
          type: "Issue",
          status: "Done",
          priority: "High",
          duedate: "2026-05-20",
          assignee: "Priya Nair",
        },
        {
          key: "ENG-102",
          summary: "Add progressive sign-up steps",
          type: "Issue",
          status: "In Progress",
          priority: "Medium",
          duedate: "2026-06-15",
          assignee: "Marcus Lee",
        },
        {
          key: "ENG-103",
          summary: "Instrument funnel analytics",
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
      key: "project:billing",
      summary: "Billing reliability",
      status: "In Progress",
      children: [
        {
          key: "ENG-201",
          summary: "Retry failed Stripe webhooks",
          type: "Issue",
          status: "In Progress",
          priority: "Urgent",
          duedate: "2026-06-12",
          assignee: "Sofia Rossi",
        },
        {
          key: "ENG-202",
          summary: "Backfill historical invoices",
          type: "Issue",
          status: "Done",
          priority: "Medium",
          duedate: "2026-05-30",
          assignee: "Priya Nair",
        },
      ],
      child_counts: { "In Progress": 1, Done: 1 },
    },
  ],
  orphans: [
    {
      key: "ENG-300",
      summary: "Spike: evaluate feature-flag vendors",
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
