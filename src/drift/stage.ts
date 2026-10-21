/**
 * Drift detection: collect every painted color, composite it to what the
 * browser renders, match it to the nearest token, and trace off-token colors
 * to the CSS rule that produced them.
 */
import type { Page } from "playwright-core";
import type { ColorCollectResult, PageApi } from "../audit/page-script.js";
import type { DriftFinding, Scheme, Suggestion, TokenUsage } from "../audit/types.js";
import { toHex } from "../color/format.js";
import type { Rgba } from "../color/types.js";
import { tokensFromComputedProperties } from "../tokens/css.js";
import { buildSet } from "../tokens/normalize.js";
import type { ColorToken, TokenSet } from "../tokens/types.js";
import { classifyColor, type MatchStatus, type TokenMatch } from "./match.js";
import { renderColor } from "./render.js";
import { type SourceInfo, Tracer } from "./trace.js";

type WithApi = Window & { __rugby: PageApi };

export interface DriftEntry {
  index: number;
  property: string;
  value: string;
  rendered: Rgba;
  status: Exclude<MatchStatus, "exact" | "near">;
  match: TokenMatch | null;
  causes: string[];
  source: SourceInfo | null;
  selector: string;
}

export interface DriftStateData {
  entries: DriftEntry[];
  /** token name → elements painted with it (exact or within the threshold). */
  used: Map<string, number>;
  notes: string[];
  /** Tokens read from the page's :root, when no token file was given. */
  pageTokens?: ColorToken[];
}

export interface DriftStageOptions {
  selector: string;
  threshold: number;
  maxElements?: number;
  maxTraces?: number;
}

/** Read the page's computed :root custom properties (fallback token source). */
async function rootCustomProperties(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const cs = getComputedStyle(document.documentElement);
    for (let i = 0; i < cs.length; i++) {
      const name = cs.item(i);
      if (name.startsWith("--")) out[name] = cs.getPropertyValue(name).trim();
    }
    return out;
  });
}

export async function measureDrift(
  page: Page,
  scheme: Scheme,
  tokenSet: TokenSet | null,
  options: DriftStageOptions,
): Promise<DriftStateData> {
  const notes: string[] = [];
  let tokens = tokenSet?.tokens ?? [];
  let pageTokens: ColorToken[] | undefined;
  if (!tokenSet) {
    pageTokens = tokensFromComputedProperties(await rootCustomProperties(page), scheme);
    tokens = pageTokens;
  }
  const used = new Map<string, number>();
  if (!tokens.length) {
    notes.push("no design tokens found (pass --tokens); drift detection skipped");
    return { entries: [], used, notes, ...(pageTokens ? { pageTokens } : {}) };
  }
  const collected: ColorCollectResult = await page.evaluate(
    (opts) => (window as unknown as WithApi).__rugby.collectColors(opts),
    { rootSelector: options.selector, maxItems: options.maxElements ?? 8000 },
  );
  if (collected.truncated)
    notes.push(`drift: stopped after ${options.maxElements ?? 8000} elements`);
  const candidates: Omit<DriftEntry, "source" | "selector">[] = [];
  for (const el of collected.elements) {
    for (const [property, value] of el.props) {
      const r = renderColor(property, value, el.node, collected.nodes, collected.canvas);
      if (!r) continue;
      const c = classifyColor(r.rendered, r.raw, r.modified, tokens, options.threshold);
      if (c.status === "exact" || c.status === "near") {
        if (c.match) used.set(c.match.token.name, (used.get(c.match.token.name) ?? 0) + 1);
        continue;
      }
      candidates.push({
        index: el.index,
        property,
        value,
        rendered: r.rendered,
        status: c.status,
        match: c.match,
        causes: r.causes,
      });
    }
  }
  // Trace sources; drop colors that come from the browser's own defaults.
  const maxTraces = options.maxTraces ?? 400;
  let tracer: Tracer | null = null;
  try {
    tracer = await Tracer.create(page);
  } catch (error) {
    notes.push(
      `drift: CSS source tracing unavailable (${(error as Error).message.split("\n")[0]}); reporting selectors only`,
    );
  }
  const entries: Omit<DriftEntry, "selector">[] = [];
  let traced = 0;
  for (const cand of candidates) {
    let source: SourceInfo | null = null;
    if (tracer && traced < maxTraces) {
      traced++;
      source = await tracer.trace(cand.index, cand.property);
      // No author declaration anywhere: an initial value or a user-agent default.
      if (!source || source.origin === "user-agent") continue;
    }
    entries.push({ ...cand, source });
  }
  if (candidates.length > maxTraces)
    notes.push(`drift: traced the first ${maxTraces} off-token colors`);
  await tracer?.close();
  const indices = [...new Set(entries.map((e) => e.index))];
  const selectors = await page.evaluate(
    (ids) => ids.map((i) => (window as unknown as WithApi).__rugby.selectorFor(i, "color")),
    indices,
  );
  const selectorOf = new Map(indices.map((i, k) => [i, selectors[k]!]));
  return {
    entries: entries.map((e) => ({ ...e, selector: selectorOf.get(e.index) ?? "" })),
    used,
    notes,
    ...(pageTokens ? { pageTokens } : {}),
  };
}

// ---------------------------------------------------------------------------
// Grouping and suggestions
// ---------------------------------------------------------------------------

const PREFIX: Record<string, string> = {
  color: "text",
  "background-color": "bg",
  "border-color": "border",
  "border-top-color": "border-t",
  "border-right-color": "border-r",
  "border-bottom-color": "border-b",
  "border-left-color": "border-l",
  "outline-color": "outline",
  "text-decoration-color": "decoration",
  fill: "fill",
  stroke: "stroke",
  "box-shadow": "shadow",
};

/** Tailwind utility name for a token: `color.gray.500` → `gray-500`. */
export function tailwindName(token: ColorToken): string {
  return token.cssVar.replace(/^--color-/, "").replace(/^--/, "");
}

/** Unescape a CSS class selector: `.text-\[\#6b7281\]` → `text-[#6b7281]`. */
function arbitraryClass(selector: string): string | null {
  const m = /\.((?:[a-z0-9:-]|\\.)*-\\\[(?:[^\]\\]|\\.)*\\\])/i.exec(selector);
  return m ? m[1]!.replace(/\\(.)/g, "$1") : null;
}

/** The concrete source edit that replaces an off-token color with a token. */
export function replacementFor(
  entry: Pick<DriftEntry, "property" | "source" | "causes">,
  token: ColorToken,
): string {
  const src = entry.source;
  if (src) {
    const cls = arbitraryClass(src.selector);
    if (cls) {
      const variant = cls.includes(":") ? cls.slice(0, cls.lastIndexOf(":") + 1) : "";
      const utility = cls.slice(variant.length);
      const prefix = utility.slice(0, utility.indexOf("-["));
      return `${cls} → ${variant}${prefix || PREFIX[entry.property] || "text"}-${tailwindName(token)}`;
    }
    const literal = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\([^)]*\)/i.exec(
      src.value,
    );
    if (literal && !entry.causes.some((c) => c.startsWith("opacity") || c.startsWith("filter"))) {
      return `${literal[0]} → var(${token.cssVar})`;
    }
    return `${src.declaration} → ${entry.property}: var(${token.cssVar})${entry.causes.length ? ` (renders ${entry.causes.join(", ")})` : ""}`;
  }
  return `${entry.property}: var(${token.cssVar})`;
}

interface Located extends DriftEntry {
  page: string;
  viewport: number;
  scheme: Scheme;
}

export function groupDrift(entries: Located[]): DriftFinding[] {
  const groups = new Map<string, Located[]>();
  for (const e of entries) {
    const hex = toHex(e.rendered, { opaque: true });
    const src = e.source
      ? `${e.source.rule}|${e.source.stylesheet}|${e.source.line ?? ""}`
      : `selector:${e.selector}`;
    const key = `${hex}|${e.property}|${src}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const findings: (DriftFinding & { rank: number })[] = [];
  for (const list of groups.values()) {
    const e = list[0]!;
    const pages = [...new Set(list.map((x) => x.page))];
    const occurrences = new Set(list.map((x) => `${x.page}|${x.selector}`)).size;
    const match = e.match;
    const likelyTypo = e.status === "typo";
    const suggestion: Suggestion | null = match
      ? {
          token: match.token.name,
          value: match.token.value,
          target: e.property === "background-color" ? "background" : "foreground",
          deltaE: Math.round(match.deltaE * 100) / 100,
          replacement: replacementFor(e, match.token),
        }
      : null;
    findings.push({
      type: "drift",
      severity: e.property === "box-shadow" ? "info" : "warning",
      page: pages[0]!,
      viewports: [...new Set(list.map((x) => x.viewport))].sort((a, b) => a - b),
      schemes: [...new Set(list.map((x) => x.scheme))].sort(),
      color: toHex(e.rendered, { opaque: true }),
      likelyTypo,
      ...(likelyTypo ? { label: "likely-typo" as const } : {}),
      nearestToken: match
        ? {
            name: match.token.name,
            value: match.token.value,
            deltaE: Math.round(match.deltaE * 100) / 100,
          }
        : null,
      property: e.property,
      selectors: [...new Set(list.map((x) => x.selector))].sort().slice(0, 10),
      source: e.source
        ? {
            rule: e.source.rule,
            stylesheet: e.source.stylesheet,
            ...(e.source.line !== undefined ? { line: e.source.line } : {}),
            origin: e.source.origin,
          }
        : null,
      occurrences,
      ...(e.causes.length ? { cause: e.causes } : {}),
      suggestion,
      ...(pages.length > 1 ? { alsoOn: pages.slice(1) } : {}),
      rank: occurrences * (match?.deltaE ?? 100),
    });
  }
  findings.sort(
    (a, b) =>
      b.rank - a.rank ||
      (a.color < b.color ? -1 : a.color > b.color ? 1 : 0) ||
      (a.property < b.property ? -1 : a.property > b.property ? 1 : 0) ||
      (a.selectors[0] ?? "").localeCompare(b.selectors[0] ?? ""),
  );
  return findings.map(({ rank: _rank, ...f }) => f);
}

export function tokenUsage(
  tokens: TokenSet | null,
  used: Map<string, number>,
  drift: DriftFinding[],
): TokenUsage[] {
  if (!tokens) return [];
  const drifted = new Map<string, number>();
  for (const f of drift) {
    if (f.nearestToken)
      drifted.set(f.nearestToken.name, (drifted.get(f.nearestToken.name) ?? 0) + f.occurrences);
  }
  const seen = new Set<string>();
  const out: TokenUsage[] = [];
  for (const t of tokens.tokens) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push({
      name: t.name,
      value: t.value,
      ...(t.mode ? { mode: t.mode } : {}),
      used: used.get(t.name) ?? 0,
      drifted: drifted.get(t.name) ?? 0,
    });
  }
  return out;
}

/** Build a TokenSet from page custom properties gathered across states. */
export function pageTokenSet(source: string, tokens: ColorToken[]): TokenSet | null {
  return tokens.length ? buildSet("page", source, tokens) : null;
}
