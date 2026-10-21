import { blend as culoriBlend, converter, differenceEuclidean } from "culori";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  BLEND_MODES,
  blendOver,
  compositeOver,
  deltaE,
  deltaEOK,
  flatten,
  fromBytes,
  isBlendMode,
  oklabOf,
  parseFilter,
  quantize,
  rgba,
  toHex,
  toRgbString,
  withAlpha,
} from "../../src/color/index.js";

describe("compositing", () => {
  it("source-over on an opaque backdrop", () => {
    const out = compositeOver({ r: 0, g: 0, b: 0, alpha: 0.5 }, rgba("#fff"));
    expect(toHex(out)).toBe("#808080");
    expect(out.alpha).toBe(1);
  });
  it("source-over of two translucent layers", () => {
    const out = compositeOver(rgba("rgb(255 0 0 / 0.5)"), rgba("rgb(0 0 255 / 0.5)"));
    expect(out.alpha).toBeCloseTo(0.75, 12);
    expect(out.r).toBeCloseTo(2 / 3, 12);
    expect(out.b).toBeCloseTo(1 / 3, 12);
  });
  it("fully transparent stays transparent", () => {
    expect(compositeOver(rgba("transparent"), rgba("transparent")).alpha).toBe(0);
  });
  it("flattens a layer stack bottom-first over white", () => {
    expect(toHex(flatten([rgba("rgb(0 0 0 / 0.5)"), rgba("rgb(0 0 0 / 0.5)")]))).toBe("#404040");
  });
  it("withAlpha multiplies and clamps", () => {
    expect(withAlpha(rgba("rgb(0 0 0 / 0.5)"), 0.5).alpha).toBe(0.25);
    expect(withAlpha(rgba("#000"), 3).alpha).toBe(1);
  });
});

describe("blend modes", () => {
  // culori's hard-light/overlay formulas are wrong (`2s(1-b)-1` instead of Screen), so those
  // two are checked against the spec formula below instead.
  const separable = [
    "normal",
    "multiply",
    "screen",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "soft-light",
    "difference",
    "exclusion",
  ] as const;
  const toRgb = converter("rgb");
  const pairs = [
    ["#204080", "#c0a060"],
    ["#ffffff", "#336699"],
    ["#000000", "#ff8800"],
    ["#808080", "#101010"],
    ["#ffee00", "#ffffff"],
    ["#3a3a3a", "#000000"],
  ];
  it.each(separable)("%s matches culori", (mode) => {
    for (const [backdrop, source] of pairs) {
      const ours = blendOver(mode, rgba(source!), rgba(backdrop!));
      const theirs = toRgb(culoriBlend([backdrop!, source!], mode));
      expect(ours.r).toBeCloseTo(theirs.r, 9);
      expect(ours.g).toBeCloseTo(theirs.g, 9);
      expect(ours.b).toBeCloseTo(theirs.b, 9);
    }
  });

  it("hard-light and overlay follow the spec", () => {
    const screen = (b: number, s: number) => b + s - b * s;
    const hard = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : screen(b, 2 * s - 1));
    for (const [backdrop, source] of pairs) {
      const cb = rgba(backdrop!);
      const cs = rgba(source!);
      const h = blendOver("hard-light", cs, cb);
      const o = blendOver("overlay", cs, cb);
      expect(h.r).toBeCloseTo(hard(cb.r, cs.r), 12);
      expect(h.b).toBeCloseTo(hard(cb.b, cs.b), 12);
      expect(o.g).toBeCloseTo(hard(cs.g, cb.g), 12);
    }
  });

  it("difference of white text over a mid-gray backdrop", () => {
    expect(toHex(blendOver("difference", rgba("#fff"), rgba("#404040")))).toBe("#BFBFBF");
  });

  it("respects source alpha", () => {
    const out = blendOver("difference", rgba("rgb(255 255 255 / 0.5)"), rgba("#000"));
    expect(toHex(out)).toBe("#808080");
  });

  it("non-separable modes behave per spec", () => {
    const cb = rgba("#336699");
    const cs = rgba("#cc3300");
    const luminosity = blendOver("luminosity", cs, cb);
    const color = blendOver("color", cs, cb);
    const lum = (c: { r: number; g: number; b: number }) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    expect(lum(luminosity)).toBeCloseTo(lum(cs), 6);
    expect(lum(color)).toBeCloseTo(lum(cb), 6);
    const hue = blendOver("hue", cs, cb);
    const saturation = blendOver("saturation", cs, cb);
    expect(lum(hue)).toBeCloseTo(lum(cb), 6);
    expect(lum(saturation)).toBeCloseTo(lum(cb), 6);
    expect(toHex(blendOver("saturation", rgba("#808080"), cb))).toBe("#5C5C5C");
  });

  it("plus-lighter / plus-darker clamp", () => {
    expect(toHex(blendOver("plus-lighter", rgba("#808080"), rgba("#c0c0c0")))).toBe("#FFFFFF");
    expect(toHex(blendOver("plus-darker", rgba("#404040"), rgba("#404040")))).toBe("#000000");
  });

  it("clips out-of-range non-separable results", () => {
    const out = blendOver("color", rgba("#00ff00"), rgba("#ffffff"));
    for (const c of [out.r, out.g, out.b]) {
      expect(c).toBeGreaterThanOrEqual(-1e-9);
      expect(c).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(toHex(blendOver("luminosity", rgba("#000"), rgba("#ff0000")))).toBe("#000000");
  });

  it("lists and validates modes", () => {
    expect(BLEND_MODES).toContain("difference");
    expect(isBlendMode("difference")).toBe(true);
    expect(isBlendMode("dissolve")).toBe(false);
  });
});

describe("CSS filters", () => {
  it("parses computed filter values", () => {
    expect(parseFilter("none")).toEqual([]);
    expect(parseFilter("brightness(0.8) contrast(120%) blur(2px) hue-rotate(0.5turn)")).toEqual([
      { name: "brightness", amount: 0.8 },
      { name: "contrast", amount: 1.2 },
      { name: "hue-rotate", amount: 180 },
    ]);
    expect(parseFilter("drop-shadow(rgb(0, 0, 0) 1px 1px 2px) invert(1)")).toEqual([
      { name: "invert", amount: 1 },
    ]);
    expect(parseFilter("hue-rotate(3.14159rad) sepia()")[0]!.amount).toBeCloseTo(180, 3);
    expect(parseFilter("hue-rotate(100grad)")[0]!.amount).toBeCloseTo(90, 9);
  });

  it.each([
    ["brightness(0.5)", "#ff8040", "#804020"],
    ["contrast(0)", "#123456", "#808080"],
    ["invert(1)", "#000000", "#FFFFFF"],
    ["invert(0.5)", "#000000", "#808080"],
    ["grayscale(1)", "#ff0000", "#363636"],
    ["grayscale(0)", "#ff0000", "#FF0000"],
    ["sepia(1)", "#ffffff", "#FFFFEF"],
    ["saturate(0)", "#00ff00", "#B6B6B6"],
    ["saturate(1)", "#336699", "#336699"],
    ["hue-rotate(0deg)", "#336699", "#336699"],
    ["hue-rotate(180deg)", "#ff0000", "#006D6D"],
  ])("%s turns %s into %s", (filter, input, expected) => {
    expect(toHex(applyFilters(rgba(input), parseFilter(filter)))).toBe(expected);
  });

  it("opacity() reduces alpha", () => {
    expect(applyFilters(rgba("#000"), parseFilter("opacity(0.25)")).alpha).toBe(0.25);
  });

  it("ignores unknown functions", () => {
    expect(toHex(applyFilters(rgba("#123456"), [{ name: "bogus", amount: 1 }]))).toBe("#123456");
  });
});

describe("ΔE and formatting", () => {
  it("ΔEOK matches culori's euclidean OKLab difference ×100", () => {
    const de = differenceEuclidean("oklab");
    for (const [a, b] of [
      ["#6b7280", "#6b7281"],
      ["#000", "#fff"],
      ["#ff0000", "#00ff00"],
    ]) {
      expect(deltaE(rgba(a!), rgba(b!))).toBeCloseTo(de(a!, b!) * 100, 9);
    }
    expect(deltaEOK(oklabOf(rgba("#fff")), oklabOf(rgba("#000")))).toBeCloseTo(100, 6);
    expect(deltaE(rgba("#6b7280"), rgba("#6b7281"))).toBeLessThan(0.5);
  });

  it("formats hex and rgb strings", () => {
    expect(toHex([1, 0.5, 0])).toBe("#FF8000");
    expect(toHex(rgba("rgb(0 0 0 / 0.5)"), { opaque: true })).toBe("#000000");
    expect(toRgbString(fromBytes(1, 2, 3))).toBe("rgb(1 2 3)");
    expect(toRgbString(fromBytes(1, 2, 3, 128))).toBe("rgb(1 2 3 / 0.502)");
    expect(toHex(quantize({ r: 0.50001, g: 0, b: 1.2, alpha: 1 }))).toBe("#8000FF");
  });
});
