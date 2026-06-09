// otto/reporting/delivery.mjs
// Fan-out delivery of a generated rollup. Graceful no-op when nothing is
// configured. NEVER throws (failures are logged as structured spans, not raised)
// and NEVER logs secrets (webhook URLs, html bodies, tokens).
//
// Channels (both optional, both keyed off env):
//   env.SLACK_WEBHOOK_URL    -> POST a short Slack block summary
//   env.REPORT_EMAIL_WEBHOOK -> POST the rendered html (Resend-style webhook)
//
// Export: deliver(rollup, env) -> { slack, email } status object.

// A delivered rollup looks like saveRollup's input:
//   { program, generated_at, readiness, momentum, html, json, id?, url? }

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  // Stored either as 0..1 or 0..100; normalize to a whole-number percent.
  const whole = n <= 1 ? n * 100 : n;
  return `${Math.round(whole)}%`;
}

function topFlags(rollup, max = 3) {
  const json = rollup?.json;
  const obj = typeof json === "string" ? safeParse(json) : json;
  const flags = (obj && obj.flags) || [];
  return flags.slice(0, max).map((f) => `• *${f.level || ""}* ${f.title || ""}`).join("\n");
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function slackPayload(rollup) {
  const program = rollup?.program || "Program";
  const when = rollup?.generated_at || "";
  const flags = topFlags(rollup);
  const header = `Otto rollup — ${program}`;
  const summary =
    `*Readiness* ${pct(rollup?.readiness)}  ·  *Momentum* ${pct(rollup?.momentum)}` +
    (when ? `  ·  ${when}` : "");
  const blocks = [
    { type: "header", text: { type: "plain_text", text: header } },
    { type: "section", text: { type: "mrkdwn", text: summary } },
  ];
  if (flags) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: flags } });
  }
  if (rollup?.url) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<${rollup.url}|Open full rollup>` }],
    });
  }
  // text is the fallback for notifications / clients without block support.
  return { text: `${header}: readiness ${pct(rollup?.readiness)}`, blocks };
}

function emailPayload(rollup) {
  const program = rollup?.program || "Program";
  const when = rollup?.generated_at || "";
  return {
    subject: `Otto rollup — ${program}${when ? " · " + when : ""}`,
    html: rollup?.html || "",
    // Resend-style webhooks usually want a plain summary too.
    text: `Readiness ${pct(rollup?.readiness)} · Momentum ${pct(rollup?.momentum)}`,
  };
}

// Structured log — no URLs, no bodies, just channel + outcome.
function logResult(channel, ok, status) {
  try {
    console.log(JSON.stringify({ ev: "delivery", channel, ok, status: status ?? null }));
  } catch {
    /* never throw from logging */
  }
}

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}

/**
 * Deliver a rollup to every configured channel. Returns a status object;
 * each channel is "skipped" (not configured), "sent", or "failed".
 * Never throws.
 */
export async function deliver(rollup, env = {}) {
  const result = { slack: "skipped", email: "skipped" };

  // Slack
  if (env.SLACK_WEBHOOK_URL) {
    try {
      const res = await post(env.SLACK_WEBHOOK_URL, slackPayload(rollup));
      result.slack = res.ok ? "sent" : "failed";
      logResult("slack", res.ok, res.status);
    } catch (err) {
      result.slack = "failed";
      logResult("slack", false, err && err.name ? err.name : "Error");
    }
  }

  // Email webhook
  if (env.REPORT_EMAIL_WEBHOOK) {
    try {
      const res = await post(env.REPORT_EMAIL_WEBHOOK, emailPayload(rollup));
      result.email = res.ok ? "sent" : "failed";
      logResult("email", res.ok, res.status);
    } catch (err) {
      result.email = "failed";
      logResult("email", false, err && err.name ? err.name : "Error");
    }
  }

  return result;
}
