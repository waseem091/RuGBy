import type { Rgba } from "../color/types.js";

/** Where a token set came from. */
export type TokenFormat = "dtcg" | "tailwind" | "css" | "page";

/** One color token, normalized from any supported format. */
export interface ColorToken {
  /** Canonical dotted name, e.g. `color.gray.500`. */
  name: string;
  /** The CSS custom property that carries this token, e.g. `--color-gray-500`. */
  cssVar: string;
  /** Normalized value: `#RRGGBB`, or `#RRGGBBAA` when translucent. */
  value: string;
  /** Exact (gamut-mapped) sRGB value used for matching. */
  rgba: Rgba;
  /** First name segment after any `color`/`colors` prefix, e.g. `gray`. */
  group: string;
  /** Theme mode this value belongs to (`dark`, …); absent when it applies to every mode. */
  mode?: string;
  /** Token this one aliases, when its value was a reference. */
  aliasOf?: string;
  /** True when the authored value was outside sRGB and was gamut-mapped. */
  gamutMapped?: boolean;
}

/** A normalized token set. Tokens are sorted by name, then mode. */
export interface TokenSet {
  format: TokenFormat;
  /** File path(s) or page URL the tokens were read from. */
  source: string;
  tokens: ColorToken[];
  /** Distinct modes, sorted. */
  modes: string[];
  /** Non-fatal problems, e.g. a non-color custom property that was skipped. */
  warnings: string[];
}

/** Raised for token files that cannot be read; the message says what to fix. */
export class TokenError extends Error {
  override name = "TokenError";
}
