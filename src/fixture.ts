/**
 * The all-RGB fixture: a lossless 4096×4096 PNG holding every 24-bit sRGB color
 * exactly once, where pixel index = (r << 16) | (g << 8) | b.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { encodePng, type RgbaImage } from "./util/png.js";

export const ALL_RGB_SIZE = 4096;
export const ALL_RGB_COUNT = ALL_RGB_SIZE * ALL_RGB_SIZE;

/** Build the all-RGB image in memory (64 MiB of RGBA). */
export function allRgbImage(): RgbaImage {
  const data = new Uint8Array(ALL_RGB_COUNT * 4);
  for (let i = 0; i < ALL_RGB_COUNT; i++) {
    const o = i * 4;
    data[o] = (i >> 16) & 0xff;
    data[o + 1] = (i >> 8) & 0xff;
    data[o + 2] = i & 0xff;
    data[o + 3] = 255;
  }
  return { width: ALL_RGB_SIZE, height: ALL_RGB_SIZE, data };
}

/** Write the all-RGB PNG and return its absolute path. */
export async function writeAllRgbFixture(path = "fixtures/allrgb.png"): Promise<string> {
  const target = resolve(path);
  // The Sub filter turns each row into a near-constant byte stream, so this stays small.
  const png = encodePng(allRgbImage(), { opaque: true, filter: "sub", level: 6 });
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, png);
  return target;
}
