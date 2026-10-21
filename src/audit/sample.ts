/**
 * Pixel-sampled contrast: measure a foreground against every background pixel
 * under a text's line boxes and summarize with percentiles.
 */
import { apcaContrastFromY, apcaY, apcaY8 } from "../color/apca.js";
import { type BlendMode, blendOver, compositeOver } from "../color/composite.js";
import { srgbToOklab } from "../color/convert.js";
import { fromBytes } from "../color/format.js";
import type { Oklab, Rgba } from "../color/types.js";
import { contrastFromLuminance, luminance8, relativeLuminance } from "../color/wcag.js";
import type { RgbaImage } from "../util/png.js";
import type { Rect } from "./page-script.js";

export interface SampleOptions {
  /** Ignore pixels within this ΔE (OKLab ×100) of the foreground: leftover glyph edges. */
  glyphDeltaE?: number;
  /** Subsample above this many pixels (deterministic stride). */
  maxPixels?: number;
  /** Percentile used as the verdict, 0–1. */
  percentile?: number;
}

export interface PixelStats {
  /** Pixels sampled after filtering. */
  count: number;
  /** WCAG ratio at the verdict percentile, plus min and median. */
  ratio: number;
  min: number;
  median: number;
  /** APCA Lc (signed) of the verdict-percentile pixel by |Lc|. */
  lc: number;
  /** Background at the verdict percentile and at the median, as 8-bit RGB. */
  worst: [number, number, number];
  medianBg: [number, number, number];
  /** Rendered text color against the worst background. */
  renderedFg: Rgba;
  /** 95th-percentile ΔE of the background pixels from the median background. */
  spread: number;
  /** The background pixels measured (after the glyph-edge filter), for re-running the math. */
  histogram: Histogram;
}

const oklab8 = (r: number, g: number, b: number): Oklab => srgbToOklab([r / 255, g / 255, b / 255]);
const dE = (a: Oklab, b: Oklab) => Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) * 100;

/** Collect unique pixel offsets covered by the rects, clamped to the image. */
export function pixelsInRects(image: RgbaImage, rects: Rect[]): Uint32Array {
  const seen = new Set<number>();
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(image.width, Math.ceil(r.x + r.w));
    const y1 = Math.min(image.height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) seen.add(y * image.width + x);
  }
  return Uint32Array.from([...seen].sort((a, b) => a - b));
}

/** Rendered text color over an opaque backdrop pixel. */
export function renderText(fg: Rgba, backdrop: Rgba, blend: BlendMode | "normal"): Rgba {
  return blend === "normal" ? compositeOver(fg, backdrop) : blendOver(blend, fg, backdrop);
}

/** Background colors (24-bit ints) with their pixel counts. */
export interface Histogram {
  colors: number[];
  counts: number[];
}

/** Count the colors under `rects`, subsampling large areas with a deterministic stride. */
export function histogramInRects(image: RgbaImage, rects: Rect[], maxPixels = 40_000): Histogram {
  let offsets = pixelsInRects(image, rects);
  if (offsets.length > maxPixels) {
    const stride = offsets.length / maxPixels;
    const sub = new Uint32Array(maxPixels);
    for (let i = 0; i < maxPixels; i++) sub[i] = offsets[Math.floor(i * stride)]!;
    offsets = sub;
  }
  const d = image.data;
  const counts = new Map<number, number>();
  for (const o of offsets) {
    const c = (d[o * 4]! << 16) | (d[o * 4 + 1]! << 8) | d[o * 4 + 2]!;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const colors = [...counts.keys()].sort((a, b) => a - b);
  return { colors, counts: colors.map((c) => counts.get(c)!) };
}

/**
 * Contrast statistics of `fg` (alpha already multiplied by effective opacity)
 * over a background histogram. Returns null for an empty histogram.
 */
export function statsFromHistogram(
  histogram: Histogram,
  fg: Rgba,
  blend: BlendMode | "normal",
  options: SampleOptions = {},
): PixelStats | null {
  const glyphDeltaE = options.glyphDeltaE ?? 1;
  const percentile = options.percentile ?? 0.05;
  if (histogram.colors.length === 0) return null;
  const fgLab = srgbToOklab([fg.r, fg.g, fg.b]);
  const countOf = new Map(histogram.colors.map((c, i) => [c, histogram.counts[i]!]));
  let colors = histogram.colors;
  if (glyphDeltaE > 0) {
    const nearFg = (c: number) => dE(oklab8(c >> 16, (c >> 8) & 255, c & 255), fgLab) < glyphDeltaE;
    const filtered = colors.filter((c) => !nearFg(c));
    // If everything looks like the foreground, the text really is invisible: keep it all.
    if (filtered.length > 0) colors = filtered;
  }
  interface Entry {
    c: number;
    n: number;
    ratio: number;
    lc: number;
  }
  const entries: Entry[] = colors.map((c) => {
    const r = c >> 16;
    const g = (c >> 8) & 255;
    const b = c & 255;
    const bg = fromBytes(r, g, b);
    const text = renderText(fg, bg, blend);
    const lt = relativeLuminance(text);
    const ratio = contrastFromLuminance(lt, luminance8(r, g, b));
    const lc = apcaContrastFromY(apcaY(text), apcaY8(r, g, b));
    return { c, n: countOf.get(c)!, ratio, lc };
  });
  const total = entries.reduce((s, e) => s + e.n, 0);
  const at = (sorted: Entry[], q: number): Entry => {
    const target = Math.floor(q * (total - 1));
    let acc = 0;
    for (const e of sorted) {
      acc += e.n;
      if (acc > target) return e;
    }
    return sorted[sorted.length - 1]!;
  };
  const byRatio = [...entries].sort((a, b) => a.ratio - b.ratio || a.c - b.c);
  const worst = at(byRatio, percentile);
  const median = at(byRatio, 0.5);
  const byLc = [...entries].sort((a, b) => Math.abs(a.lc) - Math.abs(b.lc) || a.c - b.c);
  const worstLc = at(byLc, percentile);
  const rgb = (c: number): [number, number, number] => [c >> 16, (c >> 8) & 255, c & 255];
  const medianLab = oklab8(...rgb(median.c));
  const spreads = entries
    .map((e) => ({ d: dE(oklab8(...rgb(e.c)), medianLab), n: e.n }))
    .sort((a, b) => a.d - b.d);
  let acc = 0;
  let spread = 0;
  for (const s of spreads) {
    acc += s.n;
    spread = s.d;
    if (acc >= 0.95 * total) break;
  }
  const worstBg = fromBytes(...rgb(worst.c));
  return {
    count: total,
    ratio: worst.ratio,
    min: byRatio[0]!.ratio,
    median: median.ratio,
    lc: worstLc.lc,
    worst: rgb(worst.c),
    medianBg: rgb(median.c),
    renderedFg: renderText(fg, worstBg, blend),
    spread,
    histogram: { colors, counts: colors.map((c) => countOf.get(c)!) },
  };
}

/**
 * Measure `fg` (alpha already multiplied by effective opacity) against the
 * background pixels under `rects`. Returns null when no pixels are covered.
 */
export function sampleContrast(
  image: RgbaImage,
  rects: Rect[],
  fg: Rgba,
  blend: BlendMode | "normal",
  options: SampleOptions = {},
): PixelStats | null {
  return statsFromHistogram(histogramInRects(image, rects, options.maxPixels), fg, blend, options);
}

/** Solid when 95% of pixels are within ΔE 2.5 of the median; otherwise use the page's hints. */
export function classifyBackground(
  spread: number,
  hints: { gradient: boolean; image: boolean },
): "solid" | "gradient" | "image" | "mixed" {
  if (spread < 2.5) return "solid";
  if (hints.image) return "image";
  if (hints.gradient) return "gradient";
  return "mixed";
}
