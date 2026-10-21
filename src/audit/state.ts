/**
 * Measure one page × viewport × color scheme: prepare the page, run axe,
 * collect text line boxes, then hide text in batches and sample the
 * background pixels from real screenshots.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Browser, Page } from "playwright-core";
import { apcaRequiredLc, roundLc } from "../color/apca.js";
import { type BlendMode, isBlendMode, withAlpha } from "../color/composite.js";
import { fromBytes, toHex } from "../color/format.js";
import { tryParseColor } from "../color/parse.js";
import type { Rgba } from "../color/types.js";
import { isLargeText, requiredRatio, roundRatio } from "../color/wcag.js";
import { cropImage, decodePng, encodePng, type RgbaImage, strokeRect } from "../util/png.js";
import { viewportHeight } from "./browser.js";
import { DEFAULT_HIDE_SELECTORS, type ResolvedOptions } from "./options.js";
import {
  type CollectResult,
  installPageApi,
  type PageApi,
  type RawTextItem,
  type Rect,
} from "./page-script.js";
import { classifyBackground, sampleContrast } from "./sample.js";
import type { RateLimiter } from "./targets.js";
import type { AxeVerdict, ContrastCheck, PageResult, Scheme, Severity } from "./types.js";

type WithApi = Window & { __rugby: PageApi };

export interface MeasuredText extends ContrastCheck {
  index: number;
  pass: boolean;
  severity: Severity;
  /** Authored (computed) text color before opacity. */
  authored: Rgba;
  /** Effective opacity and blend mode, for re-running the math on suggestions. */
  opacity: number;
  blendMode: BlendMode | "normal";
  worstBg: Rgba;
  rects: Rect[];
  crop?: Uint8Array;
}

export interface StateOutput {
  page: PageResult;
  texts: MeasuredText[];
  /** Hook for drift detection, run on the same prepared page. */
  extra?: unknown;
}

export interface StateHooks {
  /** Runs after contrast measurement, on the same page, before the context closes. */
  afterMeasure?: (page: Page, scheme: Scheme) => Promise<unknown>;
}

/**
 * Network idle: no request in flight for `quietMs`. Like Playwright's
 * `networkidle` (500ms) but with a shorter window, which matters across
 * hundreds of page loads.
 */
async function waitForNetworkIdle(
  page: Page,
  inflight: Set<unknown>,
  quietMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietSince = inflight.size === 0 ? Date.now() : 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (inflight.size === 0) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince >= quietMs) return true;
    } else quietSince = 0;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

/** Freeze motion and hide banners. Uses constructable stylesheets, which CSP does not block. */
async function injectStyles(page: Page, hide: string[]): Promise<void> {
  const css = [
    "*, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; caret-color: transparent !important; scroll-behavior: auto !important; }",
    ...hide.map((s) => `${s} { display: none !important; }`),
  ];
  await page.evaluate((rules) => {
    const docs: Document[] = [document];
    for (const f of Array.from(document.querySelectorAll("iframe"))) {
      try {
        if (f.contentDocument) docs.push(f.contentDocument);
      } catch {
        /* cross-origin */
      }
    }
    for (const doc of docs) {
      const view = doc.defaultView;
      if (!view) continue;
      try {
        const sheet = new view.CSSStyleSheet();
        for (const rule of rules) {
          try {
            sheet.insertRule(rule, sheet.cssRules.length);
          } catch {
            /* invalid selector: skip that rule only */
          }
        }
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      } catch {
        const style = doc.createElement("style");
        style.textContent = rules.join("\n");
        doc.head?.appendChild(style);
      }
      for (const a of doc.getAnimations?.() ?? []) {
        try {
          a.finish();
        } catch {
          a.cancel();
        }
      }
    }
  }, css);
}

/** Scroll through the page once so lazy-loaded content appears, then return to the top. */
async function autoScroll(page: Page, maxHeight: number): Promise<void> {
  await page.evaluate(async (limit) => {
    const step = Math.max(200, window.innerHeight);
    const height = Math.min(document.documentElement.scrollHeight, limit);
    for (let y = 0; y < height; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    const pending = Array.from(document.images).filter((img) => !img.complete);
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            }),
        ),
      ),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }, maxHeight);
}

interface AxeOutcome {
  verdicts: Map<number, AxeVerdict>;
  incomplete: number;
  error?: string;
}

type AxeTargets = { verdict: AxeVerdict; target: unknown }[];

async function runAxe(
  page: Page,
  selector: string,
): Promise<{ targets: AxeTargets; error?: string }> {
  try {
    let builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
    if (selector !== "body") builder = builder.include(selector);
    const results = await builder.analyze();
    const targets: AxeTargets = [];
    const add = (verdict: AxeVerdict, list: typeof results.passes) => {
      for (const rule of list) {
        if (rule.id !== "color-contrast") continue;
        for (const node of rule.nodes) targets.push({ verdict, target: node.target });
      }
    };
    add("pass", results.passes);
    add("incomplete", results.incomplete);
    add("fail", results.violations);
    return { targets };
  } catch (error) {
    return { targets: [], error: (error as Error).message.split("\n")[0] };
  }
}

const RANK: Record<AxeVerdict, number> = { "not-checked": 0, pass: 1, incomplete: 2, fail: 3 };

async function mapAxe(
  page: Page,
  axe: { targets: AxeTargets; error?: string },
): Promise<AxeOutcome> {
  const verdicts = new Map<number, AxeVerdict>();
  if (!axe.targets.length)
    return { verdicts, incomplete: 0, ...(axe.error ? { error: axe.error } : {}) };
  const indices = await page.evaluate(
    (targets) => (window as unknown as WithApi).__rugby.resolveTargets(targets),
    axe.targets.map((t) => t.target),
  );
  indices.forEach((index, i) => {
    if (index < 0) return;
    const v = axe.targets[i]!.verdict;
    const prev = verdicts.get(index);
    if (!prev || RANK[v] > RANK[prev]) verdicts.set(index, v);
  });
  return { verdicts, incomplete: axe.targets.filter((t) => t.verdict === "incomplete").length };
}

/** Greedy batching so no two items in a batch overlap (overlapping text stays visible as background). */
export function batchItems(items: RawTextItem[]): RawTextItem[][] {
  const batches: { items: RawTextItem[]; rects: Rect[] }[] = [];
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const item of items) {
    let placed = false;
    for (const batch of batches) {
      if (item.rects.some((r) => batch.rects.some((b) => overlaps(r, b)))) continue;
      batch.items.push(item);
      batch.rects.push(...item.rects);
      placed = true;
      break;
    }
    if (!placed) batches.push({ items: [item], rects: [...item.rects] });
  }
  return batches.map((b) => b.items);
}

async function screenshot(page: Page, height: number, width: number): Promise<RgbaImage> {
  const buffer = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    scale: "css",
    clip: { x: 0, y: 0, width, height },
  });
  return decodePng(buffer);
}

function unionRect(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.w));
  const b = Math.max(...rects.map((q) => q.y + q.h));
  return { x, y, w: r - x, h: b - y };
}

/** Text box plus 16px padding, outlined in magenta. */
export function cropFinding(image: RgbaImage, rects: Rect[]): Uint8Array {
  let box = unionRect(rects);
  if (box.w > 1400 || box.h > 700) box = rects[0]!;
  const pad = 16;
  const crop = cropImage(image, box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
  const ox = Math.max(0, Math.floor(box.x - pad));
  const oy = Math.max(0, Math.floor(box.y - pad));
  strokeRect(crop, box.x - ox - 2, box.y - oy - 2, box.w + 4, box.h + 4, [255, 0, 170], 2);
  return encodePng(crop);
}

export async function measureState(
  browser: Browser,
  url: string,
  viewport: number,
  scheme: Scheme,
  o: ResolvedOptions,
  limiter: RateLimiter,
  hooks: StateHooks = {},
): Promise<StateOutput> {
  const notes: string[] = [];
  const stats: PageResult["stats"] = {
    textChecked: 0,
    textSkipped: 0,
    contrastFailures: 0,
    axe: { pass: 0, fail: 0, incomplete: 0, "not-checked": 0 },
    axeIncompleteResolved: 0,
    axeIncompleteFailed: 0,
    axeMissed: 0,
  };
  const context = await browser.newContext({
    viewport: { width: viewport, height: viewportHeight(viewport) },
    deviceScaleFactor: 1,
    colorScheme: scheme,
    reducedMotion: "reduce",
    bypassCSP: true,
  });
  try {
    const page = await context.newPage();
    const inflight = new Set<unknown>();
    page.on("request", (r) => inflight.add(r));
    page.on("requestfinished", (r) => inflight.delete(r));
    page.on("requestfailed", (r) => inflight.delete(r));
    // Guard for bundler helpers that may appear in serialized functions.
    await page.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
    await limiter.wait(url);
    const response = await page.goto(url, { waitUntil: "load", timeout: o.timeoutMs });
    if (response && response.status() >= 400) {
      throw new Error(`HTTP ${response.status()} for ${url}`);
    }
    if (!(await waitForNetworkIdle(page, inflight, 250, 5000))) {
      notes.push("network did not go idle within 5s; measured anyway");
    }
    await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f);");
    if (o.darkClass) {
      await page.evaluate(
        ([cls, on]) => document.documentElement.classList.toggle(cls as string, on as boolean),
        [o.darkClass, scheme === "dark"] as const,
      );
    }
    const hide = [...(o.defaultHide ? DEFAULT_HIDE_SELECTORS : []), ...o.hide];
    await injectStyles(page, hide);
    await autoScroll(page, o.maxPageHeight);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await settle(page);

    const axeRaw = o.axe ? await runAxe(page, o.selector) : { targets: [] };
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);

    await page.evaluate(installPageApi);
    const collected: CollectResult = await page.evaluate(
      (opts) => (window as unknown as WithApi).__rugby.collectText(opts),
      { rootSelector: o.selector, maxItems: o.maxTextItems },
    );
    const sk = collected.skipped;
    stats.textSkipped = sk.clipped + sk.transparent + sk.hidden + sk.disabled;
    if (sk.transparent)
      notes.push(
        `${sk.transparent} text element(s) with transparent fill (e.g. background-clip: text) were not measured`,
      );
    if (collected.frames.crossOrigin)
      notes.push(`${collected.frames.crossOrigin} cross-origin frame(s) were not measured`);
    if (collected.items.length >= o.maxTextItems)
      notes.push(`stopped after ${o.maxTextItems} text elements`);
    const height = Math.min(collected.docHeight, o.maxPageHeight);
    if (collected.docHeight > o.maxPageHeight) {
      notes.push(`page is ${collected.docHeight}px tall; measured the top ${o.maxPageHeight}px`);
    }
    const width = Math.min(collected.docWidth, viewport * 3);
    const axe = await mapAxe(page, axeRaw);
    if (axeRaw.error) notes.push(`axe-core failed: ${axeRaw.error}`);

    const normal = await screenshot(page, height, width);
    const texts: MeasuredText[] = [];
    for (const batch of batchItems(collected.items)) {
      const indices = batch.map((b) => b.index);
      await page.evaluate((ids) => (window as unknown as WithApi).__rugby.hide(ids), indices);
      await settle(page);
      const shot = await screenshot(page, height, width);
      await page.evaluate(() => (window as unknown as WithApi).__rugby.restore());
      for (const item of batch) {
        const parsed = tryParseColor(item.color);
        if (!parsed) {
          stats.textSkipped++;
          continue;
        }
        const blend: BlendMode | "normal" = isBlendMode(item.blendMode) ? item.blendMode : "normal";
        const fg = withAlpha(parsed.rgba, item.opacity);
        const s = sampleContrast(shot, item.rects, fg, blend);
        if (!s) {
          stats.textSkipped++;
          continue;
        }
        const large = isLargeText(item.fontSizePx, item.fontWeight);
        const required = requiredRatio(o.level, large);
        const apcaReq = apcaRequiredLc(item.fontSizePx, item.fontWeight);
        const wcagPass = s.ratio >= required;
        const apcaPass = Math.abs(s.lc) >= apcaReq.lc;
        const pass =
          o.standard === "wcag2"
            ? wcagPass
            : o.standard === "apca"
              ? apcaPass
              : wcagPass && apcaPass;
        const medianPass = s.median >= required;
        const kind = classifyBackground(s.spread, item.hints);
        const itemNotes: string[] = [];
        if (item.textShadow) itemNotes.push("text-shadow present; contrast measured without it");
        if (item.textStroke)
          itemNotes.push("-webkit-text-stroke present; contrast measured without it");
        if (parsed.gamutMapped) {
          itemNotes.push(
            `text color is ${parsed.space} outside sRGB; gamut-mapped in OKLCH for the contrast math`,
          );
        }
        if (blend !== "normal")
          itemNotes.push(`mix-blend-mode: ${blend}; text color blended per background pixel`);
        if (item.opacity < 0.999)
          itemNotes.push(`effective opacity ${roundRatio(item.opacity)} applied to the text color`);
        if (item.hints.backdropFilter)
          itemNotes.push("behind a backdrop-filter; background measured from rendered pixels");
        if (item.inFrame) itemNotes.push("inside a same-origin iframe");
        if (apcaReq.prohibited)
          itemNotes.push("APCA advises against this font size/weight for text");
        const verdict = axe.verdicts.get(item.index) ?? "not-checked";
        stats.textChecked++;
        stats.axe[verdict]++;
        if (verdict === "incomplete") {
          stats.axeIncompleteResolved++;
          if (!pass) stats.axeIncompleteFailed++;
        }
        if (!pass) {
          stats.contrastFailures++;
          if (verdict !== "fail") stats.axeMissed++;
        }
        const worstBg = fromBytes(...s.worst);
        texts.push({
          index: item.index,
          page: url,
          viewport,
          scheme,
          selector: "",
          text: item.text,
          fontSizePx: roundRatio(item.fontSizePx),
          fontWeight: item.fontWeight,
          largeText: large,
          foreground: toHex(s.renderedFg, { opaque: true }),
          background: {
            kind,
            worst: toHex(worstBg),
            median: toHex(fromBytes(...s.medianBg)),
            sampled: s.count,
          },
          wcag: {
            ratio: roundRatio(s.ratio),
            min: roundRatio(s.min),
            median: roundRatio(s.median),
            required,
            pass: wcagPass,
          },
          apca: { lc: roundLc(s.lc), required: apcaReq.lc, pass: apcaPass },
          axeVerdict: verdict,
          ...(itemNotes.length ? { notes: itemNotes } : {}),
          pass,
          severity: !pass && (kind === "solid" || !medianPass) ? "error" : "warning",
          authored: parsed.rgba,
          opacity: item.opacity,
          blendMode: blend,
          worstBg,
          rects: item.rects,
        });
      }
    }
    // Selectors (and crops) for everything we report.
    const wanted = texts.filter((t) => !t.pass || o.includeChecks);
    const selectors = await page.evaluate(
      (ids) => ids.map((i) => (window as unknown as WithApi).__rugby.selectorFor(i)),
      wanted.map((t) => t.index),
    );
    wanted.forEach((t, i) => {
      t.selector = selectors[i]!;
    });
    if (o.reportDir) for (const t of texts) if (!t.pass) t.crop = cropFinding(normal, t.rects);
    const extra = hooks.afterMeasure ? await hooks.afterMeasure(page, scheme) : undefined;
    return {
      page: { url, viewport, scheme, status: "ok", stats, notes },
      texts,
      extra,
    };
  } catch (error) {
    const message = (error as Error).message.split("\n")[0] ?? String(error);
    return {
      page: { url, viewport, scheme, status: "error", error: message, stats, notes },
      texts: [],
    };
  } finally {
    await context.close();
  }
}
