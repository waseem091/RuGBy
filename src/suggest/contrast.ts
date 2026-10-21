/**
 * Fix suggestions for contrast failures: the token closest to the current
 * text color (same hue family and token group first) that passes against the
 * measured background pixels; else a background token; else, without tokens,
 * the nearest passing lightness.
 */

import { type Histogram, renderText, statsFromHistogram } from "../audit/sample.js";
import type { Scheme, Standard, Suggestion } from "../audit/types.js";
import { apcaContrast, apcaRequiredLc } from "../color/apca.js";
import { type BlendMode, withAlpha } from "../color/composite.js";
import { oklchToSrgb, srgbToOklch } from "../color/convert.js";
import { deltaE } from "../color/deltae.js";
import { quantize, toHex } from "../color/format.js";
import { gamutMapSrgb } from "../color/gamut.js";
import type { Rgba } from "../color/types.js";
import {
  contrastRatio,
  isLargeText,
  requiredRatio,
  roundRatio,
  type WcagLevel,
} from "../color/wcag.js";
import { nearestToken } from "../drift/match.js";
import type { ColorToken } from "../tokens/types.js";

const rgbOf = ([r, g, b]: [number, number, number]) => ({ r, g, b });

export interface ContrastContext {
  /** Authored text color (before opacity). */
  authored: Rgba;
  opacity: number;
  blendMode: BlendMode | "normal";
  histogram: Histogram;
  /** Median background, used when proposing a background token. */
  medianBg: Rgba;
  fontSizePx: number;
  fontWeight: number;
  level: WcagLevel;
  standard: Standard;
  scheme: Scheme;
}

export interface Evaluation {
  ratio: number;
  lc: number;
  pass: boolean;
}

function verdict(ratio: number, lc: number, ctx: ContrastContext): boolean {
  const wcag = ratio >= requiredRatio(ctx.level, isLargeText(ctx.fontSizePx, ctx.fontWeight));
  const apca = Math.abs(lc) >= apcaRequiredLc(ctx.fontSizePx, ctx.fontWeight).lc;
  return ctx.standard === "wcag2" ? wcag : ctx.standard === "apca" ? apca : wcag && apca;
}

/** Re-run the pixel-sampled contrast math with a different text color. */
export function evaluateForeground(fg: Rgba, ctx: ContrastContext): Evaluation {
  const stats = statsFromHistogram(ctx.histogram, withAlpha(fg, ctx.opacity), ctx.blendMode, {
    glyphDeltaE: 0,
  });
  if (!stats) return { ratio: 1, lc: 0, pass: false };
  return { ratio: stats.ratio, lc: stats.lc, pass: verdict(stats.ratio, stats.lc, ctx) };
}

/** Contrast of the current text on a solid replacement background. */
export function evaluateBackground(bg: Rgba, ctx: ContrastContext): Evaluation {
  const text = renderText(withAlpha(ctx.authored, ctx.opacity), bg, ctx.blendMode);
  const ratio = contrastRatio(text, bg);
  const lc = apcaContrast(text, bg);
  return { ratio, lc, pass: verdict(ratio, lc, ctx) };
}

/** Hue family: `neutral` for near-grays, otherwise one of 12 hue sectors. */
export function hueFamily(c: Rgba): string {
  const lch = srgbToOklch([c.r, c.g, c.b]);
  if (lch.c < 0.03) return "neutral";
  return `hue-${Math.floor(((lch.h + 15) % 360) / 30)}`;
}

function eligible(tokens: ColorToken[], scheme: Scheme): ColorToken[] {
  const seen = new Set<string>();
  return tokens.filter((t) => {
    if (t.rgba.alpha < 1 || (t.mode && t.mode !== scheme)) return false;
    const key = `${t.name}|${t.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rank(
  candidate: ColorToken,
  reference: Rgba,
  family: string,
  group: string | undefined,
): number {
  let score = deltaE(candidate.rgba, reference);
  if (hueFamily(candidate.rgba) !== family) score += 10;
  if (group && candidate.group !== group) score += 2;
  return score;
}

function best<T>(items: T[], score: (t: T) => number, name: (t: T) => string): T | undefined {
  let winner: T | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const s = score(item);
    if (
      s < bestScore - 1e-9 ||
      (Math.abs(s - bestScore) <= 1e-9 && winner && name(item) < name(winner))
    ) {
      winner = item;
      bestScore = s;
    }
  }
  return winner;
}

/** Nearest passing color by moving OKLCH lightness only (used when there are no tokens). */
export function adjustLightness(ctx: ContrastContext): Rgba | null {
  const lch = srgbToOklch([ctx.authored.r, ctx.authored.g, ctx.authored.b]);
  // Snap to 8 bits: the hex value is what gets applied, so that is what must pass.
  const tryL = (l: number): Rgba =>
    quantize({ ...rgbOf(gamutMapSrgb(oklchToSrgb({ l, c: lch.c, h: lch.h }))), alpha: 1 });
  const options: Rgba[] = [];
  for (const target of [0, 1]) {
    if (!evaluateForeground(tryL(target), ctx).pass) continue;
    // Binary search the smallest lightness change that passes.
    let lo = lch.l;
    let hi = target;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (evaluateForeground(tryL(mid), ctx).pass) hi = mid;
      else lo = mid;
    }
    options.push(tryL(hi));
  }
  return (
    best(
      options,
      (c) => deltaE(c, ctx.authored),
      (c) => toHex(c),
    ) ?? null
  );
}

export function suggestContrastFix(ctx: ContrastContext, tokens: ColorToken[]): Suggestion | null {
  const pool = eligible(tokens, ctx.scheme);
  const make = (
    target: "foreground" | "background",
    value: Rgba,
    e: Evaluation,
    from: Rgba,
    token?: ColorToken,
  ): Suggestion => ({
    ...(token ? { token: token.name } : {}),
    value: toHex(value, { opaque: true }),
    target,
    ratio: roundRatio(e.ratio),
    lc: Math.round(e.lc * 10) / 10,
    deltaE: Math.round(deltaE(value, from) * 100) / 100,
    replacement: token
      ? `${target === "foreground" ? "color" : "background-color"}: var(${token.cssVar})`
      : `${target === "foreground" ? "color" : "background-color"}: ${toHex(value, { opaque: true })}`,
  });
  if (!pool.length) {
    const adjusted = adjustLightness(ctx);
    return adjusted
      ? make("foreground", adjusted, evaluateForeground(adjusted, ctx), ctx.authored)
      : null;
  }
  const family = hueFamily(ctx.authored);
  const group = nearestToken(ctx.authored, pool)?.token.group;
  const passingFg = pool
    .map((t) => ({ t, e: evaluateForeground(t.rgba, ctx) }))
    .filter((x) => x.e.pass);
  const fg = best(
    passingFg,
    (x) => rank(x.t, ctx.authored, family, group),
    (x) => x.t.name,
  );
  if (fg) return make("foreground", fg.t.rgba, fg.e, ctx.authored, fg.t);
  const bgFamily = hueFamily(ctx.medianBg);
  const bgGroup = nearestToken(ctx.medianBg, pool)?.token.group;
  const passingBg = pool
    .map((t) => ({ t, e: evaluateBackground(t.rgba, ctx) }))
    .filter((x) => x.e.pass);
  const bg = best(
    passingBg,
    (x) => rank(x.t, ctx.medianBg, bgFamily, bgGroup),
    (x) => x.t.name,
  );
  if (bg) return make("background", bg.t.rgba, bg.e, ctx.medianBg, bg.t);
  return null;
}
