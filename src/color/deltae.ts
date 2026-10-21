import { srgbToOklab } from "./convert.js";
import type { Oklab, Rgba } from "./types.js";

/** ΔE in OKLab: Euclidean distance scaled ×100 (so ~1 is a just-noticeable difference). */
export function deltaEOK(a: Oklab, b: Oklab): number {
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) * 100;
}

/** OKLab of an sRGB color (alpha ignored). */
export function oklabOf(c: Rgba): Oklab {
  return srgbToOklab([c.r, c.g, c.b]);
}

/** ΔE (OKLab ×100) between two opaque sRGB colors. Alpha is ignored. */
export function deltaE(a: Rgba, b: Rgba): number {
  return deltaEOK(oklabOf(a), oklabOf(b));
}
