// otto/reporting/report.mjs
// History / dashboard page for a program's past rollups. Pure render, no I/O.
// Uses the ONE shared design system (THEME_HEAD + THEME_CSS) — Fraunces headings,
// Geist body, cream/yellow palette — so it matches engine/render.mjs exactly.
// No external chart libs: the readiness trend is an inline SVG.
//
// Export: renderReportsPage(program, reports, trend) -> string (full HTML doc)
//   reports: [{ id, generated_at, readiness, momentum }]  (newest-first)
//   trend:   [{ generated_at, readiness, momentum }]       (oldest-first)

import { THEME_HEAD, THEME_CSS } from "../core/theme.mjs";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Normalize a metric to a whole-number percent. Accepts 0..1 or 0..100.
function pctNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n <= 1 ? n * 100 : n);
}

function pctLabel(v) {
  const n = pctNum(v);
  return n == null ? "—" : `${n}%`;
}

// Momentum/readiness → a status badge level (cosmetic, mirrors rollup tone).
function level(readiness) {
  const n = pctNum(readiness);
  if (n == null) return "amber";
  if (n >= 70) return "green";
  if (n >= 30) return "amber";
  return "red";
}

/**
 * Inline SVG bar-chart sparkline of readiness (filled) + momentum (outline)
 * over time. Pure SVG, no scripts, no external libs. Scales to 0..100.
 */
function trendSvg(trend) {
  const pts = (trend || [])
    .map((t) => ({
      r: pctNum(t.readiness),
      m: pctNum(t.momentum),
      d: t.generated_at || "",
    }))
    .filter((t) => t.r != null || t.m != null);

  if (pts.length === 0) {
    return `<div class="meta">No history yet — generate a rollup to start the trend.</div>`;
  }

  const W = 680,
    H = 140,
    pad = 18,
    n = pts.length;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const slot = innerW / n;
  const barW = Math.max(6, Math.min(34, slot * 0.5));

  const y = (p) => pad + innerH - (Math.max(0, Math.min(100, p || 0)) / 100) * innerH;

  // gridlines at 0/50/100
  const grid = [0, 50, 100]
    .map((g) => {
      const gy = y(g);
      return (
        `<line x1="${pad}" y1="${gy.toFixed(1)}" x2="${W - pad}" y2="${gy.toFixed(1)}" ` +
        `stroke="var(--line)" stroke-width="1"/>` +
        `<text x="${pad - 4}" y="${(gy + 3).toFixed(1)}" text-anchor="end" ` +
        `font-size="9" fill="var(--muted)" font-family="Geist,Inter,sans-serif">${g}</text>`
      );
    })
    .join("");

  const bars = pts
    .map((t, i) => {
      const cx = pad + slot * i + slot / 2;
      const x = cx - barW / 2;
      const rTop = y(t.r);
      const mTop = y(t.m);
      const base = y(0);
      const readinessBar =
        t.r == null
          ? ""
          : `<rect x="${x.toFixed(1)}" y="${rTop.toFixed(1)}" width="${barW.toFixed(1)}" ` +
            `height="${(base - rTop).toFixed(1)}" rx="3" fill="var(--yellow)"><title>${esc(
              t.d
            )} · readiness ${t.r}%</title></rect>`;
      // momentum drawn as a thin marker line on top of the bar slot
      const momentumMark =
        t.m == null
          ? ""
          : `<line x1="${(x - 1).toFixed(1)}" y1="${mTop.toFixed(1)}" x2="${(
              x +
              barW +
              1
            ).toFixed(1)}" y2="${mTop.toFixed(1)}" stroke="var(--yellow-deep)" ` +
            `stroke-width="2"><title>${esc(t.d)} · momentum ${t.m}%</title></line>`;
      return readinessBar + momentumMark;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" ` +
    `aria-label="Readiness and momentum trend over time" ` +
    `xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%">` +
    `${grid}${bars}</svg>` +
    `<div class="meta" style="display:flex;gap:14px;margin-top:8px">` +
    `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;` +
    `background:var(--yellow);vertical-align:middle"></span> Readiness</span>` +
    `<span><span style="display:inline-block;width:14px;height:2px;` +
    `background:var(--yellow-deep);vertical-align:middle"></span> Momentum</span></div>`
  );
}

function reportRows(reports) {
  if (!reports || reports.length === 0) {
    return `<tr><td colspan="4" class="meta" style="padding:14px 8px">No rollups stored yet.</td></tr>`;
  }
  return reports
    .map((r) => {
      const lvl = level(r.readiness);
      const id = encodeURIComponent(String(r.id));
      return (
        `<tr>` +
        `<td class="k">${esc(r.generated_at)}</td>` +
        `<td><span class="b ${lvl}">${pctLabel(r.readiness)}</span></td>` +
        `<td>${pctLabel(r.momentum)}</td>` +
        `<td><a href="/report?id=${id}" style="color:var(--yellow-deep);font-weight:700;text-decoration:none">Open →</a></td>` +
        `</tr>`
      );
    })
    .join("\n");
}

export function renderReportsPage(program, reports, trend) {
  const prog = esc(program || "Program");
  const count = (reports || []).length;
  const latest = (reports || [])[0];

  const kpis = latest
    ? `<div class="kpis">
  <div class="kpi"><div class="n">${pctLabel(latest.readiness)}</div><div class="l">Latest readiness</div></div>
  <div class="kpi"><div class="n">${pctLabel(latest.momentum)}</div><div class="l">Latest momentum</div></div>
  <div class="kpi"><div class="n">${count}</div><div class="l">Rollups on record</div></div>
</div>`
    : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Otto Reports — ${prog}</title>
${THEME_HEAD}
<style>${THEME_CSS}</style></head><body><div class="wrap"><div class="card">
<div class="bar"><b>Otto · Program Reports</b><span class="ex">History</span></div>
<div class="body">
<h1>${prog} · readiness over time</h1>
<div class="meta">${count} rollup${count === 1 ? "" : "s"} on record · newest first</div>
${kpis}
<h3>Readiness trend</h3>
${trendSvg(trend)}
<h3>Past rollups</h3>
<table><thead><tr><th>Date</th><th>Readiness</th><th>Momentum</th><th>Report</th></tr></thead><tbody>
${reportRows(reports)}
</tbody></table>
<div class="foothint">Generated by Otto · reporting layer · stored in D1</div>
</div></div></div></body></html>`;
}
