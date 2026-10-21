import { runAudit } from "./dist/index.js";

const t0 = Date.now();
const report = await runAudit({
  targets: ["fixtures/pages"],
  maxPages: 50,
  tokens: null,
  includeChecks: true,
  reportDir: null,
  darkClass: "dark",
  viewports: [375, 1440],
});
console.log("time", Date.now() - t0, "ms");
for (const p of report.pages)
  if (p.status !== "ok" || p.notes.length)
    console.log(p.url, p.viewport, p.scheme, p.status, p.error ?? "", p.notes);
for (const c of report.checks)
  if (c.viewport === 1440 && c.scheme === "light")
    console.log(
      c.page.padEnd(32),
      c.selector.padEnd(22),
      String(c.wcag.ratio).padEnd(6),
      c.wcag.pass ? "pass" : "FAIL",
      c.background.kind.padEnd(8),
      c.axeVerdict.padEnd(11),
      c.foreground,
      c.background.worst,
      c.background.sampled,
      (c.notes || []).join("; "),
    );
console.log("dark/375 diffs:");
const key = (c) => c.page + c.selector;
const light = new Map(
  report.checks.filter((c) => c.viewport === 1440 && c.scheme === "light").map((c) => [key(c), c]),
);
for (const c of report.checks) {
  const l = light.get(key(c));
  if (!l) {
    console.log("only in", c.viewport, c.scheme, key(c));
    continue;
  }
  if (
    Math.abs(l.wcag.ratio - c.wcag.ratio) > 0.05 ||
    l.background.kind !== c.background.kind ||
    l.axeVerdict !== c.axeVerdict
  )
    console.log(
      c.viewport,
      c.scheme,
      key(c),
      c.wcag.ratio,
      c.background.kind,
      c.axeVerdict,
      "vs",
      l.wcag.ratio,
      l.background.kind,
      l.axeVerdict,
    );
}
console.log(JSON.stringify(report.summary));
