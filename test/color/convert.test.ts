import { converter } from "culori";
import { describe, expect, it } from "vitest";
import {
  a98ToLinearSrgb,
  clipSrgb,
  displayP3ToLinearSrgb,
  gamutMapSrgb,
  hslToSrgb,
  hwbToSrgb,
  inSrgbGamut,
  labToLinearSrgb,
  linearSrgbToA98,
  linearSrgbToDisplayP3,
  linearSrgbToLab,
  linearSrgbToProphoto,
  linearSrgbToRec2020,
  linearToSrgb,
  oklabToOklch,
  oklabToSrgb,
  oklchToOklab,
  oklchToSrgb,
  prophotoToLinearSrgb,
  rec2020ToLinearSrgb,
  srgbToHsl,
  srgbToLinear,
  srgbToLinearVec,
  srgbToOklab,
  srgbToOklch,
  type Vec3,
} from "../../src/color/index.js";

const samples: Vec3[] = [
  [0, 0, 0],
  [1, 1, 1],
  [0.5, 0.5, 0.5],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.2, 0.4, 0.6],
  [0.9, 0.1, 0.5],
  [0.03, 0.02, 0.01],
];

const close = (a: Vec3, b: Vec3, digits = 9) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, digits);
};

describe("transfer functions", () => {
  it("round-trip sRGB ↔ linear including negative and >1 values", () => {
    for (const v of [-0.5, -0.01, 0, 0.002, 0.04, 0.5, 1, 1.3]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
    }
  });
});

describe("OKLab / OKLCH", () => {
  const toOklab = converter("oklab");
  const toOklch = converter("oklch");
  it.each(samples)("matches culori for rgb(%f %f %f)", (r, g, b) => {
    const ours = srgbToOklab([r, g, b]);
    const theirs = toOklab({ mode: "rgb", r, g, b });
    expect(ours.l).toBeCloseTo(theirs.l, 12);
    expect(ours.a).toBeCloseTo(theirs.a, 12);
    expect(ours.b).toBeCloseTo(theirs.b, 12);
    const lch = srgbToOklch([r, g, b]);
    const theirLch = toOklch({ mode: "rgb", r, g, b });
    expect(lch.l).toBeCloseTo(theirLch.l, 12);
    expect(lch.c).toBeCloseTo(theirLch.c, 9);
    if (lch.c > 1e-6) expect(lch.h).toBeCloseTo(theirLch.h ?? 0, 6);
  });

  it("round-trips through OKLab and OKLCH", () => {
    for (const s of samples) {
      close(oklabToSrgb(srgbToOklab(s)), s);
      close(oklchToSrgb(srgbToOklch(s)), s);
      const lab = srgbToOklab(s);
      const back = oklchToOklab(oklabToOklch(lab));
      expect(back.a).toBeCloseTo(lab.a, 12);
    }
  });

  it("reports hue 0 for achromatic colors", () => {
    expect(srgbToOklch([0.5, 0.5, 0.5]).h).toBe(0);
  });
});

describe("wide-gamut RGB spaces", () => {
  const cases: [string, (v: Vec3) => Vec3, (v: Vec3) => Vec3, string][] = [
    ["display-p3", displayP3ToLinearSrgb, linearSrgbToDisplayP3, "p3"],
    ["a98-rgb", a98ToLinearSrgb, linearSrgbToA98, "a98"],
    ["rec2020", rec2020ToLinearSrgb, linearSrgbToRec2020, "rec2020"],
    ["prophoto-rgb", prophotoToLinearSrgb, linearSrgbToProphoto, "prophoto"],
  ];
  const toLrgb = converter("lrgb");
  it.each(cases)("%s matches culori and round-trips", (_name, toLin, fromLin, mode) => {
    for (const s of samples) {
      const ours = toLin(s);
      const theirs = toLrgb({ mode, r: s[0], g: s[1], b: s[2] } as Parameters<typeof toLrgb>[0])!;
      close(ours, [theirs.r, theirs.g, theirs.b], 6);
      close(fromLin(ours), s, 6);
    }
  });

  it("CIE Lab (D50) matches culori and round-trips", () => {
    const toLab = converter("lab");
    for (const s of samples) {
      const lin = srgbToLinearVec(s);
      const lab = linearSrgbToLab(lin);
      const theirs = toLab({ mode: "rgb", r: s[0], g: s[1], b: s[2] });
      // culori uses slightly different D50 adaptation constants; agree to 1e-4 on a 0–100 scale.
      close(lab, [theirs.l, theirs.a, theirs.b], 4);
      close(labToLinearSrgb(lab), lin, 9);
    }
  });
});

describe("HSL / HWB", () => {
  it("converts known values", () => {
    close(hslToSrgb(0, 1, 0.5), [1, 0, 0]);
    close(hslToSrgb(240, 1, 0.25), [0, 0, 0.5]);
    close(hslToSrgb(Number.NaN, 0, 0.5), [0.5, 0.5, 0.5]);
    close(hwbToSrgb(120, 0, 0), [0, 1, 0]);
    close(hwbToSrgb(0, 0.7, 0.7), [0.5, 0.5, 0.5]);
  });
  it("srgbToHsl inverts hslToSrgb", () => {
    for (const s of samples) {
      const [h, sat, l] = srgbToHsl(s);
      close(hslToSrgb(h, sat, l), s, 9);
    }
  });
});

describe("gamut mapping", () => {
  it("passes in-gamut colors through unchanged", () => {
    expect(gamutMapSrgb([0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    expect(inSrgbGamut([1.0000001, 0, 0])).toBe(true);
  });
  it("maps out-of-gamut colors into gamut, keeping lightness close", () => {
    const p3red = displayP3ToLinearSrgb([1, 0, 0]).map(linearToSrgb) as Vec3;
    expect(inSrgbGamut(p3red)).toBe(false);
    const mapped = gamutMapSrgb(p3red);
    expect(inSrgbGamut(mapped)).toBe(true);
    expect(Math.abs(srgbToOklab(mapped).l - srgbToOklab(p3red).l)).toBeLessThan(0.03);
  });
  it("sends super-white and super-black to white and black", () => {
    expect(gamutMapSrgb(oklchToSrgb({ l: 1.2, c: 0.2, h: 30 }))).toEqual([1, 1, 1]);
    expect(gamutMapSrgb(oklchToSrgb({ l: -0.1, c: 0.2, h: 30 }))).toEqual([0, 0, 0]);
  });
  it("clips NaN to 0", () => {
    expect(clipSrgb([Number.NaN, 2, -1])).toEqual([0, 1, 0]);
  });
  it("binary-searches chroma for strongly out-of-gamut colors", () => {
    const mapped = gamutMapSrgb(oklchToSrgb({ l: 0.5, c: 0.4, h: 145 }));
    expect(inSrgbGamut(mapped)).toBe(true);
    const lch = srgbToOklch(mapped);
    expect(Math.abs(lch.h - 145)).toBeLessThan(10);
  });
});
