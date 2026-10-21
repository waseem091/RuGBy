/**
 * Runs the color core over the all-RGB fixture and checks it against culori.
 * Default: every 257th color (65,281 colors). RUGBY_EXHAUSTIVE=1: all 16,777,216.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { converter, wcagLuminance } from "culori";
import { beforeAll, describe, expect, it } from "vitest";
import {
  contrastRatio,
  fromBytes,
  luminance8,
  relativeLuminance,
  srgbToOklab,
} from "../../src/color/index.js";
import { writeAllRgbFixture } from "../../src/fixture.js";
import { decodePng, type RgbaImage } from "../../src/util/png.js";

const EXHAUSTIVE = process.env.RUGBY_EXHAUSTIVE === "1";
const STRIDE = EXHAUSTIVE ? 1 : 257;
const PATH = "fixtures/allrgb.png";

/** WCAG 2.x as written in the spec (0.03928 threshold), independent of src/. */
function referenceLuminance(r8: number, g8: number, b8: number): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r8) + 0.7152 * ch(g8) + 0.0722 * ch(b8);
}
const referenceContrast = (l1: number, l2: number) =>
  (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

describe(`color core over the all-RGB fixture (stride ${STRIDE})`, () => {
  let image: RgbaImage;
  beforeAll(async () => {
    if (!existsSync(PATH)) await writeAllRgbFixture(PATH);
    image = decodePng(await readFile(PATH));
  });

  it(
    "OKLab and WCAG luminance match culori within 1e-6; contrast vs white/black matches the reference formula",
    () => {
      const toOklab = converter("oklab");
      const white = fromBytes(255, 255, 255);
      const black = fromBytes(0, 0, 0);
      let maxLab = 0;
      let maxLum = 0;
      let maxContrast = 0;
      let checked = 0;
      const d = image.data;
      for (let i = 0; i < d.length / 4; i += STRIDE) {
        const r8 = d[i * 4]!;
        const g8 = d[i * 4 + 1]!;
        const b8 = d[i * 4 + 2]!;
        const r = r8 / 255;
        const g = g8 / 255;
        const b = b8 / 255;
        const ours = srgbToOklab([r, g, b]);
        const theirs = toOklab({ mode: "rgb", r, g, b });
        maxLab = Math.max(
          maxLab,
          Math.abs(ours.l - theirs.l),
          Math.abs(ours.a - theirs.a),
          Math.abs(ours.b - theirs.b),
        );
        const c = fromBytes(r8, g8, b8);
        const lum = relativeLuminance(c);
        maxLum = Math.max(
          maxLum,
          Math.abs(lum - wcagLuminance({ mode: "rgb", r, g, b })),
          Math.abs(lum - luminance8(r8, g8, b8)),
        );
        const ref = referenceLuminance(r8, g8, b8);
        maxContrast = Math.max(
          maxContrast,
          Math.abs(contrastRatio(c, white) - referenceContrast(ref, 1)),
          Math.abs(contrastRatio(c, black) - referenceContrast(ref, 0)),
        );
        checked++;
      }
      expect(checked).toBe(Math.ceil(16_777_216 / STRIDE));
      expect(maxLab).toBeLessThan(1e-6);
      expect(maxLum).toBeLessThan(1e-6);
      expect(maxContrast).toBeLessThan(1e-9);
    },
    EXHAUSTIVE ? 600_000 : 60_000,
  );
});
