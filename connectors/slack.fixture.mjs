// connectors/slack.fixture.mjs
// Offline fixture for the Slack connector — a valid ProgramState with signals[].
// Drop-in: same `fetchProgramState` signature, ignores opts.

export const FIXTURE = {
  program: "Slack #program-updates",
  source: "slack",
  generated_at: "2026-06-08",
  totals: { by_type: {}, by_status: {}, total: 0 },
  epics: [],
  orphans: [],
  signals: [
    {
      source: "slack",
      type: "blocker",
      text: "Payments service is blocked on the new vendor API key — nothing ships until infra grants it.",
      ref: "slack://channel?id=C0PROGRAM&message=1717804800.000100",
      ts: "2026-06-07",
    },
    {
      source: "slack",
      type: "risk",
      text: "Heads up: the onboarding redesign may slip past the June 20 deadline if design review lands late.",
      ref: "slack://channel?id=C0PROGRAM&message=1717718400.000200",
      ts: "2026-06-06",
    },
    {
      source: "slack",
      type: "decision",
      text: "Decision: we approved moving SSO to Phase 2 so the launch isn't gated on it.",
      ref: "slack://channel?id=C0PROGRAM&message=1717632000.000300",
      ts: "2026-06-05",
    },
  ],
  flags: [],
};

export async function fetchProgramState() {
  return FIXTURE;
}
