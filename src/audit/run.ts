/**
 * The audit pipeline: resolve targets and tokens, measure every page ×
 * viewport × scheme in a browser pool, then assemble one deterministic report.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Browser } from "playwright-core";
import {
  type DriftStateData,
  groupDrift,
  measureDrift,
  pageTokenSet,
  tokenUsage,
} from "../drift/stage.js";
import { suggestContrastFix } from "../suggest/contrast.js";
import { loadTokens } from "../tokens/detect.js";
import type { TokenSet } from "../tokens/types.js";
import { VERSION } from "../version.js";
import { launchBrowser } from "./browser.js";
import { type AuditOptions, resolveOptions } from "./options.js";
import { type MeasuredText, measureState, type StateHooks, type StateOutput } from "./state.js";
import { RateLimiter, resolveTargets } from "./targets.js";
import type { ContrastCheck, ContrastFinding, Finding, Report, Scheme } from "./types.js";

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

export async function runAudit(input: AuditOptions): Promise<Report> {
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
    const fileTokens = tokens;
    // `tokens: null` (--tokens none) turns drift off rather than falling back to page tokens.
    const hooks: StateHooks =
      o.drift && o.tokens !== null
        ? {
            afterMeasure: (page, scheme) =>
              measureDrift(page, scheme, fileTokens, {
                selector: o.selector,
                threshold: o.driftThreshold,
              }),
          }
        : {};
    let done = 0;
    let relaunching: Promise<Browser> | null = null;
    outputs = await pool(states, o.concurrency, async (s) => {
      // A page can crash Chromium (out of memory on huge pages): start a new one.
      if (!browser!.isConnected()) {
        relaunching ??= launchBrowser(o.executablePath ? { executablePath: o.executablePath } : {});
        browser = await relaunching;
        relaunching = null;
      }
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

  // Token files are shown relative to the working directory, so reports don't depend on the machine.
  const displaySource = (source: string) =>
    source
      .split(",")
      .map((p) => (isAbsolute(p) ? relative(o.cwd, p).split("\\").join("/") || p : show(p)))
      .join(",");
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

  // Without a token file, fall back to the pages' :root custom properties.
  if (!tokens) {
    const fromPage = outputs.flatMap(
      (out) => (out.extra as DriftStateData | undefined)?.pageTokens ?? [],
    );
    const firstPage = outputs[0]?.page.url ?? "";
    tokens = pageTokenSet(`${firstPage} (:root custom properties)`, fromPage);
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
    if (o.suggestions && t.histogram) {
      f.suggestion = suggestContrastFix(
        {
          authored: t.authored,
          opacity: t.opacity,
          blendMode: t.blendMode,
          histogram: t.histogram,
          medianBg: t.medianBg,
          fontSizePx: t.fontSizePx,
          fontWeight: t.fontWeight,
          level: o.level,
          standard: o.standard,
          scheme: t.scheme,
        },
        tokens?.tokens ?? [],
      );
      if (f.suggestion === null) {
        const why =
          t.opacity < 0.999
            ? ` The text is at ${Math.round(t.opacity * 100)}% effective opacity; raising it is the fix.`
            : "";
        f.notes = [
          ...(f.notes ?? []),
          `No token passes against this background (tried every text and background token).${why}`,
        ];
      }
    }
    seen.set(key, f);
    contrast.push(f);
    if (t.crop) crops.set(f, t.crop);
  }

  // Drift: group every off-token color across states.
  const located = outputs.flatMap((out) => {
    const data = out.extra as DriftStateData | undefined;
    if (data?.notes.length) out.page.notes.push(...data.notes);
    return (data?.entries ?? []).map((e) => ({
      ...e,
      source: e.source
        ? { ...e.source, stylesheet: e.source.stylesheet && show(e.source.stylesheet) }
        : null,
      page: out.page.url,
      viewport: out.page.viewport,
      scheme: out.page.scheme,
    }));
  });
  const drift = o.drift ? groupDrift(located) : [];
  const used = new Map<string, number>();
  for (const out of outputs) {
    for (const [name, n] of (out.extra as DriftStateData | undefined)?.used ?? [])
      used.set(name, (used.get(name) ?? 0) + n);
  }
  const finished = {
    findings: drift,
    tokenUsage: o.drift ? tokenUsage(tokens, used, drift) : undefined,
  };

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
          source: displaySource(tokens.source),
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
    ...(finished.tokenUsage?.length ? { tokenUsage: finished.tokenUsage } : {}),
    ...(o.includeChecks ? { checks: texts.map(toCheck) } : {}),
  };
  return report;
}
