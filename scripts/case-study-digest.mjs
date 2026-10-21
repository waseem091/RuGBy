/**
 * Turn full case-study reports (case-studies/out/<id>/report.json + shots)
 * into a compact, committable digest: docs/case-studies/data.json plus small
 * screenshot crops (each under 200 KB). Run by .github/workflows/case-studies.yml.
 *   node scripts/case-study-digest.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const sites = JSON.parse(readFileSync("case-studies/sites.json", "utf8"));
const outDir = "docs/case-studies";
// Replace the previous digest (data.json and crops) but keep hand-written files such as review.json.
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir))
  if (f === "data.json" || f.endsWith(".png")) rmSync(join(outDir, f));

const KIND_RANK = { gradient: 0, image: 1, mixed: 2, solid: 3 };
const AXE_RANK = { incomplete: 0, pass: 1, "not-checked": 2, fail: 3 };

function copyShot(siteId, finding, label) {
  if (!finding.screenshot) return null;
  const src = join("case-studies/out", siteId, finding.screenshot.replace(/^.*?shots\//, "shots/"));
  if (!existsSync(src) || statSync(src).size > 200_000) return null;
  const name = `${siteId}-${label}.png`;
  copyFileSync(src, join(outDir, name));
  return `case-studies/${name}`;
}

function slim(f) {
  const keep = [
    "type",
    "severity",
    "page",
    "viewport",
    "scheme",
    "selector",
    "text",
    "fontSizePx",
    "fontWeight",
    "largeText",
    "foreground",
    "background",
    "wcag",
    "apca",
    "axeVerdict",
    "suggestion",
    "notes",
    "alsoOn",
  ];
  return Object.fromEntries(Object.entries(f).filter(([k]) => keep.includes(k)));
}

const digest = { generatedFrom: "case-studies/sites.json", sites: [] };
const all = [];
for (const site of sites) {
  const file = join("case-studies/out", site.id, "report.json");
  if (!existsSync(file)) {
    digest.sites.push({ ...site, status: "missing", error: "no report produced" });
    continue;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    digest.sites.push({ ...site, status: "error", error: String(error) });
    continue;
  }
  const contrast = report.findings.filter((f) => f.type === "contrast");
  const drift = report.findings.filter((f) => f.type === "drift");
  const okPages = report.pages.filter((p) => p.status === "ok");
  const interesting = contrast
    .filter((f) => f.axeVerdict !== "fail")
    .sort(
      (a, b) =>
        AXE_RANK[a.axeVerdict] - AXE_RANK[b.axeVerdict] ||
        KIND_RANK[a.background.kind] - KIND_RANK[b.background.kind] ||
        a.wcag.ratio - b.wcag.ratio,
    );
  const picked = [];
  const seen = new Set();
  for (const f of interesting) {
    const key = `${f.selector}|${f.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ ...slim(f), image: copyShot(site.id, f, `top-${picked.length + 1}`) });
    if (picked.length === 3) break;
  }
  for (const [i, f] of contrast.entries()) all.push({ site: site.id, index: i, finding: f });
  digest.sites.push({
    id: site.id,
    name: site.name,
    kind: site.kind,
    urls: site.urls,
    status: okPages.length ? "ok" : "error",
    pageErrors: report.pages
      .filter((p) => p.status === "error")
      .map((p) => ({ url: p.url, viewport: p.viewport, scheme: p.scheme, error: p.error })),
    notes: [...new Set(report.pages.flatMap((p) => p.notes))].slice(0, 10),
    tokens: report.tokens,
    summary: report.summary,
    counts: {
      contrast: contrast.length,
      contrastByAxe: Object.fromEntries(
        ["pass", "fail", "incomplete", "not-checked"].map((v) => [
          v,
          contrast.filter((f) => f.axeVerdict === v).length,
        ]),
      ),
      contrastByKind: Object.fromEntries(
        ["solid", "gradient", "image", "mixed"].map((k) => [
          k,
          contrast.filter((f) => f.background.kind === k).length,
        ]),
      ),
      drift: drift.length,
      likelyTypos: drift.filter((f) => f.likelyTypo).length,
    },
    top: picked,
    topDrift: drift.slice(0, 3).map((f) => ({
      color: f.color,
      property: f.property,
      nearestToken: f.nearestToken,
      source: f.source,
      occurrences: f.occurrences,
      likelyTypo: f.likelyTypo,
      cause: f.cause,
    })),
  });
}

// A deterministic, spread-out sample of 20 contrast findings for manual precision review.
const sample = [];
if (all.length) {
  const step = all.length / Math.min(20, all.length);
  for (let i = 0; i < Math.min(20, all.length); i++) {
    const { site, finding } = all[Math.floor(i * step)];
    sample.push({
      id: `S${String(i + 1).padStart(2, "0")}`,
      site,
      ...slim(finding),
      image: copyShot(site, finding, `sample-${String(i + 1).padStart(2, "0")}`),
    });
  }
}
digest.precisionSample = sample;
writeFileSync(join(outDir, "data.json"), `${JSON.stringify(digest, null, 2)}\n`);
console.log(
  `digest: ${digest.sites.length} sites, ${all.length} contrast findings, ${sample.length} sampled`,
);
