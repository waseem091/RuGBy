import type { Rgba, Vec3 } from "./types.js";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Quantize a [0, 1] channel to 8 bits. */
export const to8 = (c: number): number => Math.round(clamp01(c) * 255);

const hex2 = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();

/** `#RRGGBB`, or `#RRGGBBAA` when alpha < 1 (unless `opaque` is set). */
export function toHex(color: Rgba | Vec3, options: { opaque?: boolean } = {}): string {
  const [r, g, b, a] = Array.isArray(color)
    ? [color[0], color[1], color[2], 1]
    : [color.r, color.g, color.b, color.alpha];
  const base = `#${hex2(to8(r))}${hex2(to8(g))}${hex2(to8(b))}`;
  if (options.opaque || a >= 1) return base;
  return base + hex2(to8(a));
}

/** Build an Rgba from 8-bit channels. */
export function fromBytes(r: number, g: number, b: number, a = 255): Rgba {
  return { r: r / 255, g: g / 255, b: b / 255, alpha: a / 255 };
}

/** Round channels to 8-bit precision, the way a browser stores sRGB colors. */
export function quantize(c: Rgba): Rgba {
  return { r: to8(c.r) / 255, g: to8(c.g) / 255, b: to8(c.b) / 255, alpha: c.alpha };
}

/** `rgb(r g b / a)` with 8-bit channels. */
export function toRgbString(c: Rgba): string {
  const base = `${to8(c.r)} ${to8(c.g)} ${to8(c.b)}`;
  return c.alpha >= 1 ? `rgb(${base})` : `rgb(${base} / ${Number(c.alpha.toFixed(3))})`;
}
