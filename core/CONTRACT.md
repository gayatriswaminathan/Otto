# Otto — Build Contract (shared interface)

Every layer builds to THIS. Do not change signatures without updating this file.
ESM (`.mjs`), Node 20+, zero runtime deps where possible. Runs on Cloudflare Workers.

## Program State (canonical model) — the only thing the engine reads
```jsonc
{
  "program": "GS Space (KAN)",
  "source": "jira",
  "generated_at": "2026-06-08",
  "totals": { "by_type": {"Epic":7,"Story":21}, "by_status": {"To Do":28}, "total": 28 },
  "epics": [
    { "key":"KAN-4", "summary":"A — One front door", "status":"To Do",
      "children":[ {"key","summary","type","status","priority","duedate","assignee"} ],
      "child_counts": {"To Do":3} }
  ],
  "orphans": [ {"key","summary","type","status","priority","duedate","assignee"} ],
  "flags": []   // reserved; engine fills derived flags
}
```

## Module interfaces (file → exports)
- `connectors/jira.mjs` → `export async function fetchProgramState({ baseUrl, cloudId, project, token }) : ProgramState`
  - Reads Jira Cloud REST v3 (`/rest/api/3/search` JQL `project = <KEY>`), groups children under parent epics, returns ProgramState. Read-only.
- `core/program_state.mjs` → `export function flatten(state)`, `export function validate(state)`, status sets `DONE`, `PROGRESS`.
- `engine/analyze.mjs` → `export function analyze(state) : { metrics, flags, dependencyRoot }`
  - `metrics`: {total, done, inprog, todo, readiness, momentum}. `flags`: [{level:'green|amber|red', title, detail}] incl. watermelon checks. Deterministic, no LLM.
- `engine/narrate.mjs` → `export async function narrate(state, analysis, { callClaude }) : { exec, eng, stakeholder }`
  - Uses `callClaude(prompt)` if provided; else returns the deterministic template strings. Never throws — falls back on error.
- `engine/render.mjs` → `export function renderRollupHTML(state, analysis, narrative) : string`
- `worker/index.mjs` → Cloudflare Worker `fetch` handler. Routes: `GET /rollup?project=KAN` (HTML), `GET /rollup.json?project=KAN` (JSON), `GET /health`. Reads secrets from `env` (JIRA_TOKEN, JIRA_BASE_URL, JIRA_CLOUD_ID, ANTHROPIC_API_KEY). Implements `callClaude` as a keyless proxy (key stays in `env`).
- `eval/eval.mjs` → runs cases in `eval/cases/*.json` through analyze(), asserts expected flags. Exit non-zero on fail (CI gate).

## Secrets (never in code or client)
`JIRA_TOKEN`, `JIRA_BASE_URL`, `JIRA_CLOUD_ID`, `ANTHROPIC_API_KEY` — Wrangler secrets / `.dev.vars` only. `.dev.vars` is gitignored.

## Multi-source (v1) — every source normalizes to the SAME model
Structured trackers (Jira, Linear, GitHub) produce `epics[].children[]`. Unstructured sources
(Slack, Confluence, Notion) produce `signals[]` instead of a work tree:
```jsonc
"signals": [ { "source":"slack", "type":"risk|blocker|decision|note", "text":"...", "ref":"<url>", "ts":"2026-06-08" } ]
```
`signals` is OPTIONAL on ProgramState (engine ignores if absent; folds risk/blocker signals into flags if present).

- Each connector file: `connectors/<source>.mjs` → `export async function fetchProgramState(opts) : ProgramState` (read-only). Plus `connectors/<source>.fixture.mjs` → `export const FIXTURE` + `export async function fetchProgramState(){return FIXTURE}` for offline.
- Registry: `connectors/index.mjs` → `export const CONNECTORS = { jira, linear, github, slack, confluence, notion }` (each the module's fetch fn) and `export async function loadSources(specs, env) : ProgramState` which fetches each requested source and merges.
- Merge: `core/program_state.mjs` → `export function mergeStates(states) : ProgramState` — concat epics (dedupe by key), sum totals, concat orphans + signals, program = joined names.

## Design system — ONE theme, every surface
`core/theme.mjs` → `export const THEME_HEAD` (Google Fonts links: Fraunces + Geist) and `export const THEME_CSS` (the shared tokens + components: cream/yellow palette, Fraunces headings, Geist body, `.card .badge .pill .kpi` etc — matching the landing page `autonomous-tpm-offer.html`). `engine/render.mjs`, `web/index.html`, and the landing page all use THESE tokens — no per-file font/colour redefinition. The rollup must use **Fraunces headings + Geist body**, not Inter.

## Offer parity (v2) — the engine must deliver what the landing page sells
The audit offer promises: "Full readiness assessment + scorecard" and "Risk & dependency map". Build them for real.

### Issue links (connector → model)
Each child/issue gains optional `links: [{ type:"blocks"|"is blocked by"|"depends on"|"relates to", key:"<other-issue-key>" }]`.
Jira connector fetches the `issuelinks` field and maps to this. `flatten()` already carries child fields through unchanged.

### analyze() gains two outputs
- `analysis.dependencies` = `{ source:"links"|"inferred", nodes:[{key,summary,status}], edges:[{from,to,type}], roots:[key], blocked:[{key, blockedBy:[key]}], criticalPath:[key], cycles:[[key]] }`.
  Built from real `links` when present; if NO links exist anywhere, fall back to the name-regex root and set `source:"inferred"` (and render must label it inferred). A real map is preferred; never present an inferred guess as if it were link-derived.
- `analysis.readiness` = `{ score:0-100, grade:"Not started"|"At risk"|"On track"|"Ready", gates:[{name,pass,detail}], perEpic:[{key, score, gates:[{name,pass}]}] }`.
  Gates (program + per-epic): Scoped (has children), Owned (≥50% assigned), Scheduled (≥50% dated), Prioritized (priorities set, not all-default), Unblocked (no blocked items), In motion (>0 done or in progress). Score = % gates passed.

### render() gains two sections (titles must match the offer wording)
- "Readiness scorecard" — overall grade + score + the gate pass/fail list + per-epic mini-scores.
- "Risk & dependency map" — the dependency chains (blocks → blocked), blocked items with their blockers, critical path, and any cycles; inline SVG or clean adjacency list, no external libs. If `source:"inferred"`, show the honest "inferred from epic name — no issue links found" note.

### Brand = single source of truth
The landing page `autonomous-tpm-offer.html` is the canonical brand. `core/theme.mjs` must match it exactly (logo, palette, fonts). A check script asserts they match and fails the build on drift. The hand-authored demo rollup is deleted — only engine-generated output is shown.

## Multi-tenancy (v2) — FIRST-CLASS, contract-first (build at customer #2)
Ruling: tenancy is a property of the shared interface, not a patch in two files. The contract below is canonical; `schema.sql`, `store.mjs`, and the worker flow DOWN from it. Update this section BEFORE writing any tenancy code. (Single-tenant pilots = Worker-per-customer, none of this required yet.)

- **Account/Tenant identity** — a `accounts` D1 table; a `tenant_id` is top-level identity. Every persisted artifact and every credential lookup is keyed by it.
- **`tenant_id` in the model + signatures** — ProgramState carries `tenant_id`. These `store.mjs` exports REQUIRE a `tenant_id` arg: `saveSnapshot · saveRollup · saveRun · priorSnapshot · listReports · getReport · readinessTrend`. So do `buildRollup` / `loadProgramState` in the worker.
- **Credential resolution** — replace global `env` creds + `SOURCE_CONFIG` creds with a contract function `resolveCreds(tenant_id, source, env) : creds` returning the tenant's encrypted (OAuth) credentials. The worker never reads a global `JIRA_TOKEN` on a multi-tenant route.
- **Isolation invariant (HARD RULE all modules honor):** every persisted row carries `tenant_id`; every read/write filters by `tenant_id`; no cross-tenant read is possible. e.g. `getReport` MUST be `WHERE id = ? AND tenant_id = ?`.
- **Enforcement** — a `check:isolation` gate (sibling of `check:brand`) statically scans D1 queries and FAILS the build if any SELECT/INSERT/UPDATE on a tenant-scoped table lacks a `tenant_id` predicate/column. Isolation-drift fails CI like brand-drift does.
- **Unchanged (blast radius):** the deterministic core stays tenant-agnostic — `connectors/<source>.fetchProgramState(opts)`, `core/program_state.mjs` (`flatten/validate/mergeStates`), `engine/analyze · narrate · render`, and `eval/` signatures do NOT change. Tenancy lives only at identity, credential-resolution, and persistence boundaries.

## Cloud / data
Cloudflare Worker (orchestrator + Claude proxy) · D1 (`db/schema.sql`: snapshots, rollups, decisions) · static `web/` shell calls the Worker.
