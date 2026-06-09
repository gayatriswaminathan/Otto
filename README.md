# Otto — the autonomous TPM

Otto reads where a program actually lives (today: a Jira board), keeps one
canonical model of it, and produces an **honest** weekly rollup: launch
readiness, momentum, and the risk/dependency flags a senior TPM would raise —
including **watermelon** detection (green on the outside, not-green underneath).
The judgment calls get escalated back to the program's owners.

Runs on the **$0 / near-$0 stack**: a single Cloudflare Worker as the brain, a
keyless Claude proxy for prose, D1 for memory, and a static web shell. Secrets
live only in the Worker — never in source or the client.

## Architecture (5 lines)

1. **Connectors** (read-only, one per source) normalize Jira → one **Program State** model.
2. The **engine** reads *only* Program State: `analyze()` is deterministic (readiness, momentum, watermelon + dependency flags) — no LLM, no I/O.
3. `narrate()` adds the three-altitude prose via Claude, and falls back to deterministic templates if the proxy is unavailable.
4. The **Cloudflare Worker** orchestrates the flow and is the keyless Claude proxy; **D1** stores snapshots so Otto has week-over-week memory.
5. The **web shell** and CI **eval harness** sit on top. Full detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md); the build maps 1:1 to KAN epics A–G.

## Repo map

```
otto/
  core/
    CONTRACT.md          shared interface — every layer builds to this
    program_state.mjs    canonical model: status sets, flatten(), validate()
  connectors/
    jira.mjs             Jira Cloud REST → Program State (read-only)   [KAN-30/G3]
    jira.fixture.mjs     bundled fixture so the demo runs creds-free
  engine/
    analyze.mjs          deterministic analysis + watermelon flags     [KAN-25/F2]
    narrate.mjs          three-altitude prose (Claude or template)     [KAN-26/F3]
    render.mjs           rollup → HTML / JSON
    cli.mjs              local rollup generator (npm run rollup)
  worker/
    index.mjs            Cloudflare Worker: /rollup, /rollup.json, /health [KAN-28/G1]
  db/schema.sql          D1: snapshots, rollups, decisions               [KAN-29/G2]
  eval/
    eval.mjs             CI eval harness — the quality moat              [KAN-31/G4]
    cases/*.json         program-state fixtures + expected flags
  web/index.html         static shell — calls the Worker, renders the rollup
  data/program_state_kan.json   the real GS Space (KAN) board snapshot
  ARCHITECTURE.md · wrangler.toml · package.json
```

## Run the rollup locally (uses the fixture)

No credentials needed — this renders from `data/program_state_kan.json`.

```bash
cd otto
npm run rollup          # node engine/cli.mjs → prints/writes the rollup
```

You'll get the honest rollup for the real KAN board: 0% readiness, and the
three watermelon flags (*No schedule signal*, *No prioritization*, *Not started*).

## Run the evals (the quality moat)

Every fixture in `eval/cases/*.json` is run through `analyze()` and checked
against the watermelon flags it must (or must not) produce. The run exits
non-zero on any failure, so it gates CI ([`.github/workflows/eval.yml`](./.github/workflows/eval.yml),
on push/PR, Node 20).

```bash
cd otto
npm run eval            # node eval/eval.mjs
```

Cases cover: (a) the real KAN board — all three watermelon flags; (b) a healthy
board — none of them; (c) an overdue board — the per-item *Overdue* flag; and
(d) a single-priority started board — *No prioritization* only.

## Run the web shell

Open `web/index.html` (any static host, or `npx serve web`). Enter a project
key (default `KAN`) and the Worker base URL (blank = same-origin; for local dev
use `http://localhost:8787`), then **Generate rollup**. If the Worker isn't
running it shows a graceful message telling you how to start it.

## Deploy the Worker live (Cloudflare, $0 tier)

```bash
cd otto
npm install
wrangler d1 create otto                 # paste the printed id into wrangler.toml
wrangler d1 execute otto --file db/schema.sql

# Secrets — stay in Worker env, never in source or the client:
wrangler secret put JIRA_TOKEN
wrangler secret put JIRA_BASE_URL
wrangler secret put JIRA_CLOUD_ID
wrangler secret put ANTHROPIC_API_KEY   # omit to run deterministic-only

npm run dev                             # local at http://localhost:8787
npm run deploy                          # → https://otto.<account>.workers.dev
```

For local dev, mirror the secrets into `otto/.dev.vars` (gitignored). With no
Jira creds the Worker serves the bundled fixture in demo mode, so it always
renders.

Routes: `GET /rollup?project=KAN` (HTML) · `GET /rollup.json?project=KAN` (JSON)
· `GET /health`.

See [`core/CONTRACT.md`](./core/CONTRACT.md) for the module interfaces and the
Program-State schema — the contract every layer builds to.
