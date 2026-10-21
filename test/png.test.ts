import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, cropImage, decodePng, encodePng, PngError, strokeRect } from "../src/util/png.js";

function image(width: number, height: number, alpha = 255) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i * 7) & 0xff;
    data[i * 4 + 1] = (i * 13) & 0xff;
    data[i * 4 + 2] = (i * 31) & 0xff;
    data[i * 4 + 3] = i % 3 === 0 ? alpha : 255;
  }
  return { width, height, data };
}

/** Hand-assemble a PNG with arbitrary IHDR settings. */
function rawPng(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  rows: number[][],
  extra: [string, number[]][] = [],
) {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const raw = Uint8Array.from(rows.flatMap((r) => [0, ...r]));
  return Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extra.map(([t, d]) => chunk(t, Uint8Array.from(d))),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}

describe("PNG codec", () => {
  it.each(["none", "sub", "adaptive"] as const)("round-trips RGBA with %s filtering", (filter) => {
    const img = image(37, 23, 128);
    const back = decodePng(encodePng(img, { filter }));
    expect(back.width).toBe(37);
    expect(back.height).toBe(23);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("stores opaque images as RGB", () => {
    const img = image(10, 10);
    const png = encodePng(img);
    expect(png[25]).toBe(2);
    expect(Buffer.from(decodePng(png).data).equals(Buffer.from(img.data))).toBe(true);
  });

  it("decodes gray, gray+alpha, 16-bit and palette images", () => {
    const gray = decodePng(rawPng(2, 1, 8, 0, [[10, 200]]));
    expect(Array.from(gray.data)).toEqual([10, 10, 10, 255, 200, 200, 200, 255]);
    const ga = decodePng(rawPng(1, 1, 8, 4, [[50, 60]]));
    expect(Array.from(ga.data)).toEqual([50, 50, 50, 60]);
    const rgb16 = decodePng(rawPng(1, 1, 16, 2, [[1, 2, 3, 4, 5, 6]]));
    expect(Array.from(rgb16.data)).toEqual([1, 3, 5, 255]);
    const pal = decodePng(
      rawPng(
        3,
        1,
        2,
        3,
        [[0b00011000]],
        [
          ["PLTE", [255, 0, 0, 0, 255, 0, 0, 0, 255]],
          ["tRNS", [128]],
        ],
      ),
    );
    expect(Array.from(pal.data)).toEqual([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 255]);
    const pal8 = decodePng(rawPng(1, 1, 8, 3, [[1]], [["PLTE", [9, 9, 9, 7, 7, 7]]]));
    expect(Array.from(pal8.data)).toEqual([7, 7, 7, 255]);
  });

  it("rejects malformed input", () => {
    expect(() => decodePng(new Uint8Array(10))).toThrow(PngError);
    expect(() => decodePng(rawPng(1, 1, 8, 5, [[1]]))).toThrow(/color type/);
    expect(() => decodePng(rawPng(1, 1, 4, 2, [[1]]))).toThrow(/bit depth/);
    expect(() => decodePng(rawPng(1, 1, 8, 3, [[0]]))).toThrow(/PLTE/);
    expect(() => decodePng(rawPng(4, 2, 8, 2, [[1, 2, 3]]))).toThrow(/truncated/);
    expect(() => decodePng(Buffer.from(rawPng(1, 1, 8, 0, [[1]])).fill(0, 41, 42))).toThrow();
    const bad = rawPng(1, 1, 8, 0, [[1]]);
    expect(() => decodePng(Buffer.concat([bad.subarray(0, 8), bad.subarray(33)]))).toThrow(/IHDR/);
  });

  it("crops (clamped) and strokes rectangles", () => {
    const img = image(20, 20);
    const crop = cropImage(img, -5, 15, 10, 10);
    expect(crop.width).toBe(5);
    expect(crop.height).toBe(5);
    expect(Array.from(crop.data.subarray(0, 4))).toEqual(
      Array.from(img.data.subarray(300 * 4, 300 * 4 + 4)),
    );
    strokeRect(img, 2, 2, 5, 5, [255, 0, 255], 1);
    expect(Array.from(img.data.subarray((2 * 20 + 2) * 4, (2 * 20 + 2) * 4 + 4))).toEqual([
      255, 0, 255, 255,
    ]);
    strokeRect(img, -3, -3, 50, 50, [0, 0, 0]);
  });
});
