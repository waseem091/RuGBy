/**
 * CSS color parser. Covers every serialization Chromium returns from
 * getComputedStyle (legacy and space-separated rgb(), color(), lab(), lch(),
 * oklab(), oklch()) plus the authoring forms design tokens use (hex, named
 * colors, hsl(), hwb()).
 */
import {
  a98ToLinearSrgb,
  displayP3ToLinearSrgb,
  hslToSrgb,
  hwbToSrgb,
  labToLinearSrgb,
  linearToSrgbVec,
  oklabToSrgb,
  polarToRect,
  prophotoToLinearSrgb,
  rec2020ToLinearSrgb,
  xyzD50ToD65,
  xyzToLinearSrgb,
} from "./convert.js";
import { gamutMapSrgb, inSrgbGamut } from "./gamut.js";
import { NAMED_COLORS } from "./named.js";
import type { ColorSpace, ParsedColor, Rgba, Vec3 } from "./types.js";

export class ColorParseError extends Error {
  override name = "ColorParseError";
  constructor(
    readonly input: string,
    reason: string,
  ) {
    super(`Could not parse "${input}" as a CSS color: ${reason}`);
  }
}

export interface ParseOptions {
  /** Value used for `currentColor`. Without it, `currentColor` is an error. */
  currentColor?: Rgba;
  /**
   * Accept bare HSL channel triplets such as `222.2 84% 4.9%`, the convention
   * shadcn/ui uses for custom properties consumed as `hsl(var(--x))`.
   */
  bareHsl?: boolean;
}

interface Component {
  /** Numeric value; NaN for `none`. */
  value: number;
  unit: "" | "%" | "deg";
}

const NUMBER_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/;

function component(raw: string, input: string): Component {
  if (raw === "none") return { value: Number.NaN, unit: "" };
  const m = NUMBER_RE.exec(raw);
  if (!m) throw new ColorParseError(input, `unexpected token "${raw}"`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "%") return { value: n, unit: "%" };
  if (unit === "deg") return { value: n, unit: "deg" };
  if (unit === "rad") return { value: (n * 180) / Math.PI, unit: "deg" };
  if (unit === "grad") return { value: n * 0.9, unit: "deg" };
  if (unit === "turn") return { value: n * 360, unit: "deg" };
  return { value: n, unit: "" };
}

/** Number or percentage, where 100% maps to `percentScale`. `none` → 0. */
function scalar(c: Component, percentScale: number, input: string, what: string): number {
  if (c.unit === "deg") throw new ColorParseError(input, `${what} cannot be an angle`);
  if (Number.isNaN(c.value)) return 0;
  return c.unit === "%" ? (c.value / 100) * percentScale : c.value;
}

function hue(c: Component, input: string): number {
  if (c.unit === "%") throw new ColorParseError(input, "hue cannot be a percentage");
  return Number.isNaN(c.value) ? 0 : c.value;
}

function alphaOf(c: Component | undefined, input: string): number {
  if (!c) return 1;
  const a = scalar(c, 1, input, "alpha");
  return Math.min(1, Math.max(0, a));
}

function splitArgs(body: string, input: string): { parts: string[]; alpha?: string } {
  const text = body.trim();
  if (text.includes(",")) {
    const parts = text.split(",").map((p) => p.trim());
    if (parts.some((p) => p === "")) throw new ColorParseError(input, "empty argument");
    if (parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3]! };
    return { parts };
  }
  const [main, alpha, extra] = text.split("/");
  if (extra !== undefined) throw new ColorParseError(input, "more than one '/'");
  const parts = main!.trim().split(/\s+/).filter(Boolean);
  const a = alpha?.trim();
  if (alpha !== undefined && !a) throw new ColorParseError(input, "missing alpha after '/'");
  return a ? { parts, alpha: a } : { parts };
}

function expectCount(parts: string[], n: number, input: string, fn: string): void {
  if (parts.length !== n) {
    throw new ColorParseError(input, `${fn}() expects ${n} components, got ${parts.length}`);
  }
}

function finish(unmapped: Vec3, alpha: number, space: ColorSpace): ParsedColor {
  const safe = unmapped.map((c) => (Number.isFinite(c) ? c : 0)) as Vec3;
  const gamutMapped = !inSrgbGamut(safe, 1e-4);
  const [r, g, b] = gamutMapSrgb(safe);
  return { rgba: { r, g, b, alpha }, space, gamutMapped, unmapped: safe };
}

function parseHex(hex: string, input: string): ParsedColor {
  if (!/^[0-9a-f]+$/.test(hex) || ![3, 4, 6, 8].includes(hex.length)) {
    throw new ColorParseError(input, "hex colors need 3, 4, 6 or 8 hex digits");
  }
  const full =
    hex.length <= 4
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
  return finish([n(0), n(2), n(4)], full.length === 8 ? n(6) : 1, "srgb");
}

const PREDEFINED: Record<string, (v: Vec3) => Vec3> = {
  srgb: (v) => v,
  "srgb-linear": (v) => linearToSrgbVec(v),
  "display-p3": (v) => linearToSrgbVec(displayP3ToLinearSrgb(v)),
  "a98-rgb": (v) => linearToSrgbVec(a98ToLinearSrgb(v)),
  "prophoto-rgb": (v) => linearToSrgbVec(prophotoToLinearSrgb(v)),
  rec2020: (v) => linearToSrgbVec(rec2020ToLinearSrgb(v)),
  xyz: (v) => linearToSrgbVec(xyzToLinearSrgb(v)),
  "xyz-d65": (v) => linearToSrgbVec(xyzToLinearSrgb(v)),
  "xyz-d50": (v) => linearToSrgbVec(xyzToLinearSrgb(xyzD50ToD65(v))),
};

function parseFunction(fn: string, body: string, input: string): ParsedColor {
  const { parts, alpha: alphaRaw } = splitArgs(body, input);
  const alpha = alphaOf(alphaRaw === undefined ? undefined : component(alphaRaw, input), input);
  switch (fn) {
    case "rgb":
    case "rgba": {
      expectCount(parts, 3, input, fn);
      const c = parts.map((p) => scalar(component(p, input), 255, input, "channel") / 255);
      return finish([c[0]!, c[1]!, c[2]!], alpha, "srgb");
    }
    case "hsl":
    case "hsla": {
      expectCount(parts, 3, input, fn);
      const h = hue(component(parts[0]!, input), input);
      const s = scalar(component(parts[1]!, input), 100, input, "saturation") / 100;
      const l = scalar(component(parts[2]!, input), 100, input, "lightness") / 100;
      return finish(hslToSrgb(h, Math.max(0, s), l), alpha, "hsl");
    }
    case "hwb": {
      expectCount(parts, 3, input, fn);
      const h = hue(component(parts[0]!, input), input);
      const w = scalar(component(parts[1]!, input), 100, input, "whiteness") / 100;
      const b = scalar(component(parts[2]!, input), 100, input, "blackness") / 100;
      return finish(hwbToSrgb(h, w, b), alpha, "hwb");
    }
    case "lab":
    case "lch": {
      expectCount(parts, 3, input, fn);
      const l = scalar(component(parts[0]!, input), 100, input, "lightness");
      let lab: Vec3;
      if (fn === "lab") {
        const a = scalar(component(parts[1]!, input), 125, input, "a");
        const b = scalar(component(parts[2]!, input), 125, input, "b");
        lab = [l, a, b];
      } else {
        const c = scalar(component(parts[1]!, input), 150, input, "chroma");
        lab = polarToRect(l, Math.max(0, c), hue(component(parts[2]!, input), input));
      }
      return finish(linearToSrgbVec(labToLinearSrgb(lab)), alpha, fn);
    }
    case "oklab":
    case "oklch": {
      expectCount(parts, 3, input, fn);
      const l = scalar(component(parts[0]!, input), 1, input, "lightness");
      let a: number;
      let b: number;
      if (fn === "oklab") {
        a = scalar(component(parts[1]!, input), 0.4, input, "a");
        b = scalar(component(parts[2]!, input), 0.4, input, "b");
      } else {
        const c = Math.max(0, scalar(component(parts[1]!, input), 0.4, input, "chroma"));
        [, a, b] = polarToRect(l, c, hue(component(parts[2]!, input), input));
      }
      return finish(oklabToSrgb({ l, a, b }), alpha, fn);
    }
    case "color": {
      const [space, ...rest] = parts;
      const convert = space ? PREDEFINED[space] : undefined;
      if (!space || !convert) {
        throw new ColorParseError(input, `unsupported color() space "${space ?? ""}"`);
      }
      expectCount(rest, 3, input, `color(${space})`);
      const v = rest.map((p) => scalar(component(p, input), 1, input, "channel")) as Vec3;
      const resolvedSpace: ColorSpace =
        space === "xyz" ? "xyz-d65" : (space as Exclude<ColorSpace, "hsl">);
      return finish(convert(v), alpha, resolvedSpace);
    }
    default:
      throw new ColorParseError(input, `unsupported color function ${fn}()`);
  }
}

const BARE_HSL_RE =
  /^([+-]?(?:\d+\.?\d*|\.\d+))(deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/;

/** Parse a CSS color. Throws {@link ColorParseError} with an actionable message. */
export function parseColor(input: string, options: ParseOptions = {}): ParsedColor {
  const text = input.trim().toLowerCase();
  if (!text) throw new ColorParseError(input, "empty value");
  if (text.startsWith("#")) return parseHex(text.slice(1), input);
  if (text === "transparent") return finish([0, 0, 0], 0, "srgb");
  if (text === "currentcolor") {
    if (!options.currentColor) {
      throw new ColorParseError(input, "currentColor needs a context color");
    }
    const c = options.currentColor;
    return finish([c.r, c.g, c.b], c.alpha, "srgb");
  }
  const named = NAMED_COLORS.get(text);
  if (named !== undefined) {
    return finish(
      [(named >> 16) / 255, ((named >> 8) & 0xff) / 255, (named & 0xff) / 255],
      1,
      "srgb",
    );
  }
  if (/\b(var|calc|color-mix|env|attr)\(/.test(text)) {
    throw new ColorParseError(input, "unresolved var()/calc()/color-mix(); pass a computed value");
  }
  const fn = /^([a-z-]+)\(([^()]*)\)$/.exec(text);
  if (fn) return parseFunction(fn[1]!, fn[2]!, input);
  if (options.bareHsl) {
    const m = BARE_HSL_RE.exec(text);
    if (m)
      return parseFunction("hsl", `${m[1]} ${m[3]}% ${m[4]}%${m[5] ? ` / ${m[5]}` : ""}`, input);
  }
  throw new ColorParseError(input, "expected a CSS color");
}

/** Like {@link parseColor} but returns null instead of throwing. */
export function tryParseColor(input: string, options: ParseOptions = {}): ParsedColor | null {
  try {
    return parseColor(input, options);
  } catch {
    return null;
  }
}

/** Shorthand: parse and return the gamut-mapped sRGB value. */
export function rgba(input: string, options?: ParseOptions): Rgba {
  return parseColor(input, options).rgba;
}
