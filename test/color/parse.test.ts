import { colorsNamed, converter, parse } from "culori";
import { describe, expect, it } from "vitest";
import { ColorParseError, parseColor, toHex, tryParseColor } from "../../src/color/index.js";

const toRgb = converter("rgb");

function culoriRgb(input: string): [number, number, number, number] {
  const c = toRgb(parse(input));
  if (!c) throw new Error(`culori cannot parse ${input}`);
  return [c.r, c.g, c.b, c.alpha ?? 1];
}

describe("parseColor", () => {
  it.each([
    ["#fff", "#FFFFFF"],
    ["#FFF8", "#FFFFFF88"],
    ["#6b7280", "#6B7280"],
    ["#6b728080", "#6B728080"],
    ["rgb(107, 114, 128)", "#6B7280"],
    ["rgba(107, 114, 128, 0.5)", "#6B728080"],
    ["rgb(107 114 128 / 50%)", "#6B728080"],
    ["rgb(100% 0% 0%)", "#FF0000"],
    ["rgba(0, 0, 0, 0)", "#00000000"],
    ["transparent", "#00000000"],
    ["RebeccaPurple", "#663399"],
    ["hsl(120, 100%, 25%)", "#008000"],
    ["hsl(120deg 100% 25% / 1)", "#008000"],
    ["hsla(0.5turn, 100%, 50%, 1)", "#00FFFF"],
    ["hwb(0 0% 0%)", "#FF0000"],
    ["hwb(0 60% 60%)", "#808080"],
    ["color(srgb 1 0.5 0)", "#FF8000"],
    ["color(srgb-linear 1 1 1)", "#FFFFFF"],
    ["oklch(1 0 0)", "#FFFFFF"],
    ["oklab(0 0 0)", "#000000"],
    ["lab(100 0 0)", "#FFFFFF"],
    ["lch(0% 0 0)", "#000000"],
  ])("%s → %s", (input, hex) => {
    expect(toHex(parseColor(input).rgba)).toBe(hex);
  });

  const crossChecked = [
    "rgb(12, 34, 56)",
    "hsl(210 40% 96.1%)",
    "hsl(222.2deg 84% 4.9%)",
    "hwb(200 20% 30%)",
    "lab(52.2345 40.1645 59.9971)",
    "lab(29.69% 56.11 -36.29)",
    "lch(52.2345 72.2 56.2)",
    "lch(70% 45 180 / 0.25)",
    "oklab(0.5 0.1 -0.1)",
    "oklab(59.69% 0.1007 0.1191)",
    "oklch(0.7 0.1 200)",
    "oklch(55.1% 0.027 264.364)",
    "oklch(0.623 0.214 259.815)",
    "color(display-p3 0.2 0.4 0.6)",
    "color(display-p3 0.5 0.5 0.5 / 0.5)",
    "color(a98-rgb 0.3 0.6 0.4)",
    "color(prophoto-rgb 0.4 0.5 0.3)",
    "color(rec2020 0.3 0.5 0.4)",
    "color(xyz-d65 0.2 0.3 0.4)",
    "color(xyz-d50 0.2 0.3 0.25)",
    "color(xyz 0.3 0.3 0.3)",
  ];
  it.each(crossChecked)("matches culori before gamut mapping for %s", (input) => {
    const parsed = parseColor(input);
    const [r, g, b, a] = culoriRgb(input);
    expect(parsed.unmapped[0]).toBeCloseTo(r, 6);
    expect(parsed.unmapped[1]).toBeCloseTo(g, 6);
    expect(parsed.unmapped[2]).toBeCloseTo(b, 6);
    expect(parsed.rgba.alpha).toBeCloseTo(a, 6);
    const inGamut = [r, g, b].every((c) => c >= -1e-4 && c <= 1 + 1e-4);
    expect(parsed.gamutMapped).toBe(!inGamut);
    if (inGamut) {
      expect(parsed.rgba.r).toBeCloseTo(Math.min(1, Math.max(0, r)), 6);
      expect(parsed.rgba.g).toBeCloseTo(Math.min(1, Math.max(0, g)), 6);
      expect(parsed.rgba.b).toBeCloseTo(Math.min(1, Math.max(0, b)), 6);
    }
  });

  it("knows every CSS named color, matching culori", () => {
    for (const [name, value] of Object.entries(colorsNamed)) {
      const hex = `#${value.toString(16).padStart(6, "0").toUpperCase()}`;
      expect(toHex(parseColor(name).rgba)).toBe(hex);
    }
  });

  it("gamut-maps display-p3 colors outside sRGB and flags them", () => {
    const red = parseColor("color(display-p3 1 0 0)");
    expect(red.space).toBe("display-p3");
    expect(red.gamutMapped).toBe(true);
    expect(red.unmapped[0]).toBeGreaterThan(1);
    for (const c of [red.rgba.r, red.rgba.g, red.rgba.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
    expect(red.rgba.r).toBeGreaterThan(0.99);
  });

  it("gamut-maps wide oklch colors while keeping their hue", () => {
    const p = parseColor("oklch(0.7 0.4 150)");
    expect(p.gamutMapped).toBe(true);
    expect(p.rgba.g).toBeGreaterThan(p.rgba.r);
  });

  it("handles none and angle units", () => {
    expect(toHex(parseColor("oklch(0.5 none none)").rgba)).toBe(toHex(parseColor("oklch(0.5 0 0)").rgba));
    expect(toHex(parseColor("hsl(3.14159rad 100% 50%)").rgba)).toBe("#00FFFF");
    expect(toHex(parseColor("hsl(200grad 100% 50%)").rgba)).toBe("#00FFFF");
  });

  it("resolves currentColor only with a context color", () => {
    expect(() => parseColor("currentColor")).toThrow(/context color/);
    const c = parseColor("currentcolor", { currentColor: { r: 1, g: 0, b: 0, alpha: 1 } });
    expect(toHex(c.rgba)).toBe("#FF0000");
  });

  it("accepts bare shadcn-style HSL triplets only when asked", () => {
    expect(tryParseColor("222.2 84% 4.9%")).toBeNull();
    expect(toHex(parseColor("222.2 84% 4.9%", { bareHsl: true }).rgba)).toBe(
      toHex(parseColor("hsl(222.2 84% 4.9%)").rgba),
    );
    expect(parseColor("0 0% 100% / 0.5", { bareHsl: true }).rgba.alpha).toBe(0.5);
  });

  it.each([
    ["blue-ish", /expected a CSS color/],
    ["", /empty value/],
    ["#12345", /hex/],
    ["rgb(1, 2)", /expects 3 components/],
    ["rgb(1 2 3 / )", /missing alpha/],
    ["rgb(1 2 3 / 1 / 2)", /more than one/],
    ["rgb(1,,2)", /empty argument/],
    ["hsl(10% 50% 50%)", /hue cannot be a percentage/],
    ["rgb(10deg 0 0)", /cannot be an angle/],
    ["foo(1 2 3)", /unsupported color function/],
    ["color(cmyk 1 2 3)", /unsupported color\(\) space/],
    ["rgb(a b c)", /unexpected token/],
    ["var(--x)", /unresolved var/],
  ])("rejects %j with an actionable error", (input, message) => {
    expect(() => parseColor(input)).toThrow(ColorParseError);
    expect(() => parseColor(input)).toThrow(message);
  });

  it("clamps alpha", () => {
    expect(parseColor("rgb(0 0 0 / 150%)").rgba.alpha).toBe(1);
    expect(parseColor("rgba(0,0,0,-1)").rgba.alpha).toBe(0);
  });
});
