# Otto — Security Overview

Otto is a Cloudflare Worker that reads a customer's project trackers and
collaboration tools (Jira, Linear, GitHub, Slack, Confluence, Notion),
analyzes program state deterministically, and writes a weekly status rollup.
A large-language-model step (Anthropic's Claude) rewrites the deterministic
facts into three-altitude prose. This document describes, accurately to the
code in this repo, how Otto handles data and what its security posture is.

If a statement here ever conflicts with the code, the code wins and this file
is a bug. Please file it.

---

## 1. Data flow

```
Customer source systems            Otto (Cloudflare Worker)            Anthropic API
(Jira / Linear / GitHub /   --->   1. connectors/* fetch (READ-ONLY)
 Slack / Confluence / Notion)      2. core + engine analyze            (prose step
                                      (deterministic, no network)  --->  only; see §4)
                                   3. engine/render -> HTML / JSON   <---
                                   4. (optional) D1 persistence
                                   5. (optional) outbound delivery
                                      to YOUR Slack/email webhook
        Browser  <--- HTML / JSON rollup --- Otto
```

1. **Read.** Each connector calls the source's official API with a token you
   supply, pulls issues/pages/messages, and normalizes them to a single
   internal shape (`ProgramState`). Connectors never write back.
2. **Analyze.** `engine/analyze.mjs` and `core/*` compute metrics and risk
   flags with pure functions — no network, no LLM.
3. **Narrate.** `engine/narrate.mjs` *optionally* sends the analyzed facts to
   Claude to produce prose. If no key is set, or the call fails, Otto falls
   back to deterministic template text and still ships a rollup.
4. **Render & persist.** The rollup is rendered to HTML/JSON. If a D1 database
   is bound, snapshots and rollups may be stored (see §6).
5. **Deliver.** Optionally, `reporting/delivery.mjs` POSTs a summary to **your
   own** Slack/email webhook (configured in env). This is Otto delivering its
   own report — it is not a write to your source systems.

**Honest scope statement:** Otto is *not* a closed loop. When the Claude
narration step is enabled, the analyzed program facts (epic summaries, status
counts, metrics, and risk flags — see the prompt in `engine/narrate.mjs`)
**leave your infrastructure and are sent to the Anthropic API.** Raw issue
bodies and message text are *not* forwarded to Claude — only the normalized,
aggregated facts the narrator needs. We do not claim "nothing leaves your
stack"; the deterministic core can run with the LLM disabled if you require
zero third-party processing.

---

## 2. What is read-only

Every connector under `connectors/` is read-only against the customer's
systems and was reviewed to confirm it performs no mutation:

| Connector  | API call                                      | Method | Mutates source? |
|------------|-----------------------------------------------|--------|-----------------|
| Jira       | `/rest/api/3/search/jql` (JQL search)         | POST*  | No (search)     |
| Linear     | GraphQL `issues`/`teams` **queries**          | POST*  | No (query)      |
| GitHub     | `/repos/{owner}/{repo}/issues?state=all`      | GET    | No              |
| Slack      | `conversations.history`                       | GET    | No              |
| Confluence | `/wiki/rest/api/content` (read pages)         | GET    | No              |
| Notion     | `/v1/databases/{id}/query`                    | POST*  | No (query)      |

\* Jira search, Linear GraphQL queries, and Notion database queries use HTTP
POST by API design but are pure reads — no create/update/delete is issued.
There is **no** `addComment`, `transition`, `createIssue`, `postMessage`,
`updatePage`, or equivalent anywhere in the codebase. Grant Otto **read-only
scopes** and it cannot change your data even if compromised.

The only outbound writes Otto performs are: (a) the Claude API request (§4),
and (b) optional delivery of *its own* rollup to a webhook **you** configure.

---

## 3. Secrets handling

- **Where secrets live.** All credentials (`JIRA_TOKEN`, `JIRA_BASE_URL`,
  `JIRA_CLOUD_ID`, `ANTHROPIC_API_KEY`, and any source tokens / delivery
  webhook URLs) live **only** in the Worker environment — Wrangler secrets in
  production, a gitignored `.dev.vars` locally. They are never hardcoded.
- **Never committed.** `.gitignore` excludes `.dev.vars`; the repo ships only
  `.dev.vars.example` with placeholder values. Confirmed: no real `.dev.vars`
  is present in the tree.
- **Never sent to the browser.** The `ANTHROPIC_API_KEY` is attached to the
  request to `api.anthropic.com` inside the Worker and is never included in any
  HTML or JSON response. The keyless-proxy design means the browser calls the
  Worker; the Worker calls Claude. The key does not cross to the client.
- **Never in errors or logs.** Connectors were hardened so thrown errors carry
  **only** the HTTP status/statusText of a failed upstream call — they no
  longer echo the upstream response body or the request URL, both of which
  could reflect tokens, query contents, or PII. Structured logs
  (`reporting/*`) log channel + outcome only, never URLs, bodies, or tokens.

> **Worker-level note (apply in `worker/index.mjs`):** the `/rollup` catch
> currently returns `{ error, detail: String(err) }` to the client. Replace
> `detail` with a generic message and log the real error server-side only, so
> stack traces / upstream text never reach a browser.

---

## 4. The Anthropic (Claude) step

- The Worker holds `ANTHROPIC_API_KEY` and calls
  `https://api.anthropic.com/v1/messages` server-side.
- **No training on your data.** Anthropic's commercial terms state that inputs
  and outputs from the API are **not used to train models**. Otto relies on
  this; if you have a Zero-Data-Retention agreement with Anthropic, the API
  calls Otto makes are covered by it.
- **Minimization.** The narrator prompt (`engine/narrate.mjs`) sends only the
  aggregated facts (program name, epic summaries, status counts, metrics,
  flags). It is instructed not to invent data and to fall back deterministically
  on any error. You can disable the LLM entirely (omit `ANTHROPIC_API_KEY`) and
  Otto still produces a rollup from the deterministic core.

---

## 5. Input validation & SSRF protection

All caller- or attacker-influenceable parameters are validated by
`core/validate_input.mjs` **before** they reach a JQL string, a GraphQL
variable, or a URL:

| Parameter                  | Rule                                                |
|----------------------------|-----------------------------------------------------|
| `project`, `spaceKey`      | `^[A-Za-z][A-Za-z0-9_]{0,63}$`                       |
| `team` (Linear)            | `^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$`                  |
| `owner` (GitHub)           | GitHub username/org rules (alnum + single hyphens)  |
| `repo` (GitHub)            | `^[A-Za-z0-9._-]{1,100}$`                            |
| `channel` (Slack)          | `^[CGD][A-Z0-9]{6,20}$`                              |
| `databaseId` (Notion)      | 32-hex or UUID form                                 |
| `limit` / `pageSize`       | clamped to a per-source max                         |

**SSRF.** Where a connector accepts a `baseUrl` (Jira basic-auth path,
Confluence without a cloudId), that URL carries the bearer credential, so it is
passed through `validateBaseUrl()`, which enforces **https** and an
**allow-listed host**: the fixed API gateways
(`api.atlassian.com`, `api.linear.app`, `api.github.com`, `slack.com`,
`api.notion.com`) plus `*.atlassian.net`. A crafted `baseUrl` pointing at an
attacker host (to exfiltrate the token) is rejected with a generic error. All
path/query interpolation uses `encodeURIComponent` and the validated values.

---

## 6. Persistence, retention & deletion

- **Storage.** When a D1 database is bound, Otto may store `snapshots` (the
  captured `ProgramState`), `rollups` (rendered reports + metrics), and
  `decisions` (an audit log). Schema: `db/schema.sql`.
- **Parameterized SQL.** Any reads/writes to D1 must use D1's
  prepared-statement bindings (`db.prepare(sql).bind(...)`) — never string
  concatenation of user input into SQL. The schema itself contains no dynamic
  SQL; the reporting/persistence layer must follow this rule.
- **Retention/deletion.** Otto does not yet implement an automatic retention
  window. Because D1 is *your* database in *your* Cloudflare account, you
  control retention and deletion directly (e.g. a scheduled `DELETE` on
  `snapshots`/`rollups` older than N days). We recommend setting one before
  storing customer data. Deleting a customer = dropping their rows; nothing is
  stored outside your Cloudflare account except the transient Claude API call.

---

## 7. CORS & abuse posture

- **Current state:** the Worker sends `Access-Control-Allow-Origin: *` and only
  allows `GET`/`OPTIONS`. There is no authentication or rate-limiting on the
  rollup routes yet.
- **Risk:** an open, unauthenticated `/rollup?project=...` endpoint lets anyone
  who can reach the Worker trigger reads against your connected systems and burn
  Claude tokens. This is acceptable only for a demo with fixture data.

> **Worker-level hardening to apply (in `worker/index.mjs`):**
> 1. **Tighten CORS** — replace `*` with an explicit allow-list of your own
>    front-end origin(s); reflect only matched origins.
> 2. **Authenticate** — require a shared secret / signed token on `/rollup*`
>    before any connector runs.
> 3. **Validate per route** — call the `core/validate_input.mjs` validators on
>    `project` (and any future query params) at the route boundary, returning a
>    generic `400 invalid input` rather than passing through to a connector.
> 4. **Rate-limit** — add a per-IP / per-token limiter (Cloudflare Rate
>    Limiting rules or a Durable Object / KV counter) to cap rollup frequency.
> 5. **No-secret errors** — return generic error bodies to the client; log
>    detail server-side only.

---

## 8. Dependency safety

- Runtime dependencies: **zero.** Connectors and engine use only the platform
  `fetch` and standard library.
- `package.json` declares a single dev dependency: `wrangler`. No other
  packages are pulled in, which keeps the supply-chain surface minimal.
- Reducing third-party code reduces the chance of a malicious or vulnerable
  transitive dependency touching customer tokens.

---

## 9. Threat model (summary)

| Threat                                            | Mitigation                                                                 |
|---------------------------------------------------|----------------------------------------------------------------------------|
| API key leaks to the browser                      | Key stays in Worker env; keyless proxy; never in responses (§3, §4)        |
| Secrets committed to git                          | `.dev.vars` gitignored; only `.example` committed (§3)                      |
| Tokens/PII leak via error messages or logs        | Errors carry status only; logs carry outcome only (§3)                     |
| Otto mutates a customer's system                  | All connectors read-only; grant read-only scopes (§2)                      |
| SSRF — token exfiltrated to attacker host         | `validateBaseUrl` https + host allow-list (§5)                             |
| JQL / GraphQL / path injection via query params   | Tight allow-list regexes before interpolation (§5)                         |
| SQL injection in D1                               | Prepared statements / bound params required (§6)                           |
| Open endpoint abuse (data reads, token burn)      | **Open gap** — apply CORS lock-down, auth, rate-limit (§7)                 |
| Customer data used to train an LLM                | Anthropic does not train on API data; ZDR-eligible (§4)                    |
| Supply-chain compromise                           | Zero runtime deps; one dev dep (§8)                                        |

**Known open items (not yet fixed in code):** §7 worker-level CORS/auth/
rate-limiting and the §3 worker error-body scrub live in `worker/index.mjs` and
must be applied there. A retention/deletion job (§6) is recommended before
storing real customer data.
