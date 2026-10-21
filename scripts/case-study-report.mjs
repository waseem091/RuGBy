/**
 * Render docs/case-studies.md from docs/case-studies/data.json (produced in CI by
 * scripts/case-study-digest.mjs) and docs/case-studies/review.json (manual
 * true/false-positive labels for the precision sample). Every number in the
 * document comes from those two files.
 *   node scripts/case-study-report.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("docs/case-studies/data.json", "utf8"));
const review = existsSync("docs/case-studies/review.json")
  ? JSON.parse(readFileSync("docs/case-studies/review.json", "utf8"))
  : { labels: {} };
const notes = review.siteNotes ?? {};

const ok = data.sites.filter((s) => s.status === "ok");
const sum = (f) => ok.reduce((n, s) => n + f(s), 0);
const incomplete = sum((s) => s.summary.axe.incomplete);
const resolved = sum((s) => s.summary.axe.incompleteResolved);
const failed = sum((s) => s.summary.axe.incompleteFailed);
const missed = sum((s) => s.summary.axe.missed);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const esc = (t) =>
  String(t ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
const short = (t, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const lines = [];
lines.push("# Case studies: RuGBy on public sites", "");
lines.push(
  `${review.intro ?? ""}`.trim(),
  "",
  `**Across ${ok.length} sites, axe-core left ${incomplete} contrast checks incomplete; RuGBy resolved ${resolved} of them, and ${failed} were real failures.** RuGBy also found ${missed} contrast failures that axe passed, left incomplete, or did not check.`,
  "",
  "## How these numbers were produced",
  "",
  "- Each site: the home page plus one content page, at 375px and 1440px, in light and dark (`prefers-color-scheme`), so 8 page states per site.",
  "- Read-only page loads from a GitHub-hosted runner (`.github/workflows/case-studies.yml`), at most one page every 2 seconds per host. No logins, no forms, no interaction beyond scrolling once for lazy content. Common cookie banners were hidden.",
  "- No site publishes its design tokens, so drift is measured against each page's own `:root` custom properties. That makes the drift column a weaker signal than with a real token file.",
  "- Contrast verdicts are WCAG 2.x AA (5th-percentile ratio over every background pixel under each line of text). The axe-core verdict is for the same element on the same page state.",
  "- Raw per-site digests are in [`docs/case-studies/data.json`](case-studies/data.json); the precision labels are in [`docs/case-studies/review.json`](case-studies/review.json).",
  "",
  "## Summary",
  "",
  "| Site | Text measured | Contrast findings | axe incomplete | …resolved by RuGBy | …real failures | axe missed | Off-token colors |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
);
for (const s of data.sites) {
  if (s.status !== "ok") {
    lines.push(
      `| ${esc(s.name)} | — | — | — | — | — | — | not audited: ${esc(s.error ?? s.pageErrors?.[0]?.error ?? s.status)} |`,
    );
    continue;
  }
  const a = s.summary.axe;
  lines.push(
    `| ${esc(s.name)} | ${s.summary.textChecked} | ${s.counts.contrast} | ${a.incomplete} | ${a.incompleteResolved} | ${a.incompleteFailed} | ${a.missed} | ${s.counts.drift} |`,
  );
}
lines.push(
  `| **Total** | **${sum((s) => s.summary.textChecked)}** | **${sum((s) => s.counts.contrast)}** | **${incomplete}** | **${resolved}** | **${failed}** | **${missed}** | **${sum((s) => s.counts.drift)}** |`,
  "",
);

for (const s of ok) {
  lines.push(`## ${s.name}`, "");
  lines.push(`Pages: ${s.urls.map((u) => `<${u}>`).join(", ")}`, "");
  const c = s.counts;
  lines.push(
    `${s.summary.textChecked} text elements measured across ${s.summary.states} page states. ${c.contrast} contrast findings (axe: ${c.contrastByAxe.incomplete} incomplete, ${c.contrastByAxe.pass} pass, ${c.contrastByAxe["not-checked"]} not checked, ${c.contrastByAxe.fail} fail). Backgrounds: ${c.contrastByKind.solid} solid, ${c.contrastByKind.gradient} gradient, ${c.contrastByKind.image} image, ${c.contrastByKind.mixed} mixed. ${c.drift} off-token colors (${c.likelyTypos} likely typos).`,
    "",
  );
  if (s.pageErrors?.length)
    lines.push(
      `Not audited: ${s.pageErrors.map((e) => `${e.url} @${e.viewport} ${e.scheme} (${e.error})`).join("; ")}.`,
      "",
    );
  if (notes[s.id]) lines.push(notes[s.id], "");
  if (s.top.length) {
    lines.push("Most interesting findings that axe left incomplete or missed:", "");
    s.top.forEach((f, i) => {
      lines.push(
        `${i + 1}. **${f.wcag.ratio.toFixed(2)}:1** (needs ${f.wcag.required}) · \`${esc(short(f.selector, 80))}\` · “${esc(short(f.text))}” · ${f.foreground} on ${f.background.worst} (${f.background.kind}) · ${f.viewport}px ${f.scheme} · axe: **${f.axeVerdict}**${f.suggestion?.token ? ` · suggested \`${f.suggestion.token}\` (${f.suggestion.ratio}:1)` : ""}`,
      );
      if (f.image) lines.push("", `   ![${esc(short(f.text, 40))}](${f.image})`, "");
    });
    lines.push("");
  } else {
    lines.push("No contrast failures that axe missed.", "");
  }
}

// Precision review.
const sample = data.precisionSample ?? [];
const labeled = sample.filter((f) => review.labels[f.id]);
const tp = labeled.filter((f) => review.labels[f.id].label === "TP").length;
lines.push("## Precision review", "");
lines.push(
  `A deterministic, evenly spaced sample of ${sample.length} contrast findings across all sites was reviewed by hand against its screenshot crop: is the text really below the required contrast against what is really behind it? ${labeled.length} reviewed, ${tp} true positives: **precision ${pct(tp, labeled.length)}**.`,
  "",
  "| # | Site | Element | Ratio | Colors | axe | Label | Why |",
  "|---|---|---|---:|---|---|---|---|",
);
for (const f of sample) {
  const l = review.labels[f.id];
  lines.push(
    `| ${f.id} | ${f.site} | \`${esc(short(f.selector, 48))}\` “${esc(short(f.text, 32))}” | ${f.wcag.ratio.toFixed(2)} | ${f.foreground} on ${f.background.worst} (${f.background.kind}) | ${f.axeVerdict} | ${l ? l.label : "—"} | ${esc(l?.reason ?? "not reviewed")} |`,
  );
}
lines.push("");
if (review.fixes?.length) {
  lines.push("## False positives found and fixed", "");
  for (const fix of review.fixes) lines.push(`- ${fix}`);
  lines.push("");
}
if (review.next?.length) {
  lines.push("## What's next", "");
  for (const n of review.next) lines.push(`- ${n}`);
  lines.push("");
}
writeFileSync("docs/case-studies.md", `${lines.join("\n")}\n`);
console.log(
  `wrote docs/case-studies.md (${ok.length} sites, ${labeled.length}/${sample.length} reviewed, precision ${pct(tp, labeled.length)})`,
);
