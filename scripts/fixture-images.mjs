/**
 * Regenerate the synthetic "photos" used by fixtures/pages. Each has a flat
 * plateau on the left (x < 260) so the worst-case background under text that
 * starts there is known exactly; the rest is a smooth, photo-like texture.
 *   npm run build && node scripts/fixture-images.mjs
 */
import { writeFileSync } from "node:fs";
import { encodePng } from "../dist/util/png.js";

/** @param {[number, number, number]} plateau */
function photo(plateau) {
  const width = 800;
  const height = 400;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inPlateau = x < 260;
      const t = Math.sin(x / 37) * Math.cos(y / 29);
      const u = Math.sin((x + y) / 53);
      data[o] = inPlateau ? plateau[0] : Math.round(70 + 45 * t + 25 * u);
      data[o + 1] = inPlateau ? plateau[1] : Math.round(95 + 40 * u - 20 * t);
      data[o + 2] = inPlateau ? plateau[2] : Math.round(60 + 30 * t * u + 20);
      data[o + 3] = 255;
    }
  }
  return encodePng({ width, height, data }, { level: 9 });
}

writeFileSync("fixtures/pages/photo.png", photo([0xe2, 0xe8, 0xf0]));
writeFileSync("fixtures/pages/photo-white.png", photo([0xff, 0xff, 0xff]));
console.log("wrote fixtures/pages/photo.png, fixtures/pages/photo-white.png");
