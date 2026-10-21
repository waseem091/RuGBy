import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { viewportHeight } from "../../src/audit/browser.js";
import { resolveOptions } from "../../src/audit/options.js";
import type { CollectResult, RawTextItem } from "../../src/audit/page-script.js";
import {
  classifyBackground,
  pixelsInRects,
  renderText,
  sampleContrast,
} from "../../src/audit/sample.js";
import { cropFinding, moved } from "../../src/audit/state.js";
import { parseSitemap, RateLimiter, resolveTargets } from "../../src/audit/targets.js";
import { rgba, toHex } from "../../src/color/index.js";
import { serveStatic } from "../../src/server/static.js";
import { decodePng, type RgbaImage } from "../../src/util/png.js";

function canvas(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

describe("pixel sampling", () => {
  it("collects unique pixels in rects, clamped to the image", () => {
    const img = canvas(10, 10, () => [0, 0, 0]);
    // Only fully covered pixels count…
    expect(pixelsInRects(img, [{ x: 8.5, y: 8.5, w: 5, h: 5 }])).toEqual(Uint32Array.from([99]));
    expect(pixelsInRects(img, [{ x: 0.5, y: 0.5, w: 3, h: 1.5 }])).toEqual(
      Uint32Array.from([11, 12]),
    );
    // …unless the box is thinner than a pixel, then partly covered pixels are used.
    expect(pixelsInRects(img, [{ x: 2.2, y: 3.2, w: 0.6, h: 0.6 }])).toEqual(
      Uint32Array.from([32]),
    );
    expect(
      pixelsInRects(img, [
        { x: 0, y: 0, w: 2, h: 1 },
        { x: 1, y: 0, w: 2, h: 1 },
      ]),
    ).toEqual(Uint32Array.from([0, 1, 2]));
  });

  it("measures a solid background exactly", () => {
    const img = canvas(40, 20, () => [255, 255, 255]);
    const s = sampleContrast(img, [{ x: 0, y: 0, w: 40, h: 20 }], rgba("#777"), "normal")!;
    expect(s.ratio).toBeCloseTo(4.478, 3);
    expect(s.min).toBe(s.ratio);
    expect(s.spread).toBe(0);
    expect(s.count).toBe(800);
    expect(classifyBackground(s.spread, { gradient: false, image: false })).toBe("solid");
  });

  it("uses the 5th percentile, so a few stray pixels do not decide", () => {
    // 98% white, 2% dark gray: black text fails only on the gray, so p5 is still white.
    const img = canvas(100, 1, (x) => (x < 2 ? [40, 40, 40] : [255, 255, 255]));
    const s = sampleContrast(img, [{ x: 0, y: 0, w: 100, h: 1 }], rgba("#000"), "normal")!;
    expect(s.min).toBeLessThan(1.5);
    expect(s.ratio).toBeCloseTo(21, 6);
    expect(s.median).toBeCloseTo(21, 6);
  });

  it("finds the worst plateau on a gradient and reports the spread", () => {
    const img = canvas(200, 4, (x) => {
      const v = x < 50 ? 147 : Math.round(147 - ((x - 50) / 150) * 100);
      return [v, v, v];
    });
    const s = sampleContrast(img, [{ x: 0, y: 0, w: 200, h: 4 }], rgba("#fff"), "normal")!;
    expect(toHex(rgba(`rgb(${s.worst.join(" ")})`))).toBe("#939393");
    expect(s.spread).toBeGreaterThan(2.5);
    expect(classifyBackground(s.spread, { gradient: true, image: false })).toBe("gradient");
    expect(classifyBackground(s.spread, { gradient: true, image: true })).toBe("image");
    expect(classifyBackground(s.spread, { gradient: false, image: false })).toBe("mixed");
  });

  it("ignores leftover glyph pixels near the foreground color", () => {
    const img = canvas(10, 10, (x) => (x === 0 ? [119, 119, 119] : [255, 255, 255]));
    const s = sampleContrast(img, [{ x: 0, y: 0, w: 10, h: 10 }], rgba("#777"), "normal")!;
    expect(s.count).toBe(90);
    // …unless every pixel matches the foreground: then the text really is invisible.
    const same = canvas(4, 4, () => [119, 119, 119]);
    expect(sampleContrast(same, [{ x: 0, y: 0, w: 4, h: 4 }], rgba("#777"), "normal")!.ratio).toBe(
      1,
    );
  });

  it("composites translucent text and applies blend modes per pixel", () => {
    const img = canvas(4, 4, () => [128, 128, 128]);
    const blended = sampleContrast(img, [{ x: 0, y: 0, w: 4, h: 4 }], rgba("#fff"), "difference")!;
    expect(toHex(blended.renderedFg)).toBe("#7F7F7F");
    expect(toHex(renderText(rgba("rgb(0 0 0 / 0.5)"), rgba("#fff"), "normal"))).toBe("#808080");
  });

  it("subsamples large areas deterministically and returns null for empty areas", () => {
    const img = canvas(300, 300, (x, y) => [(x * 7) & 255, (y * 3) & 255, 90]);
    const a = sampleContrast(img, [{ x: 0, y: 0, w: 300, h: 300 }], rgba("#000"), "normal", {
      maxPixels: 1000,
    })!;
    const b = sampleContrast(img, [{ x: 0, y: 0, w: 300, h: 300 }], rgba("#000"), "normal", {
      maxPixels: 1000,
    })!;
    expect(a.count).toBe(1000);
    expect(a).toEqual(b);
    expect(
      sampleContrast(img, [{ x: 400, y: 400, w: 5, h: 5 }], rgba("#000"), "normal"),
    ).toBeNull();
  });
});

describe("crops", () => {
  const item = (index: number, x: number, y: number): RawTextItem => ({
    index,
    text: "t",
    rects: [{ x, y, w: 10, h: 10 }],
    color: "#000",
    opacity: 1,
    blendMode: "normal",
    fontSizePx: 16,
    fontWeight: 400,
    textShadow: false,
    textStroke: false,
    hints: { gradient: false, image: false, backdropFilter: false },
    inFrame: false,
  });
  it("detects text boxes that moved between two collections", () => {
    const collect = (items: RawTextItem[]): CollectResult => ({
      items,
      skipped: { clipped: 0, transparent: 0, hidden: 0, disabled: 0 },
      docWidth: 100,
      docHeight: 100,
      frames: { sameOrigin: 0, crossOrigin: 0 },
    });
    const a = collect([item(0, 0, 0), item(1, 0, 40)]);
    expect(moved(a, collect([item(0, 0, 0.5), item(1, 0, 40.5)]))).toBe(false);
    expect(moved(a, collect([item(0, 0, 0), item(1, 0, 60)]))).toBe(true);
    expect(moved(a, collect([item(0, 0, 0)]))).toBe(true);
    expect(moved(a, collect([item(0, 0, 0), { ...item(1, 0, 40), rects: [] }]))).toBe(true);
  });

  it("crops the text box with padding and an outline", () => {
    const img = canvas(100, 100, () => [255, 255, 255]);
    expect(cropFinding(img, [{ x: 500, y: 500, w: 20, h: 10 }])).toBeUndefined();
    expect(cropFinding(img, [])).toBeUndefined();
    const png = decodePng(cropFinding(img, [{ x: 40, y: 40, w: 20, h: 10 }])!);
    expect([png.width, png.height]).toEqual([52, 42]);
    expect(Array.from(png.data.subarray((14 * 52 + 14) * 4, (14 * 52 + 14) * 4 + 3))).toEqual([
      255, 0, 170,
    ]);
  });
});

describe("options, targets and politeness", () => {
  it("validates options with actionable errors", () => {
    expect(resolveOptions({ targets: ["x"] }).viewports).toEqual([375, 1440]);
    expect(() => resolveOptions({ targets: [], viewports: [10] })).toThrow(/between 200 and 4000/);
    expect(() => resolveOptions({ targets: [], schemes: ["dim" as "dark"] })).toThrow(
      /light and\/or dark/,
    );
    expect(() => resolveOptions({ targets: [], standard: "x" as "apca" })).toThrow(
      /wcag2, apca or both/,
    );
    expect(() => resolveOptions({ targets: [], level: "A" as "AA" })).toThrow(/AA or AAA/);
    expect(() => resolveOptions({ targets: [], driftThreshold: -1 })).toThrow(/drift-threshold/);
    expect(viewportHeight(375)).toBe(812);
    expect(viewportHeight(768)).toBe(1024);
    expect(viewportHeight(1440)).toBe(900);
  });

  it("parses sitemaps and sitemap indexes", () => {
    const xml = `<urlset><url><loc> https://a.dev/ </loc></url><url><loc>https://a.dev/b?x=1&amp;y=2</loc></url></urlset>
      <sitemapindex><sitemap><loc>https://a.dev/more.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual({
      pages: ["https://a.dev/", "https://a.dev/b?x=1&y=2"],
      sitemaps: ["https://a.dev/more.xml"],
    });
  });

  it("serves local files and directories over one static server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rugby-site-"));
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "index.html"), "<h1>home</h1>");
    await writeFile(join(dir, "docs", "a.html"), "<h1>a</h1>");
    await writeFile(join(dir, "style.css"), "body{}");
    const { urls, servers } = await resolveTargets([dir, "https://example.com/x"], {
      maxPages: 10,
    });
    try {
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
      expect(urls[1]).toMatch(/\/docs\/a\.html$/);
      expect(urls[2]).toBe("https://example.com/x");
      const base = servers[0]!.url;
      expect(await (await fetch(`${base}/docs/a.html`)).text()).toBe("<h1>a</h1>");
      expect((await fetch(`${base}/style.css`)).headers.get("content-type")).toContain("text/css");
      expect((await fetch(`${base}/`)).status).toBe(200);
      expect((await fetch(`${base}/docs/a`)).status).toBe(200);
      expect((await fetch(`${base}/missing`)).status).toBe(404);
      expect((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status).not.toBe(200);
      expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    } finally {
      await Promise.all(servers.map((s) => s.close()));
    }
  });

  it("rejects missing paths, empty directories and file:// URLs", async () => {
    await expect(resolveTargets(["/definitely/not/here"], { maxPages: 1 })).rejects.toThrow(
      /Not a URL, file or directory/,
    );
    await expect(
      resolveTargets([await mkdtemp(join(tmpdir(), "rugby-empty-"))], { maxPages: 1 }),
    ).rejects.toThrow(/No .html files/);
    await expect(resolveTargets(["file:///x.html"], { maxPages: 1 })).rejects.toThrow(/file:\/\//);
    await expect(resolveTargets([], { maxPages: 1 })).rejects.toThrow(/Nothing to audit/);
  });

  it("expands sitemaps (and nested sitemap indexes) into page URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rugby-sitemap-"));
    const s = await serveStatic(dir);
    try {
      await writeFile(
        join(dir, "sitemap.xml"),
        `<sitemapindex><sitemap><loc>${s.url}/pages.xml</loc></sitemap></sitemapindex>`,
      );
      await writeFile(
        join(dir, "pages.xml"),
        `<urlset><url><loc>${s.url}/a.html</loc></url><url><loc>${s.url}/b.html</loc></url><url><loc>${s.url}/c.html</loc></url></urlset>`,
      );
      const { urls } = await resolveTargets([], { sitemap: `${s.url}/sitemap.xml`, maxPages: 2 });
      expect(urls).toEqual([`${s.url}/a.html`, `${s.url}/b.html`]);
      await expect(
        resolveTargets([], { sitemap: `${s.url}/missing.xml`, maxPages: 2 }),
      ).rejects.toThrow(/HTTP 404/);
    } finally {
      await s.close();
    }
  });

  it("serves a single file", async () => {
    const s = await serveStatic("fixtures/pages");
    try {
      expect((await fetch(`${s.url}/photo.png`)).headers.get("content-type")).toBe("image/png");
    } finally {
      await s.close();
    }
  });

  it("spaces navigations to the same public host, not to localhost", async () => {
    const limiter = new RateLimiter(150);
    const t0 = Date.now();
    await limiter.wait("https://a.example/1");
    await limiter.wait("https://a.example/2");
    await limiter.wait("https://b.example/1");
    await limiter.wait("http://localhost:3000/");
    await limiter.wait("http://127.0.0.1:8080/");
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(400);
  });
});
