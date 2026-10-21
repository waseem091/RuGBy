import { wcagContrast, wcagLuminance } from "culori";
import { describe, expect, it } from "vitest";
import {
  apcaContrast,
  apcaContrastFromY,
  apcaRequiredLc,
  apcaY,
  apcaY8,
  contrastRatio,
  fromBytes,
  isLargeText,
  luminance8,
  passesWcag,
  relativeLuminance,
  requiredRatio,
  rgba,
  roundLc,
  roundRatio,
} from "../../src/color/index.js";

describe("WCAG 2.x", () => {
  it("#777 on #fff is 4.48:1 and fails AA for normal text", () => {
    const ratio = contrastRatio(rgba("#777"), rgba("#fff"));
    expect(roundRatio(ratio)).toBe(4.48);
    expect(passesWcag(ratio, "AA", false)).toBe(false);
    expect(passesWcag(ratio, "AA", true)).toBe(true);
  });

  it.each([
    ["#000", "#fff", 21],
    ["#fff", "#fff", 1],
    ["#767676", "#fff", 4.54],
    ["#595959", "#fff", 7.0],
    ["#6b7280", "#ffffff", 4.83],
    ["#9ca3af", "#d1d5db", 1.72],
  ])("%s on %s ≈ %f:1", (fg, bg, expected) => {
    expect(roundRatio(contrastRatio(rgba(fg), rgba(bg)))).toBeCloseTo(expected, 2);
  });

  it("matches culori for luminance and contrast", () => {
    for (const hex of ["#123456", "#abcdef", "#777777", "#ff0000", "#00ff00"]) {
      expect(relativeLuminance(rgba(hex))).toBeCloseTo(wcagLuminance(hex), 12);
      expect(contrastRatio(rgba(hex), rgba("#fff"))).toBeCloseTo(wcagContrast(hex, "#fff"), 12);
    }
  });

  it("table lookup equals the formula", () => {
    expect(luminance8(119, 119, 119)).toBeCloseTo(relativeLuminance(fromBytes(119, 119, 119)), 15);
  });

  it("does not round before comparing", () => {
    expect(passesWcag(4.4999, "AA", false)).toBe(false);
    expect(passesWcag(4.5, "AA", false)).toBe(true);
  });

  it("applies the large-text rules", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(23.9, 400)).toBe(false);
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 600)).toBe(false);
    expect(isLargeText(18.5, 700)).toBe(false);
  });

  it("has the AA and AAA thresholds", () => {
    expect(requiredRatio("AA", false)).toBe(4.5);
    expect(requiredRatio("AA", true)).toBe(3);
    expect(requiredRatio("AAA", false)).toBe(7);
    expect(requiredRatio("AAA", true)).toBe(4.5);
  });
});

describe("APCA 0.0.98G-4g", () => {
  it.each([
    ["#888", "#fff", 63.056469930209424],
    ["#fff", "#888", -68.54146436644962],
    ["#000", "#aaa", 58.146262578561334],
    ["#aaa", "#000", -56.24113336839742],
    ["#123", "#def", 91.66830811481631],
    ["#def", "#123", -93.06770049484275],
    ["#000", "#fff", 106.04067321268862],
    ["#fff", "#000", -107.88473318309848],
  ])("text %s on %s → Lc %f", (text, bg, lc) => {
    expect(apcaContrast(rgba(text), rgba(bg))).toBeCloseTo(lc, 6);
  });

  it("returns 0 for near-identical or invalid luminances", () => {
    expect(apcaContrast(rgba("#777"), rgba("#787878"))).toBe(0);
    expect(apcaContrastFromY(Number.NaN, 0.5)).toBe(0);
    expect(apcaContrastFromY(-0.1, 0.5)).toBe(0);
    expect(apcaContrastFromY(0.5, 1.2)).toBe(0);
  });

  it("clips low contrast to zero in both polarities", () => {
    expect(apcaContrastFromY(0.5, 0.55)).toBe(0);
    expect(apcaContrastFromY(0.55, 0.5)).toBe(0);
  });

  it("table lookup equals the formula", () => {
    expect(apcaY8(10, 200, 30)).toBeCloseTo(apcaY(fromBytes(10, 200, 30)), 15);
  });

  it("looks up the minimum Lc by size and weight", () => {
    expect(apcaRequiredLc(16, 400)).toEqual({ lc: 90, prohibited: false });
    expect(apcaRequiredLc(18, 400)).toEqual({ lc: 75, prohibited: false });
    expect(apcaRequiredLc(20, 400)).toEqual({ lc: 75, prohibited: false });
    expect(apcaRequiredLc(24, 700)).toEqual({ lc: 45, prohibited: false });
    expect(apcaRequiredLc(120, 900)).toEqual({ lc: 30, prohibited: false });
    expect(apcaRequiredLc(12, 400)).toEqual({ lc: 100, prohibited: false });
    expect(apcaRequiredLc(14, 100)).toEqual({ lc: 100, prohibited: true });
    expect(apcaRequiredLc(16, 450)).toEqual({ lc: 75, prohibited: false });
  });

  it("rounds for display", () => {
    expect(roundLc(-28.14)).toBe(-28.1);
  });
});
