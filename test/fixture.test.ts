import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ALL_RGB_COUNT, writeAllRgbFixture } from "../src/fixture.js";
import { decodePng } from "../src/util/png.js";

describe("all-RGB fixture", () => {
  it("contains every 24-bit color exactly once, indexed by r<<16|g<<8|b", async () => {
    const path = await writeAllRgbFixture("fixtures/allrgb.png");
    const image = decodePng(await readFile(path));
    expect(image.width).toBe(4096);
    expect(image.height).toBe(4096);
    const seen = new Uint8Array(ALL_RGB_COUNT / 8);
    let unique = 0;
    let misplaced = 0;
    const d = image.data;
    for (let i = 0; i < ALL_RGB_COUNT; i++) {
      const o = i * 4;
      const c = (d[o]! << 16) | (d[o + 1]! << 8) | d[o + 2]!;
      if (c !== i) misplaced++;
      const byte = c >> 3;
      const bit = 1 << (c & 7);
      if (!(seen[byte]! & bit)) {
        seen[byte]! |= bit;
        unique++;
      }
    }
    expect(unique).toBe(16_777_216);
    expect(misplaced).toBe(0);
  });
});
