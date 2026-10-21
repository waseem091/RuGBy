/** One-off contrast check between two CSS colors (backs `rugby contrast` and `rugby_contrast`). */
import { apcaContrast, apcaRequiredLc, roundLc } from "./color/apca.js";
import { compositeOver } from "./color/composite.js";
import { toHex } from "./color/format.js";
import { parseColor } from "./color/parse.js";
import {
  contrastRatio,
  isLargeText,
  requiredRatio,
  roundRatio,
  type WcagLevel,
} from "./color/wcag.js";

export interface ContrastCheckOptions {
  fontSizePx?: number;
  fontWeight?: number;
  level?: WcagLevel;
}

export interface ContrastCheck {
  foreground: string;
  background: string;
  fontSizePx: number;
  fontWeight: number;
  largeText: boolean;
  wcag: {
    ratio: number;
    required: number;
    pass: boolean;
    AA: { normal: boolean; large: boolean };
    AAA: { normal: boolean; large: boolean };
  };
  apca: { lc: number; required: number; pass: boolean; prohibited: boolean };
  notes: string[];
}

const WHITE = { r: 1, g: 1, b: 1, alpha: 1 };

export function checkContrast(
  foreground: string,
  background: string,
  options: ContrastCheckOptions = {},
): ContrastCheck {
  const fontSizePx = options.fontSizePx ?? 16;
  const fontWeight = options.fontWeight ?? 400;
  const level = options.level ?? "AA";
  const notes: string[] = [];
  const fgParsed = parseColor(foreground);
  const bgParsed = parseColor(background);
  for (const [label, p] of [
    ["foreground", fgParsed],
    ["background", bgParsed],
  ] as const) {
    if (p.gamutMapped) notes.push(`${label} is outside sRGB (${p.space}); gamut-mapped in OKLCH`);
  }
  let bg = bgParsed.rgba;
  if (bg.alpha < 1) {
    notes.push("background is translucent; composited over white");
    bg = compositeOver(bg, WHITE);
  }
  let fg = fgParsed.rgba;
  if (fg.alpha < 1) {
    notes.push("foreground is translucent; composited over the background");
    fg = compositeOver(fg, bg);
  }
  const ratio = contrastRatio(fg, bg);
  const large = isLargeText(fontSizePx, fontWeight);
  const required = requiredRatio(level, large);
  const lc = apcaContrast(fg, bg);
  const req = apcaRequiredLc(fontSizePx, fontWeight);
  return {
    foreground: toHex(fg),
    background: toHex(bg),
    fontSizePx,
    fontWeight,
    largeText: large,
    wcag: {
      ratio: roundRatio(ratio),
      required,
      pass: ratio >= required,
      AA: { normal: ratio >= 4.5, large: ratio >= 3 },
      AAA: { normal: ratio >= 7, large: ratio >= 4.5 },
    },
    apca: {
      lc: roundLc(lc),
      required: req.lc,
      pass: Math.abs(lc) >= req.lc,
      prohibited: req.prohibited,
    },
    notes,
  };
}
