// connectors/notion.fixture.mjs
// Offline fixture for the Notion connector — valid ProgramState w/ signals[].

export const FIXTURE = {
  program: "Notion 1a2b3c4d",
  source: "notion",
  generated_at: "2026-06-08",
  totals: { by_type: {}, by_status: {}, total: 0 },
  epics: [],
  orphans: [],
  signals: [
    {
      source: "notion",
      type: "blocker",
      text: "Mobile build blocked on App Store provisioning profile",
      ref: "https://www.notion.so/Mobile-build-blocked-aaaa1111",
      ts: "2026-06-07",
    },
    {
      source: "notion",
      type: "decision",
      text: "Approved: ship the weekly rollup behind a feature flag",
      ref: "https://www.notion.so/Approved-weekly-rollup-bbbb2222",
      ts: "2026-06-06",
    },
    {
      source: "notion",
      type: "note",
      text: "Research notes: competitor pricing teardown",
      ref: "https://www.notion.so/Research-notes-cccc3333",
      ts: "2026-06-05",
    },
  ],
  flags: [],
};

export async function fetchProgramState() {
  return FIXTURE;
}
