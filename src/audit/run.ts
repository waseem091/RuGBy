/**
 * The audit pipeline: resolve targets and tokens, measure every page ×
 * viewport × scheme in a browser pool, then assemble one deterministic report.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Browser } from "playwright-core";
import { loadTokens } from "../tokens/detect.js";
import type { TokenSet } from "../tokens/types.js";
import { VERSION } from "../version.js";
import { launchBrowser } from "./browser.js";
import { type AuditOptions, type ResolvedOptions, resolveOptions } from "./options.js";
import { type MeasuredText, measureState, type StateHooks, type StateOutput } from "./state.js";
import { RateLimiter, resolveTargets } from "./targets.js";
import type { ContrastCheck, ContrastFinding, Finding, Report, Scheme } from "./types.js";

/** Hooks other stages (drift, suggestions) plug into. */
export interface Pipeline {
  hooks?: (tokens: () => TokenSet | null) => StateHooks;
  /** Build extra findings and token usage once every state is measured. */
  finish?: (input: {
    outputs: StateOutput[];
    tokens: TokenSet | null;
    options: ResolvedOptions;
    contrast: ContrastFinding[];
    texts: MeasuredText[];
  }) => Promise<{
    findings: Finding[];
    tokenUsage?: Report["tokenUsage"];
    tokens?: TokenSet | null;
  }>;
}

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function toCheck(t: MeasuredText): ContrastCheck {
  return {
    page: t.page,
    viewport: t.viewport,
    scheme: t.scheme,
    selector: t.selector,
    text: t.text,
    fontSizePx: t.fontSizePx,
    fontWeight: t.fontWeight,
    largeText: t.largeText,
    foreground: t.foreground,
    background: t.background,
    wcag: t.wcag,
    apca: t.apca,
    axeVerdict: t.axeVerdict,
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

function toFinding(t: MeasuredText): ContrastFinding {
  return { type: "contrast", severity: t.severity, ...toCheck(t) };
}

export async function runAudit(input: AuditOptions, pipeline: Pipeline = {}): Promise<Report> {
  const o = resolveOptions(input);
  let tokens: TokenSet | null =
    o.tokens === null
      ? null
      : typeof o.tokens === "object"
        ? o.tokens
        : await loadTokens(o.tokens, o.cwd);
  const { urls, servers } = await resolveTargets(o.targets, {
    sitemap: o.sitemap,
    maxPages: o.maxPages,
  });
  let browser: Browser | undefined;
  const limiter = new RateLimiter(o.rateLimitMs);
  const states: { url: string; viewport: number; scheme: Scheme }[] = [];
  for (const url of urls) {
    for (const viewport of o.viewports)
      for (const scheme of o.schemes) states.push({ url, viewport, scheme });
  }
  let outputs: StateOutput[];
  try {
    browser = await launchBrowser(o.executablePath ? { executablePath: o.executablePath } : {});
    const hooks = pipeline.hooks?.(() => tokens) ?? {};
    let done = 0;
    outputs = await pool(states, o.concurrency, async (s) => {
      const out = await measureState(browser!, s.url, s.viewport, s.scheme, o, limiter, hooks);
      done++;
      o.onProgress?.({
        ...s,
        done,
        total: states.length,
        ...(out.page.error ? { error: out.page.error } : {}),
      });
      return out;
    });
  } finally {
    await browser?.close();
    await Promise.all(servers.map((s) => s.close()));
  }

  // Display URLs: local static servers get a stable placeholder origin.
  const display = new Map<string, string>();
  for (const s of servers) display.set(s.url, `local:`);
  const show = (url: string) => {
    for (const [origin, label] of display)
      if (url.startsWith(origin)) return label + url.slice(origin.length);
    return url;
  };
  for (const out of outputs) {
    out.page.url = show(out.page.url);
    for (const t of out.texts) t.page = show(t.page);
  }

  // Contrast findings, deduplicated across pages (sticky headers, shared footers).
  const texts = outputs.flatMap((out) => out.texts);
  const failing = texts.filter((t) => !t.pass);
  const seen = new Map<string, ContrastFinding>();
  const contrast: ContrastFinding[] = [];
  const crops = new Map<ContrastFinding, Uint8Array>();
  for (const t of failing) {
    const key = [t.viewport, t.scheme, t.selector, t.text, t.foreground, t.background.worst].join(
      "|",
    );
    const first = seen.get(key);
    if (first) {
      if (first.page !== t.page) {
        first.alsoOn = [...new Set([...(first.alsoOn ?? []), t.page])];
      }
      continue;
    }
    const f = toFinding(t);
    seen.set(key, f);
    contrast.push(f);
    if (t.crop) crops.set(f, t.crop);
  }

  const finished = pipeline.finish
    ? await pipeline.finish({ outputs, tokens, options: o, contrast, texts })
    : { findings: [] };
  if (finished.tokens !== undefined) tokens = finished.tokens;

  // Screenshots, numbered in report order.
  if (o.reportDir && crops.size) {
    const dir = resolve(o.cwd, o.reportDir, "shots");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    let n = 0;
    for (const f of contrast) {
      const crop = crops.get(f);
      if (!crop) continue;
      n++;
      const file = join(dir, `${String(n).padStart(4, "0")}.png`);
      await writeFile(file, crop);
      f.screenshot = relative(o.cwd, file).split("\\").join("/");
    }
  }

  const findings: Finding[] = [...contrast, ...finished.findings];
  const pages = outputs.map((out) => out.page);
  const sum = (f: (p: (typeof pages)[number]) => number) => pages.reduce((s, p) => s + f(p), 0);
  const report: Report = {
    tool: { name: "rugby", version: VERSION },
    ...(o.timestamps ? { generatedAt: new Date().toISOString() } : {}),
    options: {
      viewports: o.viewports,
      schemes: o.schemes,
      standard: o.standard,
      level: o.level,
      driftThreshold: o.driftThreshold,
      selector: o.selector,
    },
    tokens: tokens
      ? {
          format: tokens.format,
          source: show(tokens.source),
          count: tokens.tokens.length,
          modes: tokens.modes,
        }
      : null,
    summary: {
      pages: urls.length,
      states: states.length,
      textChecked: sum((p) => p.stats.textChecked),
      findings: {
        contrast: {
          error: contrast.filter((f) => f.severity === "error").length,
          warning: contrast.filter((f) => f.severity !== "error").length,
        },
        drift: {
          error: finished.findings.filter((f) => f.type === "drift" && f.severity === "error")
            .length,
          warning: finished.findings.filter((f) => f.type === "drift" && f.severity === "warning")
            .length,
          info: finished.findings.filter((f) => f.type === "drift" && f.severity === "info").length,
        },
      },
      axe: {
        missed: contrast.filter((f) => f.axeVerdict !== "fail").length,
        incomplete: sum((p) => p.stats.axe.incomplete),
        incompleteResolved: sum((p) => p.stats.axeIncompleteResolved),
        incompleteFailed: sum((p) => p.stats.axeIncompleteFailed),
      },
    },
    pages,
    findings,
    ...(finished.tokenUsage ? { tokenUsage: finished.tokenUsage } : {}),
    ...(o.includeChecks ? { checks: texts.map(toCheck) } : {}),
  };
  return report;
}
