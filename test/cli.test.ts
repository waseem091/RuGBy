import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { checkContrast } from "../src/check.js";

function rugby(...args: string[]) {
  const r = spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("checkContrast", () => {
  it("reports WCAG and APCA for a pair", () => {
    const r = checkContrast("#777", "#fff");
    expect(r.wcag).toEqual({
      ratio: 4.48,
      required: 4.5,
      pass: false,
      AA: { normal: false, large: true },
      AAA: { normal: false, large: false },
    });
    expect(r.apca.lc).toBeCloseTo(71.1, 1);
    expect(r.apca.required).toBe(90);
    expect(r.notes).toEqual([]);
  });

  it("composites translucent colors and notes gamut mapping", () => {
    const r = checkContrast("rgb(0 0 0 / 0.5)", "color(display-p3 1 1 0 / 0.5)", {
      fontSizePx: 24,
      fontWeight: 700,
      level: "AAA",
    });
    expect(r.largeText).toBe(true);
    expect(r.wcag.required).toBe(4.5);
    expect(r.notes).toEqual([
      "background is outside sRGB (display-p3); gamut-mapped in OKLCH",
      "background is translucent; composited over white",
      "foreground is translucent; composited over the background",
    ]);
  });
});

describe("rugby CLI", () => {
  it("prints help", () => {
    const r = rugby("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: rugby");
    for (const cmd of ["audit", "tokens", "contrast", "fixture"]) expect(r.stdout).toContain(cmd);
  });

  it("contrast: text and JSON output", () => {
    const text = rugby("contrast", "#777", "#fff");
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("4.48:1  fail AA (needs 4.5:1)");
    const json = JSON.parse(rugby("contrast", "#000", "#fff", "--json").stdout);
    expect(json.wcag.ratio).toBe(21);
  });

  it("exits 2 on bad input with an actionable message", () => {
    const r = rugby("contrast", "blue-ish", "#fff");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Could not parse "blue-ish" as a CSS color');
    expect(rugby("contrast", "#000", "#fff", "--level", "A").code).toBe(2);
    expect(rugby("nope").code).toBe(2);
  });

  it("tokens: prints a table, JSON, and errors", () => {
    const r = rugby("tokens", "fixtures/tokens/palette.tokens.json");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/color\.gray\.500\s+#6B7280/);
    const json = JSON.parse(rugby("tokens", "fixtures/tokens/theme.css", "--json").stdout);
    expect(json.format).toBe("css");
    const bad = rugby("tokens", "fixtures/tokens/circular.tokens.json");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("Circular alias");
  });
});
