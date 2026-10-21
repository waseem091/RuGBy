/**
 * APCA (Accessible Perceptual Contrast Algorithm), version 0.0.98G-4g, as
 * published in apca-w3. Lc is signed: positive for dark text on a light
 * background, negative for light text on a dark background.
 */
import type { Rgba } from "./types.js";

const MAIN_TRC = 2.4;
const R_CO = 0.2126729;
const G_CO = 0.7151522;
const B_CO = 0.072175;
const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;
const BLK_THRS = 0.022;
// biome-ignore lint/suspicious/noApproximativeNumericConstant: APCA specifies exactly 1.414
const BLK_CLMP = 1.414;
const SCALE_BOW = 1.14;
const SCALE_WOB = 1.14;
const LO_BOW_OFFSET = 0.027;
const LO_WOB_OFFSET = 0.027;
const DELTA_Y_MIN = 0.0005;
const LO_CLIP = 0.1;

/** APCA screen luminance Y of an opaque sRGB color (simple 2.4 power curve). */
export function apcaY(c: Rgba): number {
  const lin = (v: number) => Math.max(0, v) ** MAIN_TRC;
  return R_CO * lin(c.r) + G_CO * lin(c.g) + B_CO * lin(c.b);
}

const Y8 = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = (i / 255) ** MAIN_TRC;
  return t;
})();

/** APCA Y from 8-bit channels (table lookup; for hot loops). */
export function apcaY8(r: number, g: number, b: number): number {
  return R_CO * Y8[r]! + G_CO * Y8[g]! + B_CO * Y8[b]!;
}

/** Lc from text and background luminance (apca-w3 `APCAcontrast`). */
export function apcaContrastFromY(textY: number, bgY: number): number {
  if (Number.isNaN(textY) || Number.isNaN(bgY)) return 0;
  if (Math.min(textY, bgY) < 0 || Math.max(textY, bgY) > 1.1) return 0;
  const txt = textY > BLK_THRS ? textY : textY + (BLK_THRS - textY) ** BLK_CLMP;
  const bg = bgY > BLK_THRS ? bgY : bgY + (BLK_THRS - bgY) ** BLK_CLMP;
  if (Math.abs(bg - txt) < DELTA_Y_MIN) return 0;
  let out: number;
  if (bg > txt) {
    const sapc = (bg ** NORM_BG - txt ** NORM_TXT) * SCALE_BOW;
    out = sapc < LO_CLIP ? 0 : sapc - LO_BOW_OFFSET;
  } else {
    const sapc = (bg ** REV_BG - txt ** REV_TXT) * SCALE_WOB;
    out = sapc > -LO_CLIP ? 0 : sapc + LO_WOB_OFFSET;
  }
  return out * 100;
}

/** APCA Lc for opaque text on an opaque background. */
export function apcaContrast(text: Rgba, background: Rgba): number {
  return apcaContrastFromY(apcaY(text), apcaY(background));
}

/**
 * Minimum |Lc| by font size (px) and weight (100–900), from the APCA
 * "font lookup table" for 0.0.98G-4g. `null` marks size/weight pairs APCA
 * says to avoid for text altogether.
 */
const LOOKUP: ReadonlyArray<readonly [number, ReadonlyArray<number | null>]> = [
  [14, [null, null, null, 100, 100, 90, 75, null, null]],
  [15, [null, null, null, 100, 90, 75, 70, null, null]],
  [16, [null, null, null, 90, 75, 70, 60, 60, null]],
  [18, [null, null, 100, 75, 70, 60, 55, 55, 55]],
  [21, [null, null, 90, 70, 60, 55, 50, 50, 50]],
  [24, [null, null, 75, 60, 55, 50, 45, 45, 45]],
  [28, [null, 100, 70, 55, 50, 45, 43, 43, 43]],
  [32, [null, 90, 65, 50, 45, 43, 40, 40, 40]],
  [36, [null, 75, 60, 45, 43, 40, 38, 38, 38]],
  [42, [100, 70, 55, 43, 40, 38, 35, 35, 35]],
  [48, [90, 60, 50, 40, 38, 35, 33, 33, 33]],
  [60, [75, 55, 45, 38, 35, 33, 30, 30, 30]],
  [72, [60, 50, 40, 35, 33, 30, 30, 30, 30]],
  [96, [50, 45, 35, 33, 30, 30, 30, 30, 30]],
];

/** Lc required where the lookup table says the size/weight should not be used for text. */
export const APCA_PROHIBITED_LC = 100;

export interface ApcaRequirement {
  /** Minimum |Lc|. */
  lc: number;
  /** True when APCA advises against this size/weight for text (then `lc` is {@link APCA_PROHIBITED_LC}). */
  prohibited: boolean;
}

/**
 * Minimum |Lc| for text of a given size and weight. Sizes between rows use the
 * next smaller row (conservative); sizes below 14px use the 14px row; weights
 * round to the nearest 100.
 */
export function apcaRequiredLc(fontSizePx: number, fontWeight: number): ApcaRequirement {
  let row = LOOKUP[0]![1];
  for (const [size, values] of LOOKUP) {
    if (fontSizePx + 1e-9 >= size) row = values;
  }
  const col = Math.min(8, Math.max(0, Math.round(fontWeight / 100) - 1));
  const value = row[col];
  if (value === null || value === undefined) return { lc: APCA_PROHIBITED_LC, prohibited: true };
  return { lc: value, prohibited: false };
}

/** Round Lc for display to one decimal. */
export const roundLc = (lc: number): number => Math.round(lc * 10) / 10;
