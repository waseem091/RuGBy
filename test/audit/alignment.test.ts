/**
 * Screenshot crops must show the element they describe, even on pages that
 * re-lay-out during Chromium's first full-page capture (fixtures/pages/code-grid.html
 * shifts by ~100px at 375px wide). Only the last card has light gray text, so a
 * misaligned crop would contain none of it.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runAudit } from "../../src/audit/run.js";
import type { ContrastFinding } from "../../src/audit/types.js";
import { deltaE, fromBytes, rgba } from "../../src/color/index.js";
import { decodePng } from "../../src/util/png.js";

it("crops the right place on a page that shifts during capture", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "rugby-align-"));
  const report = await runAudit({
    targets: [join(process.cwd(), "fixtures/pages/code-grid.html")],
    tokens: null,
    viewports: [375],
    schemes: ["light"],
    reportDir: "out",
    cwd,
  });
  const finding = report.findings.find(
    (f): f is ContrastFinding => f.type === "contrast" && f.selector === "#muted-last",
  );
  expect(finding?.screenshot).toBeDefined();
  const crop = decodePng(readFileSync(join(cwd, finding!.screenshot!)));
  const gray = rgba("#9ca3af");
  let glyph = 0;
  for (let i = 0; i < crop.data.length; i += 4) {
    const px = fromBytes(crop.data[i]!, crop.data[i + 1]!, crop.data[i + 2]!);
    if (deltaE(px, gray) < 4) glyph++;
  }
  expect(glyph).toBeGreaterThan(20);
}, 120_000);
