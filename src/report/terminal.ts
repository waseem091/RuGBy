/** Human-readable terminal output: grouped, colored, and one line when clean. */
import type { ContrastFinding, DriftFinding, Report } from "../audit/types.js";
import { createStyle, type Style } from "../util/ansi.js";

export interface TerminalOptions {
  color?: boolean;
  /** Path of the HTML report, if one was written. */
  htmlPath?: string | null;
  /** Max findings listed per type. */
  limit?: number;
}

interface ContrastGroup {
  first: ContrastFinding;
  viewports: Set<number>;
  schemes: Set<string>;
  pages: Set<string>;
}

function groupContrast(findings: ContrastFinding[]): Map<string, ContrastGroup[]> {
  const byKey = new Map<string, ContrastGroup>();
  for (const f of findings) {
    const key = [f.page, f.selector, f.text, f.foreground, f.background.worst, f.wcag.ratio].join(
      "|",
    );
    let g = byKey.get(key);
    if (!g) {
      g = {
        first: f,
        viewports: new Set(),
        schemes: new Set(),
        pages: new Set([f.page, ...(f.alsoOn ?? [])]),
      };
      byKey.set(key, g);
    }
    g.viewports.add(f.viewport);
    g.schemes.add(f.scheme);
  }
  const byPage = new Map<string, ContrastGroup[]>();
  for (const g of byKey.values()) {
    const list = byPage.get(g.first.page) ?? [];
    list.push(g);
    byPage.set(g.first.page, list);
  }
  return byPage;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function contrastLine(s: Style, g: ContrastGroup): string[] {
  const f = g.first;
  const icon = f.severity === "error" ? s.red("✖") : s.yellow("⚠");
  const text = f.text.length > 48 ? `${f.text.slice(0, 45)}...` : f.text;
  const where = `${[...g.viewports].sort((a, b) => a - b).join(",")} · ${[...g.schemes].sort().join(",")}`;
  const lines = [
    `    ${icon} ${s.bold(`${f.wcag.ratio.toFixed(2)}:1`)} ${s.dim(`(needs ${f.wcag.required})`)}  ${s.cyan(f.selector)}  ${s.dim(`"${text}"`)}`,
    `       ${f.foreground} on ${f.background.worst} ${s.dim(`(${f.background.kind})`)}  ${s.dim(where)}  axe: ${f.axeVerdict === "fail" ? f.axeVerdict : s.magenta(f.axeVerdict)}`,
  ];
  if (g.pages.size > 1) lines.push(s.dim(`       also on ${g.pages.size - 1} other page(s)`));
  if (f.suggestion) {
    const sug = f.suggestion;
    const name = sug.token ? `${sug.token} ` : "";
    lines.push(
      `       ${s.green("→")} ${sug.target === "background" ? "background " : ""}${name}${sug.value}${sug.ratio !== undefined ? ` (${sug.ratio.toFixed(2)}:1)` : ""}`,
    );
  } else if (f.suggestion === null) {
    lines.push(s.dim("       → no token passes against this background"));
  }
  return lines;
}

function driftLine(s: Style, f: DriftFinding): string[] {
  const near = f.nearestToken
    ? `ΔE ${f.nearestToken.deltaE.toFixed(1)} from ${f.nearestToken.name} ${f.nearestToken.value}`
    : "no tokens loaded";
  const typo = f.likelyTypo ? s.magenta(" (likely typo)") : "";
  const src = f.source
    ? `${f.source.rule}${f.source.stylesheet ? s.dim(`  ${f.source.stylesheet}${f.source.line ? `:${f.source.line}` : ""}`) : ""}`
    : f.selectors.slice(0, 3).join(", ");
  const lines = [
    `    ${f.severity === "warning" ? s.yellow("⚠") : s.dim("·")} ${s.bold(f.color)} ${f.property}  ${near}${typo}  ×${f.occurrences}`,
    `       ${src}`,
  ];
  if (f.cause?.length) lines.push(s.dim(`       ${f.cause.join("; ")}`));
  if (f.suggestion?.replacement) lines.push(`       ${s.green("→")} ${f.suggestion.replacement}`);
  return lines;
}

export function formatTerminal(report: Report, options: TerminalOptions = {}): string {
  const s = createStyle(options.color ?? false);
  const limit = options.limit ?? 50;
  const contrast = report.findings.filter((f): f is ContrastFinding => f.type === "contrast");
  const drift = report.findings.filter((f): f is DriftFinding => f.type === "drift");
  const errors = report.pages.filter((p) => p.status === "error");
  const head = `${s.bold("RuGBy")} ${s.dim(
    `· ${plural(report.summary.pages, "page")} · ${report.options.viewports.join(",")}px × ${report.options.schemes.join(",")} · ${
      report.tokens ? `tokens: ${report.tokens.format} (${report.tokens.count})` : "no tokens"
    }`,
  )}`;
  const out: string[] = [head];
  for (const p of errors)
    out.push(s.red(`  ✖ could not audit ${p.url} @${p.viewport} ${p.scheme}: ${p.error}`));
  if (!contrast.length && !drift.length) {
    out.push(
      `${s.green("✔")} No contrast or drift findings ${s.dim(`(${plural(report.summary.textChecked, "text element")} checked)`)}`,
    );
    return `${out.join("\n")}\n`;
  }
  const sum = report.summary;
  if (contrast.length) {
    const c = sum.findings.contrast;
    out.push(
      "",
      `${s.bold("Contrast")}  ${plural(c.error, "error")}, ${plural(c.warning, "warning")}  ${s.dim(
        `· ${sum.textChecked} text elements · axe missed ${sum.axe.missed}, left ${sum.axe.incomplete} incomplete`,
      )}`,
    );
    let shown = 0;
    for (const [page, groups] of groupContrast(contrast)) {
      if (shown >= limit) break;
      out.push(`  ${s.bold(page)}`);
      for (const g of groups) {
        if (shown++ >= limit) break;
        out.push(...contrastLine(s, g));
      }
    }
  }
  if (drift.length) {
    out.push("", `${s.bold("Drift")}  ${plural(drift.length, "off-token color")}`);
    for (const f of drift.slice(0, limit)) out.push(...driftLine(s, f));
  }
  const total = contrast.length + drift.length;
  if (total > limit) out.push(s.dim(`  … ${total - limit} more in the full report`));
  if (options.htmlPath) out.push("", `Report: ${options.htmlPath}`);
  return `${out.join("\n")}\n`;
}
