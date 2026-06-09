# Otto — Architecture (v0)

**Otto = the autonomous TPM.** Reads where a program lives, keeps a live model of it, and produces honest status, launch readiness, and risk/dependency flags. Escalates the judgment calls to the program's owners.

This architecture follows two constraints:
1. **$0 / near-$0 to run** (the "$0 AI stack" — Cloudflare free tier, D1, MCP, local or low-cost models).
2. **It already matches the KAN backlog.** Epics A–G on the GS Space board *are* this product; Epic G (Foundation) already names the stack. This doc just makes it explicit.

## The core idea: connectors → program state → engine → outputs

The thing that keeps this from becoming spaghetti as we add sources: **every source normalizes into one common Program-State model, and the Otto engine only ever reads that model.** Adding Linear, Notion, or Slack never touches the brain.

```
  SOURCES (any place a program stores data)
  Jira · Linear · Confluence · Notion · Slack · GitHub · email intake
        │   (read-only connectors, one per source)
        ▼
  ┌─────────────────────────┐
  │  PROGRAM STATE (canonical model)  │   epics → children, status, dates,
  │  one schema, source-agnostic       │   priority, owners, dependencies, flags
  └─────────────────────────┘
        │
        ▼
  ┌─────────────────────────┐
  │  OTTO ENGINE                       │   readiness %, momentum, watermelon
  │  deterministic core + LLM polish   │   detection, risk & dependency flags
  └─────────────────────────┘
        │
        ▼
  OUTPUTS:  Weekly rollup (3 altitudes) · Launch-readiness scorecard · Risk register
            delivered to: email · Slack · web · back into Jira (idempotent write)
```

## Stack ($0 / near-$0), mapped to the KAN epics

| Layer | Choice | KAN ticket |
|---|---|---|
| **Frontend** | Next.js on Vercel free tier (the Otto web view + the marketing page) | A — One front door |
| **Orchestrator** | Cloudflare Worker (the "brain" runs the end-to-end flow). LangGraph/CrewAI only if flows get branchy. | G1 / KAN-28 |
| **LLM (brain)** | **Decision point — see below.** Default: Claude via a *keyless* Worker proxy (key stays in Worker secrets, never in client). True-$0 alt: Ollama (Gemma/Llama 3.3) local. | G1 / KAN-28 |
| **Tool use** | MCP connectors — Jira (read + idempotent write), Slack, GitHub | G3 / KAN-30 |
| **Data** | Cloudflare D1 (SQLite) — intake items, decisions, versions, state snapshots | G2 / KAN-29 |
| **Retrieval (later)** | Notion/Confluence docs → Chroma/Qdrant for the RAG layer (dedupe, routing) | D — Dedupe |
| **Eval** | Eval harness in CI — every Otto output graded before it ships (this is the quality moat) | G4 / KAN-31 |
| **Deploy** | Cloudflare Workers (free tier) + Docker; Hugging Face if a model needs hosting | G — Foundation |
| **Observability** | Phoenix (self-hosted) — trace every run | G — Foundation |

### The one real cost decision
The $0 diagram runs the LLM **locally** (Ollama) for true $0. Your KAN-28 chose **Claude via keyless proxy** — better judgment, but not free. Recommendation: **Claude for the brain** (the whole pitch is "senior-TPM judgment"; local 8B models won't carry it), everything else on the $0 stack. Estimated cost at pilot scale is a few dollars of API per program per week, not infrastructure. We can keep an Ollama fallback for cheap/bulk steps (dedupe, classification).

## Build order (vertical slices, always something working)

1. **G3 read + Program State** — Jira connector reads a board → normalized state. ✅ *working now* (see `data/program_state_kan.json`).
2. **F1 honest status** — engine turns state into an honest rollup. ✅ *first version in `engine/generate_rollup.mjs`*.
3. **F2 watermelon detection** — flag "looks green, isn't" (no dates, all-To-Do, single priority). ✅ *in the engine*.
4. **G1 Worker + Claude proxy** — move the prose/voice step to Claude behind a keyless Worker.
5. **G2 D1 store** — persist state snapshots so Otto has memory week-over-week (detect *changes*, not just status).
6. **G4 eval harness** — grade every rollup before send.
7. **Add sources** — Linear, Confluence, Slack connectors → same Program-State model.
8. **Outputs** — email/Slack delivery + idempotent write-back to Jira.

## Security (non-negotiable, your own principle)
Secrets live **only** in Cloudflare Worker env / Secret Manager — never in the client or the repo. Connectors are **read-only** except the explicit, idempotent Jira write. Per-program scoping. No program data used to train models (Claude API: off by default).
