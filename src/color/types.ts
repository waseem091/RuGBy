/** Three color channels. */
export type Vec3 = [number, number, number];

/** Gamma-encoded sRGB channels in [0, 1] plus straight (non-premultiplied) alpha in [0, 1]. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** OKLab: L in [0, 1], a/b roughly in [-0.4, 0.4]. */
export interface Oklab {
  l: number;
  a: number;
  b: number;
}

/** OKLCH: L in [0, 1], chroma ≥ 0, hue in degrees [0, 360). */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** CSS color spaces RuGBy can read. */
export type ColorSpace =
  | "srgb"
  | "srgb-linear"
  | "display-p3"
  | "a98-rgb"
  | "prophoto-rgb"
  | "rec2020"
  | "xyz-d50"
  | "xyz-d65"
  | "hsl"
  | "hwb"
  | "lab"
  | "lch"
  | "oklab"
  | "oklch";

/** A parsed CSS color, resolved to sRGB. */
export interface ParsedColor {
  /** sRGB after gamut mapping; channels in [0, 1]. This is what contrast math uses. */
  rgba: Rgba;
  /** The color space the CSS value was written in. */
  space: ColorSpace;
  /** True when the value lay outside the sRGB gamut and was gamut-mapped in OKLCH. */
  gamutMapped: boolean;
  /** The value in sRGB coordinates before gamut mapping (channels may fall outside [0, 1]). */
  unmapped: Vec3;
}
