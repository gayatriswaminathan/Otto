// connectors/confluence.fixture.mjs
// Offline fixture for the Confluence connector — valid ProgramState w/ signals[].

export const FIXTURE = {
  program: "Confluence ENG",
  source: "confluence",
  generated_at: "2026-06-08",
  totals: { by_type: {}, by_status: {}, total: 0 },
  epics: [],
  orphans: [],
  signals: [
    {
      source: "confluence",
      type: "decision",
      text: "Architecture Decision: Adopt Cloudflare Workers — we approved Workers + D1 as the standard runtime for all new services.",
      ref: "https://site.atlassian.net/wiki/spaces/ENG/pages/101/Architecture-Decision",
      ts: "2026-06-04",
    },
    {
      source: "confluence",
      type: "risk",
      text: "Q3 Launch Plan — schedule is at risk; the data-migration window may slip into the next freeze.",
      ref: "https://site.atlassian.net/wiki/spaces/ENG/pages/102/Q3-Launch-Plan",
      ts: "2026-06-03",
    },
    {
      source: "confluence",
      type: "note",
      text: "Onboarding Runbook — step-by-step for spinning up a new dev environment.",
      ref: "https://site.atlassian.net/wiki/spaces/ENG/pages/103/Onboarding-Runbook",
      ts: "2026-06-02",
    },
  ],
  flags: [],
};

export async function fetchProgramState() {
  return FIXTURE;
}
