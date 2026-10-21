/** Nearest-token matching by OKLab ΔE. */
import { deltaE } from "../color/deltae.js";
import type { Rgba } from "../color/types.js";
import type { ColorToken } from "../tokens/types.js";

export interface TokenMatch {
  token: ColorToken;
  deltaE: number;
}

/** Below this ΔE a color is the token (floating-point and 8-bit rounding noise). */
export const EXACT_DELTA_E = 0.1;
/** Below this ΔE (but not exact) a color is a hard-coded near-copy of a token. */
export const TYPO_DELTA_E = 0.5;

export type MatchStatus = "exact" | "near" | "typo" | "off";

/** Closest opaque token; ties break on token name for determinism. */
export function nearestToken(color: Rgba, tokens: ColorToken[]): TokenMatch | null {
  let best: TokenMatch | null = null;
  for (const token of tokens) {
    if (token.rgba.alpha < 1) continue;
    const d = deltaE(color, token.rgba);
    if (
      !best ||
      d < best.deltaE - 1e-12 ||
      (Math.abs(d - best.deltaE) <= 1e-12 && token.name < best.token.name)
    ) {
      best = { token, deltaE: d };
    }
  }
  return best;
}

/** A token equal to the authored value, alpha included (for translucent tokens such as scrims). */
export function exactRawToken(raw: Rgba, tokens: ColorToken[]): ColorToken | null {
  for (const token of tokens) {
    if (Math.abs(token.rgba.alpha - raw.alpha) > 0.01) continue;
    if (deltaE(raw, token.rgba) < EXACT_DELTA_E) return token;
  }
  return null;
}

export interface Classification {
  status: MatchStatus;
  match: TokenMatch | null;
}

/**
 * Classify a painted color. An unmodified authored value equal to a token is
 * on-token even when translucent. Otherwise the rendered color is compared
 * with opaque tokens: exact (<0.1), likely typo (<0.5, authored opaque values
 * only), near (≤ threshold), or off-token.
 */
export function classifyColor(
  rendered: Rgba,
  raw: Rgba,
  modified: boolean,
  tokens: ColorToken[],
  threshold: number,
): Classification {
  if (!modified) {
    const t = exactRawToken(raw, tokens);
    if (t) return { status: "exact", match: { token: t, deltaE: 0 } };
  }
  const match = nearestToken(rendered, tokens);
  if (!match) return { status: "off", match: null };
  if (match.deltaE < EXACT_DELTA_E) return { status: "exact", match };
  // Only an authored opaque value can be a typo; compositing noise near a token is fine.
  if (match.deltaE < TYPO_DELTA_E)
    return { status: !modified && raw.alpha >= 1 ? "typo" : "near", match };
  if (match.deltaE <= threshold) return { status: "near", match };
  return { status: "off", match };
}
