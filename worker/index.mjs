// otto/worker/index.mjs
// Cloudflare Worker — orchestrator + keyless Claude proxy + reporting.
//
// Pulls program state from one or more sources (multi-source via the connector
// registry), analyzes it deterministically, narrates it with Claude (the API key
// never leaves this Worker), renders HTML/JSON, persists each run + rollup to D1,
// and can deliver/scheduled-run weekly.
//
// Routes:
//   GET /health                              -> { ok: true }
//   GET /rollup?source=jira&project=KAN      -> HTML rollup   (source|sources, multi via comma)
//   GET /rollup.json?sources=jira,slack      -> JSON
//   GET /reports?program=...                 -> report history page
//   GET /report?id=...                       -> a stored rollup
//   (scheduled) weekly cron                  -> generate + store + deliver
//
// Secrets (Wrangler / .dev.vars), all optional except per-source:
//   ANTHROPIC_API_KEY · JIRA_TOKEN/JIRA_BASE_URL/JIRA_CLOUD_ID · LINEAR_TOKEN ·
//   GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO · SLACK_TOKEN/SLACK_CHANNEL ·
//   CONFLUENCE_TOKEN/CONFLUENCE_SPACE · NOTION_TOKEN/NOTION_DATABASE_ID ·
//   OTTO_ACCESS_TOKEN (gates data routes) · ALLOWED_ORIGINS (CORS allow-list) ·
//   SLACK_WEBHOOK_URL / REPORT_EMAIL_WEBHOOK (delivery)

import { CONNECTORS } from '../connectors/index.mjs';
import { mergeStates } from '../core/program_state.mjs';
import { analyze } from '../engine/analyze.mjs';
import { narrate } from '../engine/narrate.mjs';
import { renderRollupHTML, renderRollupJSON } from '../engine/render.mjs';
import {
  validateProjectKey, validateTeamKey, validateOwner, validateRepo,
  validateChannel, validateSpaceKey, validateDatabaseId,
} from '../core/validate_input.mjs';
import { saveRun, saveSnapshot, priorSnapshot, saveRollup, listReports, getReport, readinessTrend } from '../reporting/store.mjs';
import { validateCadence, periodDays } from '../core/cadence.mjs';
import { trace, newRunId } from '../reporting/observability.mjs';
import { deliver } from '../reporting/delivery.mjs';
import { renderReportsPage } from '../reporting/report.mjs';

// Fixtures (statically imported so the bundler can see them; used for demo mode).
import { fetchProgramState as jiraFix } from '../connectors/jira.fixture.mjs';
import { fetchProgramState as linearFix } from '../connectors/linear.fixture.mjs';
import { fetchProgramState as githubFix } from '../connectors/github.fixture.mjs';
import { fetchProgramState as slackFix } from '../connectors/slack.fixture.mjs';
import { fetchProgramState as confluenceFix } from '../connectors/confluence.fixture.mjs';
import { fetchProgramState as notionFix } from '../connectors/notion.fixture.mjs';

const FIXTURES = { jira: jiraFix, linear: linearFix, github: githubFix, slack: slackFix, confluence: confluenceFix, notion: notionFix };

// Per-source config: which env creds make it "live", and how to build opts
// (opts builders also validate every attacker-influenceable param).
const SOURCE_CONFIG = {
  jira: { creds: ['JIRA_TOKEN', 'JIRA_BASE_URL', 'JIRA_CLOUD_ID'],
    opts: (env, p) => ({ baseUrl: env.JIRA_BASE_URL, cloudId: env.JIRA_CLOUD_ID, token: env.JIRA_TOKEN, email: env.JIRA_EMAIL, project: validateProjectKey(p.project || 'KAN') }) },
  linear: { creds: ['LINEAR_TOKEN'],
    opts: (env, p) => ({ token: env.LINEAR_TOKEN, team: validateTeamKey(p.team || env.LINEAR_TEAM || 'Eng') }) },
  github: { creds: ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'],
    opts: (env, p) => ({ token: env.GITHUB_TOKEN, owner: validateOwner(p.owner || env.GITHUB_OWNER), repo: validateRepo(p.repo || env.GITHUB_REPO) }) },
  slack: { creds: ['SLACK_TOKEN', 'SLACK_CHANNEL'],
    opts: (env, p) => ({ token: env.SLACK_TOKEN, channel: validateChannel(p.channel || env.SLACK_CHANNEL) }) },
  confluence: { creds: ['CONFLUENCE_TOKEN', 'JIRA_BASE_URL', 'JIRA_CLOUD_ID', 'CONFLUENCE_SPACE'],
    opts: (env, p) => ({ baseUrl: env.JIRA_BASE_URL, cloudId: env.JIRA_CLOUD_ID, token: env.CONFLUENCE_TOKEN, spaceKey: validateSpaceKey(p.spaceKey || env.CONFLUENCE_SPACE) }) },
  notion: { creds: ['NOTION_TOKEN', 'NOTION_DATABASE_ID'],
    opts: (env, p) => ({ token: env.NOTION_TOKEN, databaseId: validateDatabaseId(p.database || env.NOTION_DATABASE_ID) }) },
};

// --- CORS (allow-list, not blanket '*') -------------------------------------
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const h = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  // If no allow-list configured, fall back to '*' (demo). If configured, reflect
  // ONLY a matching origin — never echo an un-allowed one.
  if (allowed.length === 0) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(body, init = {}, cors = {}) {
  return new Response(JSON.stringify(body, null, 2), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors, ...(init.headers || {}) } });
}
function html(body, init = {}, cors = {}) {
  return new Response(body, { ...init, headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors, ...(init.headers || {}) } });
}

// --- access token (gates data routes if OTTO_ACCESS_TOKEN is set) ------------
function authorized(request, env) {
  const want = env.OTTO_ACCESS_TOKEN;
  if (!want) return true; // open demo mode when unset
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const key = new URL(request.url).searchParams.get('key');
  return bearer === want || key === want;
}

// --- soft per-IP rate limit (in-isolate; add CF Rate Limiting for prod) ------
const HITS = new Map();
function rateLimited(ip, { windowMs = 60000, max = 30 } = {}) {
  const now = Date.now();
  const rec = HITS.get(ip) || { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n += 1; HITS.set(ip, rec);
  return rec.n > max;
}

// --- keyless Claude proxy (key stays in env, never reaches the browser) ------
function makeCallClaude(env) {
  return async function callClaude(prompt) {
    if (!env.ANTHROPIC_API_KEY) return null;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) { console.error(`Claude API ${res.status}`); return null; }
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return text || null;
    } catch (err) { console.error('callClaude failed:', err?.message); return null; }
  };
}

// --- multi-source loader: live where creds exist, fixture otherwise ----------
async function loadProgramState(env, sources, params) {
  const states = [];
  let usingFixture = false;
  for (const source of sources) {
    const cfg = SOURCE_CONFIG[source];
    const haveCreds = cfg.creds.every((k) => env[k]);
    if (haveCreds) {
      try { states.push(await CONNECTORS[source](cfg.opts(env, params), env)); continue; }
      catch (err) { console.error(`live ${source} failed, using fixture:`, err?.message); }
    }
    states.push(await FIXTURES[source](params)); usingFixture = true;
  }
  return { state: states.length === 1 ? states[0] : mergeStates(states), usingFixture };
}

const FIXTURE_BANNER =
  '<div style="background:#FFF4E5;border:1px solid #F0B429;color:#7A5200;padding:12px 16px;border-radius:8px;margin:16px 0;font-family:system-ui,sans-serif;font-size:14px">' +
  '<strong>Demo mode.</strong> One or more sources had no credentials — showing bundled fixture data. Set the source secrets to pull live program state.</div>';

function parseSources(searchParams) {
  const raw = (searchParams.get('sources') || searchParams.get('source') || 'jira');
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const s of list) if (!SOURCE_CONFIG[s]) throw new Error(`unknown source "${s}"`);
  return list.length ? list : ['jira'];
}

// --- the rollup pipeline, traced + persisted --------------------------------
// `cadence` ('weekly'|'biweekly'|'monthly'|'quarterly') drives both the delta
// look-back window and the rendered title/phrasing.
async function buildRollup(env, sources, params, route, cadence = 'weekly') {
  const run_id = newRunId();
  return trace('rollup', { run_id, route, sources: sources.join('+'), cadence }, async () => {
    const { state, usingFixture } = await loadProgramState(env, sources, params);
    // Delta baseline = the snapshot one cadence period back (guarded if no D1).
    let prior = null;
    if (env.DB) {
      try { prior = await priorSnapshot(env.DB, state.program, periodDays(cadence)); }
      catch (err) { console.error('priorSnapshot failed:', err?.message); }
    }
    const analysis = analyze(state, undefined, prior);
    analysis.cadence = cadence; // thread to render (title + "since …" phrasing)
    const narrative = await narrate(state, analysis, { callClaude: makeCallClaude(env) });
    const body = renderRollupHTML(state, analysis, narrative);
    const result = { run_id, state, usingFixture, analysis, narrative, body, route };
    // persist (guarded — skip if no D1 bound, never throw)
    if (env.DB) {
      try {
        await saveRun(env.DB, { run_id, route, source: usingFixture ? 'fixture' : sources.join('+'), program: state.program, ok: true });
        // Snapshot the raw state so future runs have a delta baseline one period back.
        await saveSnapshot(env.DB, { program: state.program, source: usingFixture ? 'fixture' : sources.join('+'), state });
        await saveRollup(env.DB, {
          program: state.program, generated_at: state.generated_at,
          readiness: analysis.metrics.readiness, momentum: analysis.metrics.momentum,
          html: body, json: { metrics: analysis.metrics, flags: analysis.flags, dependencyRoot: analysis.dependencyRoot },
        });
      } catch (err) { console.error('persist failed:', err?.message); }
    }
    return result;
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, { status: 405 }, cors);

    if (pathname === '/health') return json({ ok: true }, {}, cors);

    const dataRoute = pathname === '/rollup' || pathname === '/rollup.json' || pathname === '/reports' || pathname === '/report';
    if (dataRoute) {
      if (!authorized(request, env)) return json({ error: 'unauthorized' }, { status: 401 }, cors);
      const ip = request.headers.get('cf-connecting-ip') || 'anon';
      if (rateLimited(ip)) return json({ error: 'rate_limited' }, { status: 429 }, cors);
    }

    try {
      if (pathname === '/rollup' || pathname === '/rollup.json') {
        const sources = parseSources(searchParams);
        const cadence = validateCadence(searchParams.get('cadence'));
        const params = {
          project: searchParams.get('project') || undefined,
          team: searchParams.get('team') || undefined,
          owner: searchParams.get('owner') || undefined,
          repo: searchParams.get('repo') || undefined,
          channel: searchParams.get('channel') || undefined,
          spaceKey: searchParams.get('spaceKey') || undefined,
          database: searchParams.get('database') || undefined,
        };
        const { state, usingFixture, analysis, narrative, body } = await buildRollup(env, sources, params, pathname === '/rollup.json' ? 'rollup.json' : 'rollup', cadence);
        if (pathname === '/rollup.json') return json({ usingFixture, ...renderRollupJSON(state, analysis, narrative) }, {}, cors);
        const out = usingFixture ? body.replace(/(<body[^>]*>)/i, `$1${FIXTURE_BANNER}`) : body;
        return html(out, {}, cors);
      }

      if (pathname === '/reports') {
        const program = searchParams.get('program') || 'GS Space (KAN)';
        if (!env.DB) return json({ error: 'no_database', detail: 'bind D1 to enable reports' }, { status: 503 }, cors);
        const [reports, trend] = await Promise.all([listReports(env.DB, program, 20), readinessTrend(env.DB, program, 12)]);
        return html(renderReportsPage(program, reports, trend), {}, cors);
      }

      if (pathname === '/report') {
        if (!env.DB) return json({ error: 'no_database' }, { status: 503 }, cors);
        const row = await getReport(env.DB, searchParams.get('id'));
        if (!row || !row.html) return json({ error: 'not_found' }, { status: 404 }, cors);
        return html(row.html, {}, cors);
      }
    } catch (err) {
      // Generic message only — never leak secrets/internals to the client.
      console.error(`${pathname} failed:`, err?.message);
      const status = /invalid |unknown source|unknown cadence/.test(err?.message || '') ? 400 : 500;
      return json({ error: status === 400 ? 'bad_request' : 'internal_error' }, { status }, cors);
    }

    return json({ error: 'not_found', routes: ['/health', '/rollup', '/rollup.json', '/reports', '/report'] }, { status: 404 }, cors);
  },

  // Weekly cron: generate + store + deliver a rollup for the default program.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        // The active trigger is weekly (see wrangler.toml). To run a different
        // cadence, set OTTO_CADENCE and switch the cron there to match.
        const cadence = validateCadence(env.OTTO_CADENCE || 'weekly');
        const { body, state, analysis } = await buildRollup(env, ['jira'], { project: 'KAN' }, 'scheduled', cadence);
        await deliver({
          program: state.program, generated_at: state.generated_at,
          readiness: analysis.metrics.readiness, momentum: analysis.metrics.momentum, html: body,
        }, env);
      } catch (err) { console.error('scheduled run failed:', err?.message); }
    })());
  },
};
