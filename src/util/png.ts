/**
 * Minimal, dependency-free PNG codec.
 *
 * Decodes the formats a browser screenshot can produce (8/16-bit gray, gray+alpha,
 * RGB, RGBA and palette images, non-interlaced) into an RGBA8 buffer, and encodes
 * RGB8/RGBA8 buffers losslessly. Used for pixel sampling, report crops and the
 * all-RGB fixture.
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major, `width * height * 4` bytes. */
  data: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export class PngError extends Error {
  override name = "PngError";
}

/** Decode a PNG file into RGBA8. */
export function decodePng(input: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i++) {
    if (input[i] !== SIGNATURE[i]) throw new PngError("Not a PNG file (bad signature)");
  }
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (offset < input.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8));
    const data = input.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      const h = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = h.getUint32(0);
      height = h.getUint32(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[12] !== 0) throw new PngError("Interlaced PNGs are not supported");
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!width || !height) throw new PngError("PNG has no IHDR chunk");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new PngError(`Unsupported PNG color type ${colorType}`);
  if (bitDepth !== 8 && bitDepth !== 16 && !(colorType === 3 && bitDepth < 8)) {
    throw new PngError(`Unsupported PNG bit depth ${bitDepth} for color type ${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const pixels = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? cur[x - bpp]! : 0;
      const up = prev[x]!;
      const upLeft = x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (left + up) >> 1;
      else if (filter === 4) v += paeth(left, up, upLeft);
      else if (filter !== 0) throw new PngError(`Bad PNG filter type ${filter}`);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  const out = new Uint8Array(width * height * 4);
  const sample = (row: Uint8Array, index: number): number =>
    bitDepth === 16 ? row[index * 2]! : row[index]!;
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        let idx: number;
        if (bitDepth === 8) idx = row[x]!;
        else {
          const perByte = 8 / bitDepth;
          const byte = row[Math.floor(x / perByte)]!;
          const shift = 8 - bitDepth * ((x % perByte) + 1);
          idx = (byte >> shift) & ((1 << bitDepth) - 1);
        }
        if (!palette) throw new PngError("Palette PNG without PLTE chunk");
        out[o] = palette[idx * 3]!;
        out[o + 1] = palette[idx * 3 + 1]!;
        out[o + 2] = palette[idx * 3 + 2]!;
        out[o + 3] = transparency && idx < transparency.length ? transparency[idx]! : 255;
        continue;
      }
      const base = x * channels;
      if (colorType === 0 || colorType === 4) {
        const g = sample(row, base);
        out[o] = g;
        out[o + 1] = g;
        out[o + 2] = g;
        out[o + 3] = colorType === 4 ? sample(row, base + 1) : 255;
      } else {
        out[o] = sample(row, base);
        out[o + 1] = sample(row, base + 1);
        out[o + 2] = sample(row, base + 2);
        out[o + 3] = colorType === 6 ? sample(row, base + 3) : 255;
      }
    }
  }
  return { width, height, data: out };
}

export interface EncodeOptions {
  /** Drop the alpha channel (store RGB). Defaults to true when every pixel is opaque. */
  opaque?: boolean;
  /** Row filter. `adaptive` picks the cheapest filter per row. */
  filter?: "none" | "sub" | "adaptive";
  /** zlib level 0-9. */
  level?: number;
}

/** Encode an RGBA8 image as a PNG. */
export function encodePng(image: RgbaImage, options: EncodeOptions = {}): Uint8Array {
  const { width, height, data } = image;
  let opaque = options.opaque;
  if (opaque === undefined) {
    opaque = true;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) {
        opaque = false;
        break;
      }
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const filtered = new Uint8Array((stride + 1) * height);
  const line = new Uint8Array(stride);
  const prevLine = new Uint8Array(stride);
  const candidates = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
  const mode = options.filter ?? "adaptive";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = x * channels;
      line[d] = data[s]!;
      line[d + 1] = data[s + 1]!;
      line[d + 2] = data[s + 2]!;
      if (channels === 4) line[d + 3] = data[s + 3]!;
    }
    const outRow = filtered.subarray(y * (stride + 1), (y + 1) * (stride + 1));
    if (mode === "none") {
      outRow[0] = 0;
      outRow.set(line, 1);
    } else {
      const [sub, up, pae] = candidates as [Uint8Array, Uint8Array, Uint8Array];
      for (let x = 0; x < stride; x++) {
        const left = x >= channels ? line[x - channels]! : 0;
        const above = prevLine[x]!;
        const upLeft = x >= channels ? prevLine[x - channels]! : 0;
        sub[x] = (line[x]! - left) & 0xff;
        up[x] = (line[x]! - above) & 0xff;
        pae[x] = (line[x]! - paeth(left, above, upLeft)) & 0xff;
      }
      if (mode === "sub") {
        outRow[0] = 1;
        outRow.set(sub, 1);
      } else {
        const options: [number, Uint8Array][] = [
          [0, line],
          [1, sub],
          [2, up],
          [4, pae],
        ];
        let best = options[0]!;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const option of options) {
          let score = 0;
          const bytes = option[1];
          for (let x = 0; x < stride; x++) {
            const v = bytes[x]!;
            score += v < 128 ? v : 256 - v;
          }
          if (score < bestScore) {
            bestScore = score;
            best = option;
          }
        }
        outRow[0] = best[0];
        outRow.set(best[1], 1);
      }
    }
    prevLine.set(line);
  }
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const idat = deflateSync(filtered, { level: options.level ?? 6 });
  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

/** Copy a rectangle out of an image, clamped to its bounds. */
export function cropImage(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
): RgbaImage {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + width));
  const y1 = Math.min(image.height, Math.ceil(y + height));
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const start = ((y0 + row) * image.width + x0) * 4;
    data.set(image.data.subarray(start, start + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

/** Draw a rectangle outline in place. */
export function strokeRect(
  image: RgbaImage,
  x: number,
  y: number,
  width: number,
  height: number,
  rgb: [number, number, number],
  thickness = 2,
): void {
  const set = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
    const o = (py * image.width + px) * 4;
    image.data[o] = rgb[0];
    image.data[o + 1] = rgb[1];
    image.data[o + 2] = rgb[2];
    image.data[o + 3] = 255;
  };
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + width) - 1;
  const y1 = Math.round(y + height) - 1;
  for (let t = 0; t < thickness; t++) {
    for (let px = x0 - t; px <= x1 + t; px++) {
      set(px, y0 - t);
      set(px, y1 + t);
    }
    for (let py = y0 - t; py <= y1 + t; py++) {
      set(x0 - t, py);
      set(x1 + t, py);
    }
  }
}
