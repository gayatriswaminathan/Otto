// connectors/jira.fixture.mjs
// Offline ProgramState fixture (the parsed data/program_state_kan.json, inlined)
// so every layer can run without live Jira credentials. Output shape is
// identical to connectors/jira.mjs → fetchProgramState().

export const FIXTURE = {
  program: "GS Space (KAN)",
  source: "jira",
  generated_at: "2026-06-08",
  totals: {
    by_type: { Epic: 7, Story: 21 },
    by_status: { "To Do": 28 },
    total: 28,
  },
  epics: [
    {
      key: "KAN-4",
      summary: "A — One front door (intake capture)",
      status: "To Do",
      children: [
        { key: "KAN-10", summary: "A1 — Submit an ask through a single intake form", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-11", summary: "A2 — Capture an ask from Slack", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-12", summary: "A3 — Forward an email into the intake queue", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 3 },
    },
    {
      key: "KAN-5",
      summary: "B — Structure the ask (AI)",
      status: "To Do",
      children: [
        { key: "KAN-13", summary: "B1 — Structure a messy ask into an intake item", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-14", summary: "B2 — Ask clarifying questions when an ask is vague", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 2 },
    },
    {
      key: "KAN-6",
      summary: "C — Triage & prioritize",
      status: "To Do",
      children: [
        { key: "KAN-15", summary: "C1 — Classify must-do vs should-do", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-16", summary: "C2 — Score with RICE or WSJF", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-17", summary: "C3 — Flag when too much is marked must-do", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 3 },
    },
    {
      key: "KAN-7",
      summary: "D — Dedupe against the backlog",
      status: "To Do",
      children: [
        { key: "KAN-18", summary: "D1 — Read the existing Jira backlog", type: "Story", status: "To Do", priority: "Medium", duedate: null, links: [{ type: "is blocked by", key: "KAN-30" }] },
        { key: "KAN-19", summary: "D2 — Detect duplicates and link instead of creating", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-20", summary: "D3 — Suggest routing to the right epic", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 3 },
    },
    {
      key: "KAN-8",
      summary: "E — Push to Jira backlog",
      status: "To Do",
      children: [
        { key: "KAN-21", summary: "E1 — Create a well-formed ticket from an approved ask", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-22", summary: "E2 — Link a related ask under an existing issue", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-23", summary: "E3 — Record the intake decision", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 3 },
    },
    {
      key: "KAN-9",
      summary: "F — Status & watermelon view",
      status: "To Do",
      children: [
        { key: "KAN-24", summary: "F1 — Generate an honest status from the backlog", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-25", summary: "F2 — Watermelon detection", type: "Story", status: "To Do", priority: "Medium", duedate: null },
        { key: "KAN-26", summary: "F3 — Three-altitude rewrite", type: "Story", status: "To Do", priority: "Medium", duedate: null },
      ],
      child_counts: { "To Do": 3 },
    },
    {
      key: "KAN-27",
      summary: "G — Foundation (infra & eval)",
      status: "To Do",
      children: [
        { key: "KAN-28", summary: "G1 — Cloudflare Worker + Claude proxy (keyless)", type: "Story", status: "To Do", priority: "Medium", duedate: null, links: [{ type: "blocks", key: "KAN-29" }, { type: "blocks", key: "KAN-30" }, { type: "blocks", key: "KAN-24" }] },
        { key: "KAN-29", summary: "G2 — D1 store (intake items, decisions, versions)", type: "Story", status: "To Do", priority: "Medium", duedate: null, links: [{ type: "is blocked by", key: "KAN-28" }, { type: "blocks", key: "KAN-23" }] },
        { key: "KAN-30", summary: "G3 — Jira connector (read + idempotent write)", type: "Story", status: "To Do", priority: "Medium", duedate: null, links: [{ type: "is blocked by", key: "KAN-28" }, { type: "blocks", key: "KAN-18" }, { type: "blocks", key: "KAN-21" }] },
        { key: "KAN-31", summary: "G4 — Eval harness in CI", type: "Story", status: "To Do", priority: "Medium", duedate: null, links: [{ type: "depends on", key: "KAN-28" }, { type: "blocks", key: "KAN-25" }] },
      ],
      child_counts: { "To Do": 4 },
    },
  ],
  orphans: [],
  flags: [],
};

export default FIXTURE;

// Same signature as connectors/jira.mjs → fetchProgramState, so the Worker can
// swap to the fixture transparently when no Jira creds are present (demo mode).
// eslint-disable-next-line no-unused-vars
export async function fetchProgramState({ project } = {}) {
  return FIXTURE;
}
