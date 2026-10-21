/**
 * The HTML report: one self-contained static file (inline CSS and JS, no
 * framework, works offline) with screenshots in a folder next to it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { ContrastFinding, DriftFinding, Report, TokenUsage } from "../audit/types.js";

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Only colors we produced ourselves reach inline styles; this guards anyway. */
const safeColor = (c: string): string => (/^#[0-9A-Fa-f]{6,8}$/.test(c) ? c : "#000000");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function sample(fg: string, bg: string, label: string, caption: string): string {
  return `<figure class="sample"><div class="sample-box" style="color:${safeColor(fg)};background:${safeColor(bg)}">${esc(label)}</div><figcaption>${caption}</figcaption></figure>`;
}

function chip(text: string, cls = ""): string {
  return `<span class="chip ${cls}">${esc(text)}</span>`;
}

function contrastCard(f: ContrastFinding, shot: (p: string) => string): string {
  const s = f.suggestion;
  const before = sample(
    f.foreground,
    f.background.worst,
    "Aa",
    `now <b>${f.wcag.ratio.toFixed(2)}:1</b>`,
  );
  let after = "";
  if (s) {
    const fg = s.target === "foreground" ? s.value : f.foreground;
    const bg = s.target === "background" ? s.value : (s.against ?? f.background.worst);
    after = sample(
      fg,
      bg,
      "Aa",
      `with ${esc(s.token ?? s.value)} <b>${s.ratio?.toFixed(2) ?? "?"}:1</b>`,
    );
  }
  const axeClass = f.axeVerdict === "fail" ? "axe-agree" : "axe-miss";
  const search = [f.page, f.selector, f.text, f.foreground, f.background.worst, s?.token]
    .join(" ")
    .toLowerCase();
  return `<article class="finding" data-type="contrast" data-severity="${esc(f.severity)}" data-scheme="${esc(f.scheme)}" data-viewport="${f.viewport}" data-page="${esc(f.page)}" data-axe="${esc(f.axeVerdict)}" data-search="${esc(search)}">
  ${f.screenshot ? `<a class="shot" href="${esc(shot(f.screenshot))}"><img loading="lazy" src="${esc(shot(f.screenshot))}" alt="Screenshot of ${esc(f.selector)}"></a>` : ""}
  <div class="body">
    <header>
      <span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span>
      <span class="ratio">${f.wcag.ratio.toFixed(2)}:1</span>
      <span class="muted">needs ${f.wcag.required}:1 · APCA Lc ${f.apca.lc} (needs ${f.apca.required})</span>
      <span class="axe ${axeClass}">axe: ${esc(f.axeVerdict)}</span>
    </header>
    <p class="quote">“${esc(f.text)}”</p>
    <code class="selector">${esc(f.selector)}</code>
    <div class="chips">
      ${chip(f.page)}${chip(`${f.viewport}px`)}${chip(f.scheme)}${chip(`${f.background.kind} background`)}${chip(`${f.fontSizePx}px / ${f.fontWeight}${f.largeText ? " · large" : ""}`)}${chip(`${f.background.sampled} px sampled`)}
      ${f.alsoOn?.length ? chip(`also on ${plural(f.alsoOn.length, "page")}`) : ""}
    </div>
    <div class="samples">${before}${after ? `<span class="arrow" aria-hidden="true">→</span>${after}` : ""}</div>
    <p class="colors">text <code>${esc(f.foreground)}</code> on worst background <code>${esc(f.background.worst)}</code> · median <code>${esc(f.background.median)}</code> · min ${f.wcag.min.toFixed(2)}:1 · median ${f.wcag.median.toFixed(2)}:1</p>
    ${s?.replacement ? `<p class="fix">Fix: <code>${esc(s.replacement)}</code></p>` : s === null ? `<p class="fix none">No token passes against this background.</p>` : ""}
    ${f.notes?.length ? `<ul class="notes">${f.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  </div>
</article>`;
}

function driftCard(f: DriftFinding): string {
  const near = f.nearestToken;
  const search = [f.page, f.color, f.property, f.source?.rule, ...f.selectors, near?.name]
    .join(" ")
    .toLowerCase();
  return `<article class="finding" data-type="drift" data-severity="${esc(f.severity)}" data-scheme="${esc(f.schemes.join(" "))}" data-viewport="${esc(f.viewports.join(" "))}" data-page="${esc(f.page)}" data-search="${esc(search)}">
  <div class="drift-swatches">
    <div class="swatch" style="background:${safeColor(f.color)}" title="${esc(f.color)}"></div>
    ${near ? `<div class="swatch" style="background:${safeColor(near.value.slice(0, 7))}" title="${esc(near.name)}"></div>` : ""}
  </div>
  <div class="body">
    <header>
      <span class="sev sev-${esc(f.severity)}">${esc(f.severity)}</span>
      <span class="ratio">${esc(f.color)}</span>
      <span class="muted">${esc(f.property)} · ×${f.occurrences}</span>
      ${f.likelyTypo ? `<span class="axe axe-miss">likely typo</span>` : ""}
    </header>
    <p>${near ? `ΔE ${near.deltaE.toFixed(2)} from <code>${esc(near.name)}</code> <code>${esc(near.value)}</code>` : "No tokens to compare with"}</p>
    ${f.source ? `<code class="selector">${esc(f.source.rule)}</code><p class="muted">${esc(f.source.stylesheet ?? "")}${f.source.line ? `:${f.source.line}` : ""}</p>` : ""}
    <div class="chips">${chip(f.page)}${chip(`${f.viewports.join(", ")}px`)}${chip(f.schemes.join(", "))}${f.alsoOn?.length ? chip(`also on ${plural(f.alsoOn.length, "page")}`) : ""}</div>
    ${f.cause?.length ? `<p class="muted">Rendered differently because: ${esc(f.cause.join("; "))}</p>` : ""}
    <details><summary>${plural(f.selectors.length, "element")}</summary><ul class="notes">${f.selectors.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ul></details>
    ${f.suggestion?.replacement ? `<p class="fix">Fix: <code>${esc(f.suggestion.replacement)}</code></p>` : ""}
  </div>
</article>`;
}

function palette(usage: TokenUsage[]): string {
  if (!usage.length) return "";
  const tiles = usage
    .map((t) => {
      const state = t.drifted ? "drifted" : t.used ? "used" : "unused";
      const label = t.drifted
        ? `${t.used} used · ${t.drifted} drifted`
        : t.used
          ? `${plural(t.used, "use")}`
          : "unused";
      return `<li class="token ${state}"><span class="swatch" style="background:${safeColor(t.value.slice(0, 7))}"></span><span class="tname">${esc(t.name)}</span><code>${esc(t.value)}</code><span class="tstate">${esc(label)}</span></li>`;
    })
    .join("");
  const used = usage.filter((t) => t.used).length;
  const drifted = usage.filter((t) => t.drifted).length;
  return `<section id="tokens"><h2>Token palette</h2><p class="muted">${used} of ${usage.length} tokens used · ${plural(drifted, "token")} with near-miss copies · ${usage.length - used} unused</p><ul class="palette">${tiles}</ul></section>`;
}

const CSS = `
:root{--bg:#f8fafc;--panel:#ffffff;--text:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#7c3aed;--err:#b91c1c;--errbg:#fee2e2;--warn:#92400e;--warnbg:#fef3c7;--info:#1e40af;--infobg:#dbeafe;--chip:#f1f5f9;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0b1020;--panel:#121a2e;--text:#e2e8f0;--muted:#94a3b8;--line:#24304a;--accent:#a78bfa;--err:#fca5a5;--errbg:#450a0a;--warn:#fcd34d;--warnbg:#422006;--info:#93c5fd;--infobg:#172554;--chip:#1e293b;color-scheme:dark}}
:root[data-theme=dark]{--bg:#0b1020;--panel:#121a2e;--text:#e2e8f0;--muted:#94a3b8;--line:#24304a;--accent:#a78bfa;--err:#fca5a5;--errbg:#450a0a;--warn:#fcd34d;--warnbg:#422006;--info:#93c5fd;--infobg:#172554;--chip:#1e293b;color-scheme:dark}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:24px;margin:8px 0 4px}h2{font-size:18px;margin:32px 0 8px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.muted{color:var(--muted)}
.top{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
button,select,input{font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 10px;min-height:36px}
button{cursor:pointer}button[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.headline{margin:16px 0;padding:16px;border-radius:12px;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent)}
.headline strong{font-size:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
.card .n{font-size:28px;font-weight:700;display:block}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:16px 0;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
.filters input{flex:1 1 180px;min-width:0}
.finding{display:flex;gap:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}
.finding[hidden]{display:none}
.finding .body{flex:1;min-width:0}
.finding header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.shot{flex:0 0 280px;max-width:280px}.shot img{width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block;background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/12px 12px}
.ratio{font-size:20px;font-weight:700}
.sev{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
.sev-error{color:var(--err);background:var(--errbg)}.sev-warning{color:var(--warn);background:var(--warnbg)}.sev-info{color:var(--info);background:var(--infobg)}
.axe{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--chip)}.axe-miss{color:var(--accent);font-weight:700}
.quote{margin:6px 0;font-style:italic}
.selector{display:block;padding:6px 8px;border-radius:6px;background:var(--chip);margin:6px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.chip{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--muted);overflow-wrap:anywhere}
.samples{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:8px 0}
.sample{margin:0;text-align:center}.sample-box{width:96px;height:56px;border-radius:8px;display:grid;place-items:center;font-size:24px;font-weight:600;border:1px solid var(--line)}
.sample figcaption{font-size:12px;color:var(--muted);margin-top:4px}
.arrow{font-size:20px;color:var(--muted)}
.fix code{background:var(--chip);padding:2px 6px;border-radius:6px}.fix.none{color:var(--muted)}
.notes{margin:6px 0;padding-left:18px;color:var(--muted)}
.drift-swatches{display:flex;flex-direction:column;gap:6px}
.swatch{width:48px;height:48px;border-radius:8px;border:1px solid var(--line);display:inline-block}
.palette{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.token{display:grid;grid-template-columns:36px 1fr;grid-template-rows:auto auto auto;column-gap:8px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px}
.token .swatch{width:36px;height:36px;grid-row:1/4}.token .tname{font-weight:600;overflow-wrap:anywhere}.token .tstate{font-size:12px;color:var(--muted)}
.token.unused{opacity:.55}.token.drifted{border-color:var(--warn)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:block;overflow-x:auto}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);font-size:13px;white-space:nowrap}
footer{margin:32px 0 16px;color:var(--muted);font-size:13px}
.empty{padding:24px;text-align:center;color:var(--muted);background:var(--panel);border:1px dashed var(--line);border-radius:12px}
@media (max-width:720px){.finding{flex-direction:column}.shot{flex:none;max-width:100%}main{padding:12px}}
`;

const JS = `
(function(){
  var root=document.documentElement;
  var key="rugby-theme";
  try{var saved=localStorage.getItem(key);if(saved==="light"||saved==="dark")root.setAttribute("data-theme",saved);}catch(e){}
  var themeBtn=document.getElementById("theme");
  if(themeBtn)themeBtn.addEventListener("click",function(){
    var dark=root.getAttribute("data-theme")==="dark"||(!root.getAttribute("data-theme")&&window.matchMedia("(prefers-color-scheme: dark)").matches);
    var next=dark?"light":"dark";root.setAttribute("data-theme",next);
    try{localStorage.setItem(key,next);}catch(e){}
  });
  var state={type:"all"};
  var items=Array.prototype.slice.call(document.querySelectorAll(".finding"));
  var count=document.getElementById("count");
  function val(id){var el=document.getElementById(id);return el?el.value:"";}
  function apply(){
    var sev=val("f-severity"),scheme=val("f-scheme"),vp=val("f-viewport"),page=val("f-page"),q=val("f-search").toLowerCase().trim(),axe=val("f-axe");
    var shown=0;
    items.forEach(function(el){
      var d=el.dataset;
      var ok=(state.type==="all"||d.type===state.type)&&(!sev||d.severity===sev)&&(!scheme||(" "+d.scheme+" ").indexOf(" "+scheme+" ")>=0)&&(!vp||(" "+d.viewport+" ").indexOf(" "+vp+" ")>=0)&&(!page||d.page===page)&&(!q||d.search.indexOf(q)>=0)&&(!axe||(axe==="missed"?d.type==="contrast"&&d.axe!=="fail":d.axe===axe));
      el.hidden=!ok;if(ok)shown++;
    });
    if(count)count.textContent=shown+" of "+items.length+" shown";
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-filter-type]"),function(b){
    b.addEventListener("click",function(){state.type=b.getAttribute("data-filter-type");
      Array.prototype.forEach.call(document.querySelectorAll("[data-filter-type]"),function(o){o.setAttribute("aria-pressed",String(o===b));});apply();});
  });
  ["f-severity","f-scheme","f-viewport","f-page","f-search","f-axe"].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener("input",apply);});
  apply();
})();
`;

export interface HtmlOptions {
  /** Map a report screenshot path to the URL used in the page. */
  shotUrl?: (path: string) => string;
}

export function renderHtml(report: Report, options: HtmlOptions = {}): string {
  const shot = options.shotUrl ?? ((p: string) => p);
  const contrast = report.findings.filter((f): f is ContrastFinding => f.type === "contrast");
  const drift = report.findings.filter((f): f is DriftFinding => f.type === "drift");
  const s = report.summary;
  const typos = drift.filter((f) => f.likelyTypo).length;
  const pages = [...new Set(report.pages.map((p) => p.url))];
  const options_ = (values: (string | number)[], all: string) =>
    `<option value="">${esc(all)}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
  const findingsHtml = [
    ...contrast.map((f) => contrastCard(f, shot)),
    ...drift.map(driftCard),
  ].join("\n");
  const pageRows = report.pages
    .map(
      (p) =>
        `<tr><td>${esc(p.url)}</td><td>${p.viewport}</td><td>${esc(p.scheme)}</td><td>${p.status === "ok" ? "ok" : `error: ${esc(p.error)}`}</td><td>${p.stats.textChecked}</td><td>${p.stats.contrastFailures}</td><td>${p.stats.axe.incomplete}</td><td>${p.stats.axeMissed}</td><td>${esc(p.notes.join("; "))}</td></tr>`,
    )
    .join("");
  const tokenLine = report.tokens
    ? `${esc(report.tokens.count)} tokens (${esc(report.tokens.format)}) from ${esc(report.tokens.source)}`
    : "no design tokens";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RuGBy report</title>
<style>${CSS}</style>
</head>
<body>
<main>
<div class="top">
  <div>
    <h1>RuGBy report</h1>
    <p class="muted">${plural(s.pages, "page")} · ${report.options.viewports.join(", ")}px · ${esc(report.options.schemes.join(", "))} · ${esc(report.options.standard)} ${esc(report.options.level)} · ${tokenLine}</p>
  </div>
  <button id="theme" type="button" aria-label="Toggle light or dark theme">Theme</button>
</div>
<section class="headline" aria-label="axe comparison">
  <strong>axe missed ${plural(s.axe.missed, "issue")} that RuGBy caught.</strong>
  <p class="muted">axe-core left ${plural(s.axe.incomplete, "contrast check")} incomplete; RuGBy measured ${s.axe.incompleteResolved} of them from real pixels and found ${s.axe.incompleteFailed} real failures.</p>
</section>
<section class="cards" aria-label="Summary">
  <div class="card"><span class="n">${s.findings.contrast.error}</span>contrast errors</div>
  <div class="card"><span class="n">${s.findings.contrast.warning}</span>contrast warnings</div>
  <div class="card"><span class="n">${drift.length}</span>off-token colors</div>
  <div class="card"><span class="n">${typos}</span>likely typos</div>
  <div class="card"><span class="n">${s.textChecked}</span>text elements measured</div>
  <div class="card"><span class="n">${s.states}</span>page states (page × viewport × scheme)</div>
</section>
<h2 id="findings">Findings</h2>
${
  findingsHtml
    ? `<div class="filters" role="group" aria-label="Filter findings">
  <button type="button" data-filter-type="all" aria-pressed="true">All</button>
  <button type="button" data-filter-type="contrast" aria-pressed="false">Contrast</button>
  <button type="button" data-filter-type="drift" aria-pressed="false">Drift</button>
  <select id="f-severity" aria-label="Severity">${options_(["error", "warning", "info"], "Any severity")}</select>
  <select id="f-axe" aria-label="axe verdict"><option value="">Any axe verdict</option><option value="missed">axe missed</option><option value="incomplete">axe incomplete</option><option value="fail">axe also failed</option></select>
  <select id="f-scheme" aria-label="Color scheme">${options_(report.options.schemes, "Any scheme")}</select>
  <select id="f-viewport" aria-label="Viewport">${options_(report.options.viewports, "Any viewport")}</select>
  <select id="f-page" aria-label="Page">${options_(pages, "Any page")}</select>
  <input id="f-search" type="search" placeholder="Search selector, text, color" aria-label="Search">
  <span id="count" class="muted"></span>
</div>
${findingsHtml}`
    : `<p class="empty">No contrast or drift findings. ${plural(s.textChecked, "text element")} measured.</p>`
}
${palette(report.tokenUsage ?? [])}
<h2>Pages</h2>
<table><thead><tr><th>Page</th><th>Viewport</th><th>Scheme</th><th>Status</th><th>Text</th><th>Failures</th><th>axe incomplete</th><th>axe missed</th><th>Notes</th></tr></thead><tbody>${pageRows}</tbody></table>
<footer>Generated by RuGBy ${esc(report.tool.version)}${report.generatedAt ? ` on ${esc(report.generatedAt)}` : ""}. Contrast is the 5th-percentile WCAG ratio over every background pixel under each line of text.</footer>
</main>
<script>${JS}</script>
</body>
</html>
`;
}

/** Write `index.html` (or the given path) plus `report.json` next to it. */
export async function writeHtmlReport(
  report: Report,
  htmlPath: string,
  cwd = process.cwd(),
): Promise<void> {
  const target = resolve(cwd, htmlPath);
  const dir = dirname(target);
  await mkdir(dir, { recursive: true });
  const html = renderHtml(report, {
    shotUrl: (p) => relative(dir, resolve(cwd, p)).split("\\").join("/"),
  });
  await writeFile(target, html);
  await writeFile(resolve(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
