// core/validate_input.mjs
// Centralized input validation + SSRF host allow-listing for all connectors.
// Every attacker-influenceable parameter (project, owner, repo, channel,
// spaceKey, databaseId, baseUrl) MUST pass through one of these before it is
// interpolated into a URL, JQL string, or GraphQL variable.
//
// Design rules:
//  - Allow-list, don't sanitize. Reject anything that doesn't match a tight regex.
//  - Never let an attacker-controlled `baseUrl` point the Worker at an arbitrary
//    host: only *.atlassian.net (plus the fixed api.atlassian.com gateway) are
//    permitted, so a bearer token can never be POSTed to evil.example.com.
//  - All errors are generic ("invalid <field>") — they never echo a secret.
//
// Zero deps. Pure functions. Throw on invalid input.

// ---------------------------------------------------------------------------
// Identifier patterns (tight allow-lists).
// ---------------------------------------------------------------------------

// Jira/Confluence project & space keys: start with a letter, then letters/
// digits/underscore. e.g. "KAN", "ENG", "A1_B".
export const PROJECT_KEY_RX = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// Linear team key or short name. Letters, digits, dash, underscore, space.
export const TEAM_KEY_RX = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

// GitHub owner (user/org): alphanumeric + single hyphens, 1-39 chars.
export const GH_OWNER_RX = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

// GitHub repo name: letters, digits, ., _, - up to 100 chars.
export const GH_REPO_RX = /^[A-Za-z0-9._-]{1,100}$/;

// Slack channel ID, e.g. "C0123ABCD" (also allow group/DM prefixes G/D).
export const SLACK_CHANNEL_RX = /^[CGD][A-Z0-9]{6,20}$/;

// Notion database id: 32 hex chars, optionally dash-grouped (UUID form).
export const NOTION_ID_RX = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F-]{36}$/;

// Hosts we will ever issue an authenticated request to. Anything else is an
// SSRF attempt and is refused. Atlassian *site* hosts are matched by suffix.
export const ALLOWED_API_HOSTS = new Set([
  "api.atlassian.com",
  "api.linear.app",
  "api.github.com",
  "slack.com",
  "api.notion.com",
]);
const ALLOWED_HOST_SUFFIXES = [".atlassian.net"];

// ---------------------------------------------------------------------------
// Field validators — return the (trimmed) value or throw a generic error.
// ---------------------------------------------------------------------------

function check(value, rx, field) {
  if (typeof value !== "string" || !rx.test(value.trim())) {
    throw new Error(`invalid ${field}`);
  }
  return value.trim();
}

export const validateProjectKey = (v) => check(v, PROJECT_KEY_RX, "project");
export const validateSpaceKey = (v) => check(v, PROJECT_KEY_RX, "spaceKey");
export const validateTeamKey = (v) => check(v, TEAM_KEY_RX, "team");
export const validateOwner = (v) => check(v, GH_OWNER_RX, "owner");
export const validateRepo = (v) => check(v, GH_REPO_RX, "repo");
export const validateChannel = (v) => check(v, SLACK_CHANNEL_RX, "channel");
export const validateDatabaseId = (v) => check(v, NOTION_ID_RX, "databaseId");

/** Clamp a numeric limit/page size into [1, max] (defaults if absent/invalid). */
export function validateLimit(v, { def = 100, max = 250 } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// SSRF guard — validate an attacker-influenceable baseUrl.
// ---------------------------------------------------------------------------

/** True if `host` is on the allow-list (exact or by trusted suffix). */
export function isAllowedHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (ALLOWED_API_HOSTS.has(h)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Validate a base URL the Worker is about to fetch with credentials attached.
 * Enforces: parseable, https only, and host on the allow-list. Returns the
 * normalized origin (no trailing slash). Throws a generic error otherwise so a
 * crafted baseUrl can never redirect a bearer token to an arbitrary host.
 */
export function validateBaseUrl(baseUrl, field = "baseUrl") {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new Error(`invalid ${field}`);
  }
  if (u.protocol !== "https:") throw new Error(`invalid ${field}: https required`);
  if (!isAllowedHost(u.host)) throw new Error(`invalid ${field}: host not allowed`);
  return u.origin;
}
