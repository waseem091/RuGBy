/**
 * Every suggestion must actually pass: apply it to a copy of the fixture page,
 * re-render, re-measure, and check the element now passes. Also unit-test the
 * suggestion search against synthetic pixel histograms.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../../src/audit/run.js";
import type { ContrastFinding, Report } from "../../src/audit/types.js";
import { rgba } from "../../src/color/index.js";
import {
  adjustLightness,
  evaluateForeground,
  hueFamily,
  suggestContrastFix,
} from "../../src/suggest/contrast.js";
import { loadTokens } from "../../src/tokens/detect.js";
import type { TokenSet } from "../../src/tokens/types.js";

const PAGES = [
  "solid.html",
  "linear-gradient.html",
  "radial-gradient.html",
  "photo.html",
  "overlay-photo.html",
  "glass.html",
  "blend-difference.html",
  "text-shadow.html",
  "scroll-container.html",
  "fixed-header.html",
  "dark-media.html",
  "p3.html",
];

let report: Report;
let tokens: TokenSet;

beforeAll(async () => {
  tokens = (await loadTokens("fixtures/tokens/palette.tokens.json"))!;
  report = await runAudit({
    targets: PAGES.map((p) => `fixtures/pages/${p}`),
    tokens,
    viewports: [375, 1440],
    schemes: ["light", "dark"],
    reportDir: null,
    drift: false,
    concurrency: 6,
  });
}, 180_000);

describe("contrast suggestions", () => {
  it("suggest a token for every fixable failure", () => {
    const contrast = report.findings.filter((f): f is ContrastFinding => f.type === "contrast");
    expect(contrast.length).toBeGreaterThan(10);
    for (const f of contrast) {
      expect(f.suggestion, `${f.page} ${f.selector}`).toBeTruthy();
      expect(f.suggestion!.token).toMatch(/^color\./);
      expect(f.suggestion!.ratio!).toBeGreaterThanOrEqual(f.wcag.required);
    }
  });

  it("pass when applied to the page and re-measured", async () => {
    const contrast = report.findings.filter(
      (f): f is ContrastFinding =>
        f.type === "contrast" && !!f.suggestion && /^#[\w-]+$/.test(f.selector),
    );
    const dir = mkdtempSync(join(tmpdir(), "rugby-applied-"));
    cpSync("fixtures/pages", dir, { recursive: true });
    // One copy of each page per (viewport, scheme) so different suggestions don't collide.
    const targets: { file: string; finding: ContrastFinding }[] = [];
    contrast.forEach((f, i) => {
      const page = f.page.replace("local:/", "");
      const name = `applied-${i}-${page}`;
      const s = f.suggestion!;
      const rule =
        s.target === "foreground"
          ? `${f.selector}{color:${s.value}!important;-webkit-text-fill-color:${s.value}!important}`
          : `${f.selector}{background:${s.value}!important}`;
      const html = readFileSync(join(dir, page), "utf8").replace(
        "</head>",
        `<style>${rule}</style></head>`,
      );
      writeFileSync(join(dir, name), html);
      targets.push({ file: join(dir, name), finding: f });
    });
    for (const viewport of [375, 1440]) {
      for (const scheme of ["light", "dark"] as const) {
        const subset = targets.filter(
          (t) => t.finding.viewport === viewport && t.finding.scheme === scheme,
        );
        if (!subset.length) continue;
        const after = await runAudit({
          targets: subset.map((t) => t.file),
          tokens: null,
          viewports: [viewport],
          schemes: [scheme],
          reportDir: null,
          drift: false,
          axe: false,
          includeChecks: true,
          concurrency: 6,
        });
        for (const t of subset) {
          const name = t.file.split("/").pop()!;
          const check = after.checks!.find(
            (c) => c.page === `local:/${name}` && c.selector === t.finding.selector,
          );
          expect(check, `${name} ${t.finding.selector}`).toBeDefined();
          expect(
            check!.wcag.pass,
            `${name} ${t.finding.selector} → ${t.finding.suggestion!.value}: ${check!.wcag.ratio}`,
          ).toBe(true);
          expect(Math.abs(check!.wcag.ratio - t.finding.suggestion!.ratio!)).toBeLessThanOrEqual(
            0.1,
          );
        }
      }
    }
  }, 240_000);
});

describe("suggestion search", () => {
  const ctx = (
    hist: [string, number][],
    authored: string,
    extra: Partial<Parameters<typeof suggestContrastFix>[0]> = {},
  ) => ({
    authored: rgba(authored),
    opacity: 1,
    blendMode: "normal" as const,
    histogram: {
      colors: hist.map(([c]) => Number.parseInt(c.slice(1), 16)),
      counts: hist.map(([, n]) => n),
    },
    medianBg: rgba(hist[0]![0]),
    fontSizePx: 16,
    fontWeight: 400,
    level: "AA" as const,
    standard: "wcag2" as const,
    scheme: "light" as const,
    ...extra,
  });

  it("prefers the nearest passing token in the same family and group", () => {
    const c = ctx([["#ffffff", 100]], "#9ca3af");
    const s = suggestContrastFix(c, tokens.tokens)!;
    expect(s.token).toBe("color.gray.500");
    expect(evaluateForeground(rgba(s.value), c).pass).toBe(true);
    const blue = suggestContrastFix(ctx([["#ffffff", 100]], "#60a5fa"), tokens.tokens)!;
    expect(blue.token).toBe("color.blue.600");
  });

  it("evaluates against the whole background distribution, not one pixel", () => {
    // Half pale, half dark: no text color passes on both, so it proposes a background.
    const c = ctx(
      [
        ["#f9fafb", 50],
        ["#111827", 50],
      ],
      "#6b7280",
    );
    const s = suggestContrastFix(c, tokens.tokens)!;
    expect(s.target).toBe("background");
    expect(s.ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("returns null when nothing passes, and adjusts lightness when there are no tokens", () => {
    const faded = ctx([["#ffffff", 10]], "#111827", { opacity: 0.2 });
    expect(
      suggestContrastFix(faded, [
        { ...tokens.tokens[0]!, rgba: rgba("#ffffff"), value: "#FFFFFF" },
      ]),
    ).toBeNull();
    const c = ctx([["#ffffff", 10]], "#9ca3af");
    const adjusted = adjustLightness(c)!;
    expect(evaluateForeground(adjusted, c).pass).toBe(true);
    const s = suggestContrastFix(c, [])!;
    expect(s.token).toBeUndefined();
    expect(s.replacement).toMatch(/^color: #/);
  });

  it("respects APCA and modes", () => {
    const c = ctx([["#ffffff", 10]], "#6b7280", { standard: "apca" });
    const s = suggestContrastFix(c, tokens.tokens)!;
    expect(Math.abs(s.lc!)).toBeGreaterThanOrEqual(90);
    const dark = {
      ...tokens.tokens.find((t) => t.name === "color.gray.900")!,
      name: "color.night",
      mode: "dark",
    };
    // A dark-mode-only token is not offered in light mode; a computed color is suggested instead.
    expect(suggestContrastFix(ctx([["#ffffff", 10]], "#9ca3af"), [dark])!.token).toBeUndefined();
    expect(
      suggestContrastFix(ctx([["#ffffff", 10]], "#9ca3af", { scheme: "dark" }), [dark])!.token,
    ).toBe("color.night");
    expect(hueFamily(rgba("#777"))).toBe("neutral");
    expect(hueFamily(rgba("#ff0000"))).toMatch(/^hue-/);
  });
});
