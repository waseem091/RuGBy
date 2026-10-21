/**
 * WCAG 2.x relative luminance, contrast ratio and the AA/AAA thresholds
 * (SC 1.4.3 / 1.4.6), including the large-text exception.
 */
import { SRGB8_TO_LINEAR, srgbToLinear } from "./convert.js";
import type { Rgba } from "./types.js";

export type WcagLevel = "AA" | "AAA";

/**
 * Relative luminance of an opaque sRGB color. Uses the 0.04045 linearization
 * threshold (IEC 61966-2-1); WCAG's published 0.03928 gives identical results
 * for every 8-bit value.
 */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** Relative luminance from 8-bit channels (table lookup; for hot loops). */
export function luminance8(r: number, g: number, b: number): number {
  return 0.2126 * SRGB8_TO_LINEAR[r]! + 0.7152 * SRGB8_TO_LINEAR[g]! + 0.0722 * SRGB8_TO_LINEAR[b]!;
}

/** Contrast ratio from two relative luminances, in [1, 21]. */
export function contrastFromLuminance(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.x contrast ratio between two opaque colors, in [1, 21]. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** Bold means a computed font-weight of 700 or more. */
export const BOLD_WEIGHT = 700;

/** Large text: at least 24px, or at least 18.66px (14pt) when bold. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= BOLD_WEIGHT);
}

/** Minimum contrast ratio for text at a WCAG level. */
export function requiredRatio(level: WcagLevel, largeText: boolean): number {
  if (level === "AAA") return largeText ? 4.5 : 7;
  return largeText ? 3 : 4.5;
}

/** Ratios are compared unrounded: 4.499:1 fails 4.5:1. */
export function passesWcag(ratio: number, level: WcagLevel, largeText: boolean): boolean {
  return ratio >= requiredRatio(level, largeText);
}

/** Round a ratio for display, e.g. 4.478 → 4.48. */
export const roundRatio = (ratio: number): number => Math.round(ratio * 100) / 100;
