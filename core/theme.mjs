// Otto — ONE shared design system. Every surface imports from here.
// Extracted from the landing page (autonomous-tpm-offer.html): warm cream + sunbeam
// yellow palette, Fraunces headings, Geist body. No per-file font/colour redefinition.
//
// export const THEME_HEAD -> Google Fonts <link> tags (Fraunces + Geist + Inter fallback)
// export const THEME_CSS  -> shared :root tokens + base + component classes

export const THEME_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Geist:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

export const THEME_CSS = `
:root{
  --bg:#faf6ea;            /* warm cream */
  --paper:#ffffff;
  --ink:#15140f;
  --muted:#6f6a5c;
  --line:#ece4d2;
  --yellow:#ffcb2d;        /* sunbeam yellow */
  --yellow-deep:#e7ad00;
  --soft:#fff3cf;          /* tinted fills */
  --good:#1f8a52;
  --warn:#c98a16;
  --red:#c0341d;
  --radius:18px;
  --shadow:0 1px 2px rgba(20,18,15,.04),0 14px 38px rgba(20,18,15,.07);
  font-synthesis:none;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:"Geist","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4,h5,.brand{font-family:"Fraunces","Geist",serif;letter-spacing:-.02em;font-optical-sizing:auto}
.wrap{max-width:960px;margin:0 auto;padding:32px 22px}

/* rollup card */
.card{background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.bar{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
.bar b{font-size:14px;font-family:"Fraunces","Geist",serif}
.ex{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#7a5c00;background:var(--soft);border:1px solid #f3df9e;padding:4px 10px;border-radius:999px}
.body{padding:22px}
h1{font-size:21px;letter-spacing:-.02em;margin:0 0 2px}
.meta{color:var(--muted);font-size:12.5px;margin-bottom:18px}

/* KPIs */
.kpis{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.kpi{flex:1;min-width:120px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .n{font-size:26px;font-weight:700;letter-spacing:-.02em;font-family:"Fraunces","Geist",serif}
.kpi .l{font-size:12px;color:var(--muted)}

/* table */
table{width:100%;border-collapse:collapse;margin:6px 0 18px;font-size:13.5px}
th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:9px 8px;border-bottom:1px solid var(--line)}
td.k{font-weight:700;color:#7a5c00;white-space:nowrap}

/* status badges */
.b{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
.b.green{background:#e6f4ec;color:var(--good)}
.b.amber{background:#fbf0d8;color:var(--warn)}
.b.red{background:#fdeae6;color:var(--red)}

/* flags */
.flag{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-top:1px dashed var(--line)}
.flag small{color:var(--muted)}

/* signals */
.signal{display:flex;gap:10px;align-items:flex-start;padding:11px 0;border-top:1px dashed var(--line);font-size:13.5px}
.signal .src{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#7a5c00;background:var(--soft);border:1px solid #f3df9e;padding:3px 9px;border-radius:999px;white-space:nowrap}
.signal a{color:var(--yellow-deep);font-weight:700;text-decoration:none}
.signal a:hover{text-decoration:underline}
.signal small{color:var(--muted)}

/* foot / altitude / headings */
.foot{margin-top:18px;padding:13px 15px;background:var(--soft);border:1px solid #f3df9e;border-radius:12px;font-size:13px;color:#7a5c00}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 4px}
.altitude{background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--yellow);border-radius:8px;padding:12px 14px;margin:8px 0;font-size:13.5px}
.altitude b{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-family:"Geist","Inter",sans-serif}
.foothint{color:var(--muted);font-size:11.5px;text-align:center;margin-top:16px}

/* Otto brand mark (the sun) — shared across rollup + reports */
.logo{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 50% 45%,#ffd84d,#ffb800);position:relative;box-shadow:0 0 0 4px rgba(255,203,45,.22);flex:0 0 auto}
.logo::after{content:"";position:absolute;inset:7px;border-radius:50%;background:#fff;opacity:.92}
.logo::before{content:"";position:absolute;inset:11px;border-radius:50%;background:radial-gradient(circle,#ffb800,#ff9e00)}
.brandrow{display:flex;align-items:center;gap:9px}
.brandrow .name{font-family:"Fraunces","Geist",serif;font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--ink)}
.brandrow .sub{color:var(--muted);font-size:12.5px;font-weight:600}
.brandfoot{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;color:var(--muted);font-size:12px}
.brandfoot .name{font-family:"Fraunces","Geist",serif;font-weight:700;color:var(--ink)}

/* readiness scorecard */
.scorecard{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:8px 0 4px}
.scorecard .grade{display:flex;align-items:baseline;gap:10px;margin-bottom:10px}
.scorecard .grade .g{font-family:"Fraunces","Geist",serif;font-size:22px;font-weight:700;letter-spacing:-.02em}
.scorecard .grade .s{color:var(--muted);font-size:13px;font-weight:600}
.gate{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;border-top:1px dashed var(--line)}
.gate:first-of-type{border-top:none}
.gate .mark{font-weight:800;width:16px;display:inline-block;text-align:center}
.gate .mark.ok{color:var(--good)}
.gate .mark.no{color:var(--red)}
.gate .gn{font-weight:600;min-width:96px}
.gate .gd{color:var(--muted);font-size:12px}
.epicscore{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;border-top:1px dashed var(--line)}
.epicscore .k{font-weight:700;color:#7a5c00;white-space:nowrap}
.epicscore .mini{color:var(--muted);font-size:12px}
.epicscore .gates{margin-left:auto;letter-spacing:1px;font-size:11px;white-space:nowrap}

/* dependency map */
.depmap{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:8px 0 4px;font-size:13px}
.depmap .row{padding:7px 0;border-top:1px dashed var(--line)}
.depmap .row:first-child{border-top:none}
.depmap .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin-bottom:4px}
.chain{font-family:"Geist","Inter",sans-serif;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.chain .node{background:var(--soft);border:1px solid #f3df9e;border-radius:8px;padding:2px 8px;font-weight:600;font-size:12px;color:#7a5c00}
.chain .arrow{color:var(--muted);font-weight:700}
.chain.crit .node{background:#fdeae6;border-color:#f4c6bb;color:var(--red)}
.depmap .infnote{color:var(--warn);font-size:12.5px}

/* redesign: two-column body + answer strip + collapsible depth */
.grid2{display:grid;grid-template-columns:300px 1fr;gap:24px}
@media(max-width:720px){.grid2{grid-template-columns:1fr}}
.answerstrip{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0 20px}
@media(max-width:720px){.answerstrip{grid-template-columns:1fr}}
.answer{background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--yellow);border-radius:10px;padding:12px 14px}
.answer .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin-bottom:5px}
.answer .v{font-size:13.5px}
.answer .v b{font-family:"Fraunces","Geist",serif}
.pill{display:inline-block;font-size:12px;font-weight:800;padding:4px 12px;border-radius:999px;white-space:nowrap;vertical-align:middle}
.pill.green{background:#e6f4ec;color:var(--good)}
.pill.amber{background:#fbf0d8;color:var(--warn)}
.pill.red{background:#fdeae6;color:var(--red)}
.pill.muted{background:var(--soft);color:#7a5c00;border:1px solid #f3df9e}
.hero{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 4px}
.col-left>h3:first-child,.col-right>h3:first-child{margin-top:0}
details{margin:14px 0;border-top:1px dashed var(--line);padding-top:10px}
summary{cursor:pointer;font-weight:700;font-size:13px}
`;
