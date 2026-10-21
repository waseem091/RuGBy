/**
 * Color space conversions. Matrices follow CSS Color Module Level 4 sample code
 * (and, for OKLab, the coefficients culori uses, so the two agree to ~1e-12).
 * All RGB spaces here are D65 except ProPhoto (D50). Lab/LCH are CIE D50, as in CSS.
 */
import type { Oklab, Oklch, Vec3 } from "./types.js";

type Mat3 = readonly [Vec3, Vec3, Vec3];

export function multiply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// ---------------------------------------------------------------------------
// Transfer functions
// ---------------------------------------------------------------------------

/** sRGB gamma-encoded channel → linear light (sign-preserving for out-of-gamut values). */
export function srgbToLinear(c: number): number {
  const abs = Math.abs(c);
  if (abs <= 0.04045) return c / 12.92;
  return (Math.sign(c) || 1) * ((abs + 0.055) / 1.055) ** 2.4;
}

/** Linear-light channel → sRGB gamma-encoded (sign-preserving). */
export function linearToSrgb(c: number): number {
  const abs = Math.abs(c);
  if (abs <= 0.0031308) return c * 12.92;
  return (Math.sign(c) || 1) * (1.055 * abs ** (1 / 2.4) - 0.055);
}

/** Linear-light values for the 256 possible 8-bit sRGB channel values. */
export const SRGB8_TO_LINEAR: Float64Array = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

const mapVec = (v: Vec3, f: (n: number) => number): Vec3 => [f(v[0]), f(v[1]), f(v[2])];

export const srgbToLinearVec = (v: Vec3): Vec3 => mapVec(v, srgbToLinear);
export const linearToSrgbVec = (v: Vec3): Vec3 => mapVec(v, linearToSrgb);

function a98ToLinear(c: number): number {
  return (Math.sign(c) || 1) * Math.abs(c) ** (563 / 256);
}
function linearToA98(c: number): number {
  return (Math.sign(c) || 1) * Math.abs(c) ** (256 / 563);
}

const ET2 = 16 / 512;
function prophotoToLinear(c: number): number {
  const abs = Math.abs(c);
  return abs <= ET2 ? c / 16 : (Math.sign(c) || 1) * abs ** 1.8;
}
function linearToProphoto(c: number): number {
  const abs = Math.abs(c);
  return abs >= 1 / 512 ? (Math.sign(c) || 1) * abs ** (1 / 1.8) : 16 * c;
}

const REC_ALPHA = 1.09929682680944;
const REC_BETA = 0.018053968510807;
function rec2020ToLinear(c: number): number {
  const abs = Math.abs(c);
  if (abs < REC_BETA * 4.5) return c / 4.5;
  return (Math.sign(c) || 1) * ((abs + REC_ALPHA - 1) / REC_ALPHA) ** (1 / 0.45);
}
function linearToRec2020(c: number): number {
  const abs = Math.abs(c);
  if (abs > REC_BETA) return (Math.sign(c) || 1) * (REC_ALPHA * abs ** 0.45 - (REC_ALPHA - 1));
  return 4.5 * c;
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

const LIN_SRGB_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_LIN_SRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const LIN_P3_TO_XYZ: Mat3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LIN_P3: Mat3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];
const LIN_A98_TO_XYZ: Mat3 = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];
const XYZ_TO_LIN_A98: Mat3 = [
  [1829569 / 896150, -506331 / 896150, -308931 / 896150],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040],
];
const LIN_REC2020_TO_XYZ: Mat3 = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0, 19567812 / 697040785, 295819943 / 278816314],
];
const XYZ_TO_LIN_REC2020: Mat3 = [
  [30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100],
  [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200],
  [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125],
];
/** ProPhoto RGB (D50). */
const LIN_PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const XYZ_D50_TO_LIN_PROPHOTO: Mat3 = [
  [1.3457868816471583, -0.25557208737979464, -0.05110186497554526],
  [-0.5446307051249019, 1.5082477428451468, 0.02052744743642139],
  [0, 0, 1.2119675456389452],
];
/** Bradford chromatic adaptation. */
const D65_TO_D50: Mat3 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
export const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

// ---------------------------------------------------------------------------
// Linear sRGB hub
// ---------------------------------------------------------------------------

export const linearSrgbToXyz = (v: Vec3): Vec3 => multiply(LIN_SRGB_TO_XYZ, v);
export const xyzToLinearSrgb = (v: Vec3): Vec3 => multiply(XYZ_TO_LIN_SRGB, v);
export const xyzD65ToD50 = (v: Vec3): Vec3 => multiply(D65_TO_D50, v);
export const xyzD50ToD65 = (v: Vec3): Vec3 => multiply(D50_TO_D65, v);

/** Gamma-encoded Display-P3 → linear sRGB. */
export function displayP3ToLinearSrgb(p3: Vec3): Vec3 {
  return xyzToLinearSrgb(multiply(LIN_P3_TO_XYZ, srgbToLinearVec(p3)));
}
/** Linear sRGB → gamma-encoded Display-P3. */
export function linearSrgbToDisplayP3(lin: Vec3): Vec3 {
  return linearToSrgbVec(multiply(XYZ_TO_LIN_P3, linearSrgbToXyz(lin)));
}
export function a98ToLinearSrgb(v: Vec3): Vec3 {
  return xyzToLinearSrgb(multiply(LIN_A98_TO_XYZ, mapVec(v, a98ToLinear)));
}
export function linearSrgbToA98(lin: Vec3): Vec3 {
  return mapVec(multiply(XYZ_TO_LIN_A98, linearSrgbToXyz(lin)), linearToA98);
}
export function rec2020ToLinearSrgb(v: Vec3): Vec3 {
  return xyzToLinearSrgb(multiply(LIN_REC2020_TO_XYZ, mapVec(v, rec2020ToLinear)));
}
export function linearSrgbToRec2020(lin: Vec3): Vec3 {
  return mapVec(multiply(XYZ_TO_LIN_REC2020, linearSrgbToXyz(lin)), linearToRec2020);
}
export function prophotoToLinearSrgb(v: Vec3): Vec3 {
  return xyzToLinearSrgb(
    xyzD50ToD65(multiply(LIN_PROPHOTO_TO_XYZ_D50, mapVec(v, prophotoToLinear))),
  );
}
export function linearSrgbToProphoto(lin: Vec3): Vec3 {
  return mapVec(
    multiply(XYZ_D50_TO_LIN_PROPHOTO, xyzD65ToD50(linearSrgbToXyz(lin))),
    linearToProphoto,
  );
}

// ---------------------------------------------------------------------------
// CIE Lab / LCH (D50)
// ---------------------------------------------------------------------------

const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

export function labToXyzD50(lab: Vec3): Vec3 {
  const [l, a, b] = lab;
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = l > KAPPA * EPSILON ? ((l + 16) / 116) ** 3 : l / KAPPA;
  const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

export function xyzD50ToLab(xyz: Vec3): Vec3 {
  const scaled: Vec3 = [xyz[0] / D50_WHITE[0], xyz[1] / D50_WHITE[1], xyz[2] / D50_WHITE[2]];
  const f = scaled.map((v) => (v > EPSILON ? Math.cbrt(v) : (KAPPA * v + 16) / 116)) as Vec3;
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

export function labToLinearSrgb(lab: Vec3): Vec3 {
  return xyzToLinearSrgb(xyzD50ToD65(labToXyzD50(lab)));
}
export function linearSrgbToLab(lin: Vec3): Vec3 {
  return xyzD50ToLab(xyzD65ToD50(linearSrgbToXyz(lin)));
}

/** Polar ↔ rectangular helpers shared by LCH and OKLCH. */
export function polarToRect(l: number, c: number, hDeg: number): Vec3 {
  const h = Number.isNaN(hDeg) ? 0 : (hDeg * Math.PI) / 180;
  return [l, c * Math.cos(h), c * Math.sin(h)];
}
export function rectToPolar(l: number, a: number, b: number): Vec3 {
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [l, c, c < 1e-9 ? 0 : h];
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH
// ---------------------------------------------------------------------------

export function linearSrgbToOklab(lin: Vec3): Oklab {
  const [r, g, b] = lin;
  const l_ = Math.cbrt(0.412221469470763 * r + 0.5363325372617348 * g + 0.0514459932675022 * b);
  const m_ = Math.cbrt(0.2119034958178252 * r + 0.6806995506452344 * g + 0.1073969535369406 * b);
  const s_ = Math.cbrt(0.0883024591900564 * r + 0.2817188391361215 * g + 0.6299787016738222 * b);
  return {
    l: 0.210454268309314 * l_ + 0.7936177747023054 * m_ - 0.0040720430116193 * s_,
    a: 1.9779985324311684 * l_ - 2.4285922420485799 * m_ + 0.450593709617411 * s_,
    b: 0.0259040424655478 * l_ + 0.7827717124575296 * m_ - 0.8086757549230774 * s_,
  };
}

export function oklabToLinearSrgb(lab: Oklab): Vec3 {
  const l_ = lab.l + 0.3963377773761749 * lab.a + 0.2158037573099136 * lab.b;
  const m_ = lab.l - 0.1055613458156586 * lab.a - 0.0638541728258133 * lab.b;
  const s_ = lab.l - 0.0894841775298119 * lab.a - 1.2914855480194092 * lab.b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  return [
    4.0767416360759574 * l3 - 3.3077115392580616 * m3 + 0.2309699031821044 * s3,
    -1.2684379732850317 * l3 + 2.6097573492876887 * m3 - 0.3413193760026573 * s3,
    -0.0041960761386756 * l3 - 0.7034186179359362 * m3 + 1.7076146940746117 * s3,
  ];
}

export function oklabToOklch(lab: Oklab): Oklch {
  const [l, c, h] = rectToPolar(lab.l, lab.a, lab.b);
  return { l, c, h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const [l, a, b] = polarToRect(lch.l, lch.c, lch.h);
  return { l, a, b };
}

/** Gamma-encoded sRGB → OKLab. */
export function srgbToOklab(rgb: Vec3): Oklab {
  return linearSrgbToOklab(srgbToLinearVec(rgb));
}
/** OKLab → gamma-encoded sRGB (unclamped). */
export function oklabToSrgb(lab: Oklab): Vec3 {
  return linearToSrgbVec(oklabToLinearSrgb(lab));
}
export function srgbToOklch(rgb: Vec3): Oklch {
  return oklabToOklch(srgbToOklab(rgb));
}
export function oklchToSrgb(lch: Oklch): Vec3 {
  return oklabToSrgb(oklchToOklab(lch));
}

// ---------------------------------------------------------------------------
// HSL / HWB (both defined on gamma-encoded sRGB)
// ---------------------------------------------------------------------------

/** hue in degrees, saturation/lightness in [0, 1]. */
export function hslToSrgb(h: number, s: number, l: number): Vec3 {
  const hue = (((Number.isNaN(h) ? 0 : h) % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** hue in degrees, whiteness/blackness in [0, 1]. */
export function hwbToSrgb(h: number, white: number, black: number): Vec3 {
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  const rgb = hslToSrgb(h, 1, 0.5);
  return rgb.map((c) => c * (1 - white - black) + white) as Vec3;
}

/** Gamma-encoded sRGB → [hue°, saturation, lightness]. */
export function srgbToHsl(rgb: Vec3): Vec3 {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
