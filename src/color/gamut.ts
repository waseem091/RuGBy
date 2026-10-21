/**
 * Gamut mapping to sRGB using the CSS Color 4 algorithm: reduce OKLCH chroma by
 * binary search until the clipped color is within a just-noticeable difference.
 */
import { oklabToOklch, oklchToSrgb, srgbToOklab } from "./convert.js";
import type { Vec3 } from "./types.js";

const GAMUT_EPSILON = 1e-6;

export function inSrgbGamut(rgb: Vec3, epsilon = GAMUT_EPSILON): boolean {
  return rgb.every((c) => c >= -epsilon && c <= 1 + epsilon);
}

export function clipSrgb(rgb: Vec3): Vec3 {
  return rgb.map((c) => Math.min(1, Math.max(0, Number.isNaN(c) ? 0 : c))) as Vec3;
}

/** Unscaled ΔEOK (Euclidean distance in OKLab, roughly 0..1). */
function deltaEOKRaw(a: Vec3, b: Vec3): number {
  const la = srgbToOklab(a);
  const lb = srgbToOklab(b);
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
}

/**
 * Map a gamma-encoded sRGB value (possibly out of gamut) into the sRGB gamut,
 * preserving OKLCH lightness and hue.
 */
export function gamutMapSrgb(rgb: Vec3): Vec3 {
  if (inSrgbGamut(rgb)) return clipSrgb(rgb);
  const origin = oklabToOklch(srgbToOklab(rgb));
  if (origin.l >= 1) return [1, 1, 1];
  if (origin.l <= 0) return [0, 0, 0];
  const JND = 0.02;
  const EPS = 0.0001;
  let clipped = clipSrgb(rgb);
  if (deltaEOKRaw(clipped, rgb) < JND) return clipped;
  let min = 0;
  let max = origin.c;
  let minInGamut = true;
  while (max - min > EPS) {
    const chroma = (min + max) / 2;
    const current = oklchToSrgb({ l: origin.l, c: chroma, h: origin.h });
    if (minInGamut && inSrgbGamut(current)) {
      min = chroma;
      continue;
    }
    clipped = clipSrgb(current);
    const e = deltaEOKRaw(clipped, current);
    if (e < JND) {
      if (JND - e < EPS) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}
