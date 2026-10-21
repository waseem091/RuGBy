#!/usr/bin/env node
import { dirname } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import type { AuditOptions } from "./audit/options.js";
import type { FailOn, Report, Scheme, Standard } from "./audit/types.js";
import { checkContrast } from "./check.js";
import { ColorParseError } from "./color/parse.js";
import { UsageError } from "./errors.js";
import { writeAllRgbFixture } from "./fixture.js";
import { audit } from "./index.js";
import { formatTerminal } from "./report/terminal.js";
import { loadTokens } from "./tokens/detect.js";
import { formatTokenTable } from "./tokens/print.js";
import { TokenError } from "./tokens/types.js";
import { colorEnabled, createStyle } from "./util/ansi.js";
import { VERSION } from "./version.js";

const EXIT = { clean: 0, findings: 1, usage: 2, internal: 3 } as const;

function positiveNumber(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError("expected a positive number");
  return n;
}

function level(value: string): "AA" | "AAA" {
  const v = value.toUpperCase();
  if (v !== "AA" && v !== "AAA") throw new InvalidArgumentError("expected AA or AAA");
  return v;
}

function list<T extends string>(allowed: readonly T[], name: string) {
  return (value: string): T[] => {
    const items = value
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    for (const item of items) {
      if (!allowed.includes(item as T)) {
        throw new InvalidArgumentError(`${name} must be a comma list of ${allowed.join(", ")}`);
      }
    }
    return items as T[];
  };
}

function viewports(value: string): number[] {
  const items = value.split(",").map((v) => Number(v.trim()));
  if (!items.length || items.some((n) => !Number.isInteger(n) || n < 200 || n > 4000)) {
    throw new InvalidArgumentError("expected a comma list of widths between 200 and 4000");
  }
  return items;
}

function nonNegative(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError("expected a number ≥ 0");
  return n;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Which findings make the exit code nonzero. */
export function failingFindings(report: Report, failOn: FailOn[]): number {
  return report.findings.filter(
    (f) => failOn.includes(f.type) && (f.type === "contrast" || f.severity !== "info"),
  ).length;
}

const program = new Command();
program
  .name("rugby")
  .description("Audit the colors a browser actually paints: contrast and design-token drift.")
  .version(VERSION)
  .showHelpAfterError()
  // Subcommands inherit this: argument errors exit 2, --help/--version exit 0.
  .exitOverride((err) => process.exit(err.exitCode === 0 ? EXIT.clean : EXIT.usage));

interface AuditCliOptions {
  tokens?: string;
  viewports: number[];
  schemes: Scheme[];
  standard: Standard;
  level: "AA" | "AAA";
  driftThreshold: number;
  json?: boolean;
  html: string | false;
  failOn: (FailOn | "none")[];
  sitemap?: string;
  maxPages: number;
  selector: string;
  hide: string[];
  defaultHide: boolean;
  darkClass?: string;
  includeChecks?: boolean;
  timestamps?: boolean;
  concurrency: number;
  axe: boolean;
  drift: boolean;
}

program
  .command("audit")
  .description("audit rendered pages: pixel-sampled contrast and design-token drift")
  .argument("[targets...]", "URLs, .html files or build directories")
  .option("--tokens <path>", "token file(s) or directory; 'none' to skip (default: auto-detect)")
  .option("--viewports <list>", "viewport widths in px", viewports, [375, 1440])
  .option(
    "--schemes <list>",
    "prefers-color-scheme values",
    list(["light", "dark"] as const, "--schemes"),
    ["light", "dark"],
  )
  .addOption(
    new Option("--standard <model>", "contrast model that decides pass/fail")
      .choices(["wcag2", "apca", "both"])
      .default("wcag2"),
  )
  .option("--level <AA|AAA>", "WCAG level", level, "AA")
  .option("--drift-threshold <deltaE>", "OKLab ΔE above which a color is off-token", nonNegative, 2)
  .option("--json", "print the JSON report to stdout")
  .option(
    "--html <path>",
    "write the HTML report here (screenshots go next to it)",
    "rugby-report/index.html",
  )
  .option("--no-html", "do not write the HTML report or screenshots")
  .option(
    "--fail-on <list>",
    "finding types that make the exit code 1: contrast, drift or none",
    list(["contrast", "drift", "none"] as const, "--fail-on"),
    ["contrast"],
  )
  .option("--sitemap <url>", "audit the pages listed in a sitemap")
  .option("--max-pages <n>", "page limit for --sitemap and directories", positiveNumber, 10)
  .option("--selector <css>", "limit the audit to part of the page", "body")
  .option("--hide <selector>", "hide elements before measuring (repeatable)", collect, [])
  .option("--no-default-hide", "do not hide common cookie/consent banners")
  .option("--dark-class <name>", "class to toggle on <html> for the dark scheme")
  .option("--include-checks", "include every measured text element in the JSON report")
  .option("--timestamps", "include a generatedAt timestamp in the JSON")
  .option("--concurrency <n>", "pages measured in parallel", positiveNumber, 4)
  .option("--no-axe", "skip the axe-core comparison")
  .option("--no-drift", "skip design-token drift detection")
  .action(async (targets: string[], opts: AuditCliOptions) => {
    if (!targets.length && !opts.sitemap) {
      throw new UsageError(
        "Nothing to audit: pass a URL, an .html file, a build directory or --sitemap <url>",
      );
    }
    const htmlPath = opts.html === false ? null : opts.html;
    const err = createStyle(colorEnabled(process.stderr));
    const options: AuditOptions = {
      targets,
      ...(opts.sitemap ? { sitemap: opts.sitemap } : {}),
      maxPages: opts.maxPages,
      tokens: opts.tokens === "none" ? null : opts.tokens,
      viewports: opts.viewports,
      schemes: opts.schemes,
      standard: opts.standard,
      level: opts.level,
      driftThreshold: opts.driftThreshold,
      selector: opts.selector,
      hide: opts.hide,
      defaultHide: opts.defaultHide,
      ...(opts.darkClass ? { darkClass: opts.darkClass } : {}),
      reportDir: htmlPath ? dirname(htmlPath) : null,
      timestamps: !!opts.timestamps,
      includeChecks: !!opts.includeChecks,
      concurrency: Math.round(opts.concurrency),
      axe: opts.axe,
      drift: opts.drift,
      onProgress: (e) => {
        if (!process.stderr.isTTY) return;
        const status = e.error ? err.red(` ${e.error}`) : "";
        process.stderr.write(
          `\r\u001b[2K${err.dim(`[${e.done}/${e.total}] ${e.url} @${e.viewport} ${e.scheme}`)}${status}`,
        );
        if (e.done === e.total || e.error) process.stderr.write("\n");
      },
    };
    const report = await audit(options);
    if (htmlPath) {
      const { writeHtmlReport } = await import("./report/html.js");
      await writeHtmlReport(report, htmlPath);
    }
    if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(formatTerminal(report, { color: colorEnabled(), htmlPath }));
    if (report.pages.every((p) => p.status === "error")) {
      throw new Error(
        `every page failed to load (first error: ${report.pages[0]?.error ?? "unknown"})`,
      );
    }
    const failOn = opts.failOn.filter((f): f is FailOn => f !== "none");
    if (failingFindings(report, failOn) > 0) process.exitCode = EXIT.findings;
  });

program
  .command("tokens")
  .description("parse a token file (W3C design tokens JSON, Tailwind config or CSS) and print it")
  .argument("[file]", "token file, comma-separated files, or a directory (default: auto-detect)")
  .option("--json", "print the normalized token set as JSON")
  .action(async (file: string | undefined, opts: { json?: boolean }) => {
    const set = await loadTokens(file);
    if (!set) {
      throw new UsageError(
        "No token file found. Pass one, or add tokens.json, *.tokens.json or tailwind.config.* here.",
      );
    }
    if (opts.json) process.stdout.write(`${JSON.stringify(set, null, 2)}\n`);
    else process.stdout.write(formatTokenTable(set, { color: colorEnabled() }));
  });

program
  .command("contrast")
  .description("check the contrast of one foreground/background pair (WCAG 2.x and APCA)")
  .argument("<foreground>", "text color, any CSS color")
  .argument("<background>", "background color, any CSS color")
  .option("--size <px>", "font size in px", positiveNumber, 16)
  .option("--weight <n>", "font weight (100-900)", positiveNumber, 400)
  .option("--level <AA|AAA>", "WCAG level", level, "AA")
  .option("--json", "print JSON")
  .action(
    (
      fg: string,
      bg: string,
      opts: { size: number; weight: number; level: "AA" | "AAA"; json?: boolean },
    ) => {
      const r = checkContrast(fg, bg, {
        fontSizePx: opts.size,
        fontWeight: opts.weight,
        level: opts.level,
      });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        return;
      }
      const s = createStyle(colorEnabled());
      const mark = (ok: boolean) => (ok ? s.green("pass") : s.red("fail"));
      const lines = [
        `${s.bold(r.foreground)} on ${s.bold(r.background)}  ${s.dim(`${r.fontSizePx}px / ${r.fontWeight}${r.largeText ? " (large text)" : ""}`)}`,
        `  WCAG 2.x  ${s.bold(`${r.wcag.ratio.toFixed(2)}:1`)}  ${mark(r.wcag.pass)} ${opts.level} (needs ${r.wcag.required}:1)`,
        `            AA normal ${mark(r.wcag.AA.normal)} · AA large ${mark(r.wcag.AA.large)} · AAA normal ${mark(r.wcag.AAA.normal)} · AAA large ${mark(r.wcag.AAA.large)}`,
        `  APCA      ${s.bold(`Lc ${r.apca.lc.toFixed(1)}`)}  ${mark(r.apca.pass)} (needs |Lc| ${r.apca.required}${r.apca.prohibited ? ", size/weight below APCA minimum" : ""})`,
        ...r.notes.map((n) => s.dim(`  note: ${n}`)),
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    },
  );

program
  .command("fixture")
  .description("regenerate the lossless all-RGB test PNG (fixtures/allrgb.png)")
  .option("-o, --out <path>", "output path", "fixtures/allrgb.png")
  .action(async (opts: { out: string }) => {
    const path = await writeAllRgbFixture(opts.out);
    process.stdout.write(`wrote ${path}\n`);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (
    error instanceof UsageError ||
    error instanceof TokenError ||
    error instanceof ColorParseError
  ) {
    process.stderr.write(`rugby: ${error.message}\n`);
    process.exit(EXIT.usage);
  }
  process.stderr.write(`rugby: internal error: ${(error as Error).stack ?? String(error)}\n`);
  process.exit(EXIT.internal);
}
