/**
 * Compositing (source-over), CSS blend modes and CSS filter functions, all on
 * gamma-encoded sRGB as browsers paint them.
 */
import type { Rgba, Vec3 } from "./types.js";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Return a copy with alpha multiplied by `factor`. */
export function withAlpha(c: Rgba, factor: number): Rgba {
  return { r: c.r, g: c.g, b: c.b, alpha: clamp01(c.alpha * factor) };
}

/** Porter-Duff source-over: `top` painted over `bottom`. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const a = top.alpha + bottom.alpha * (1 - top.alpha);
  if (a <= 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  const mix = (t: number, b: number) => (t * top.alpha + b * bottom.alpha * (1 - top.alpha)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha: a };
}

/** Composite a stack of layers listed bottom-first. */
export function flatten(layers: Rgba[], base: Rgba = { r: 1, g: 1, b: 1, alpha: 1 }): Rgba {
  return layers.reduce((acc, layer) => compositeOver(layer, acc), base);
}

// ---------------------------------------------------------------------------
// Blend modes (Compositing and Blending Level 1)
// ---------------------------------------------------------------------------

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "plus-lighter",
  "plus-darker",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export function isBlendMode(value: string): value is BlendMode {
  return (BLEND_MODES as readonly string[]).includes(value);
}

function separable(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case "multiply":
      return cb * cs;
    case "screen":
      return cb + cs - cb * cs;
    case "overlay":
      return separable("hard-light", cs, cb);
    case "darken":
      return Math.min(cb, cs);
    case "lighten":
      return Math.max(cb, cs);
    case "color-dodge":
      if (cb === 0) return 0;
      if (cs >= 1) return 1;
      return Math.min(1, cb / (1 - cs));
    case "color-burn":
      if (cb >= 1) return 1;
      if (cs <= 0) return 0;
      return 1 - Math.min(1, (1 - cb) / cs);
    case "hard-light":
      return cs <= 0.5 ? cb * 2 * cs : separable("screen", cb, 2 * cs - 1);
    case "soft-light": {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case "difference":
      return Math.abs(cb - cs);
    case "exclusion":
      return cb + cs - 2 * cb * cs;
    case "plus-lighter":
      return Math.min(1, cb + cs);
    case "plus-darker":
      return Math.max(0, 1 - (1 - cb + (1 - cs)));
    default:
      return cs;
  }
}

const lum = (c: Vec3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: Vec3): Vec3 {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as Vec3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as Vec3;
  return out;
}
function setLum(c: Vec3, l: number): Vec3 {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}
const sat = (c: Vec3) => Math.max(...c) - Math.min(...c);
function setSat(c: Vec3, s: number): Vec3 {
  const max = Math.max(...c);
  const min = Math.min(...c);
  if (max === min) return [0, 0, 0];
  return c.map((v) => ((v - min) * s) / (max - min)) as Vec3;
}

function nonSeparable(mode: BlendMode, cb: Vec3, cs: Vec3): Vec3 {
  switch (mode) {
    case "hue":
      return setLum(setSat(cs, sat(cb)), lum(cb));
    case "saturation":
      return setLum(setSat(cb, sat(cs)), lum(cb));
    case "color":
      return setLum(cs, lum(cb));
    case "luminosity":
      return setLum(cb, lum(cs));
    default:
      return cs;
  }
}

/**
 * Blend `source` onto an opaque `backdrop` with a CSS mix-blend-mode, then
 * composite by the source alpha. Returns an opaque color.
 */
export function blendOver(mode: BlendMode, source: Rgba, backdrop: Rgba): Rgba {
  const cb: Vec3 = [backdrop.r, backdrop.g, backdrop.b];
  const cs: Vec3 = [source.r, source.g, source.b];
  let mixed: Vec3;
  if (mode === "hue" || mode === "saturation" || mode === "color" || mode === "luminosity") {
    mixed = nonSeparable(mode, cb, cs);
  } else {
    mixed = [0, 1, 2].map((i) => separable(mode, cb[i]!, cs[i]!)) as Vec3;
  }
  const blended: Rgba = { r: mixed[0], g: mixed[1], b: mixed[2], alpha: source.alpha };
  return compositeOver(blended, { ...backdrop, alpha: 1 });
}

// ---------------------------------------------------------------------------
// CSS filter functions (Filter Effects Level 1)
// ---------------------------------------------------------------------------

export interface FilterFunction {
  name: string;
  amount: number;
}

/** Parse a computed `filter` value into the color-affecting functions it contains. */
export function parseFilter(value: string): FilterFunction[] {
  if (!value || value === "none") return [];
  const out: FilterFunction[] = [];
  const re = /([a-z-]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  for (const m of value.toLowerCase().matchAll(re)) {
    const name = m[1]!;
    const arg = m[2]!.trim();
    if (name === "blur" || name === "drop-shadow" || name === "url") continue;
    let amount: number;
    if (name === "hue-rotate") {
      const a = /^([+-]?[\d.]+)(deg|rad|grad|turn)?$/.exec(arg);
      const n = a ? Number(a[1]) : 0;
      const unit = a?.[2];
      amount =
        unit === "rad"
          ? (n * 180) / Math.PI
          : unit === "turn"
            ? n * 360
            : unit === "grad"
              ? n * 0.9
              : n;
    } else {
      const a = /^([+-]?[\d.]+)(%)?$/.exec(arg);
      amount = arg === "" ? 1 : a ? Number(a[1]) / (a[2] ? 100 : 1) : 1;
    }
    out.push({ name, amount });
  }
  return out;
}

function applyMatrix(m: number[][], c: Vec3): Vec3 {
  return [0, 1, 2].map((i) =>
    clamp01(m[i]![0]! * c[0] + m[i]![1]! * c[1] + m[i]![2]! * c[2]),
  ) as Vec3;
}

function applyOne(f: FilterFunction, color: Rgba): Rgba {
  const c: Vec3 = [color.r, color.g, color.b];
  let out: Vec3 = c;
  let alpha = color.alpha;
  switch (f.name) {
    case "brightness":
      out = c.map((v) => clamp01(v * f.amount)) as Vec3;
      break;
    case "contrast":
      out = c.map((v) => clamp01((v - 0.5) * f.amount + 0.5)) as Vec3;
      break;
    case "invert": {
      const a = clamp01(f.amount);
      out = c.map((v) => clamp01(a * (1 - v) + (1 - a) * v)) as Vec3;
      break;
    }
    case "opacity":
      alpha = clamp01(alpha * clamp01(f.amount));
      break;
    case "grayscale": {
      const s = 1 - clamp01(f.amount);
      out = applyMatrix(
        [
          [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s],
          [0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s],
          [0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s],
        ],
        c,
      );
      break;
    }
    case "sepia": {
      const s = 1 - clamp01(f.amount);
      out = applyMatrix(
        [
          [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s],
          [0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s],
          [0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s],
        ],
        c,
      );
      break;
    }
    case "saturate": {
      const s = Math.max(0, f.amount);
      out = applyMatrix(
        [
          [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
          [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
          [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
        ],
        c,
      );
      break;
    }
    case "hue-rotate": {
      const t = (f.amount * Math.PI) / 180;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      out = applyMatrix(
        [
          [
            0.213 + cos * 0.787 - sin * 0.213,
            0.715 - cos * 0.715 - sin * 0.715,
            0.072 - cos * 0.072 + sin * 0.928,
          ],
          [
            0.213 - cos * 0.213 + sin * 0.143,
            0.715 + cos * 0.285 + sin * 0.14,
            0.072 - cos * 0.072 - sin * 0.283,
          ],
          [
            0.213 - cos * 0.213 - sin * 0.787,
            0.715 - cos * 0.715 + sin * 0.715,
            0.072 + cos * 0.928 + sin * 0.072,
          ],
        ],
        c,
      );
      break;
    }
    default:
      break;
  }
  return { r: out[0], g: out[1], b: out[2], alpha };
}

/** Apply a filter chain (in order) to a color. */
export function applyFilters(color: Rgba, filters: FilterFunction[]): Rgba {
  return filters.reduce((acc, f) => applyOne(f, acc), color);
}
