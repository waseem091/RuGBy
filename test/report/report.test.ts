import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AjvModule from "ajv";
import { beforeAll, describe, expect, it } from "vitest";
import { launchBrowser } from "../../src/audit/browser.js";
import { runAudit } from "../../src/audit/run.js";
import type { ContrastFinding, Report } from "../../src/audit/types.js";
import { renderHtml, writeHtmlReport } from "../../src/report/html.js";
import { formatTerminal } from "../../src/report/terminal.js";
import { SAMPLE_REPORT } from "./sample-report.js";

const schema = JSON.parse(readFileSync("schema/report.schema.json", "utf8"));
// ajv is CommonJS: under NodeNext its class is the `default` export of the module object.
const ajv = new AjvModule.default({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  validateFormats: false,
});
const validate = ajv.compile(schema);

let report: Report;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "rugby-report-"));
  report = await runAudit({
    targets: [
      "fixtures/pages/linear-gradient.html",
      "fixtures/pages/glass.html",
      "fixtures/drift-app/index.html",
    ],
    tokens: "fixtures/drift-app/tokens.json",
    viewports: [375, 1440],
    schemes: ["light", "dark"],
    reportDir: join(dir, "out"),
    includeChecks: true,
    timestamps: true,
  });
  await writeHtmlReport(report, join(dir, "out", "index.html"));
}, 180_000);

describe("JSON report", () => {
  it("accepts the documented sample report", () => {
    expect(validate(SAMPLE_REPORT)).toBe(true);
  });

  it("validates against schema/report.schema.json", () => {
    const ok = validate(JSON.parse(JSON.stringify(report)));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
    expect(report.findings.some((f) => f.type === "contrast")).toBe(true);
    expect(report.findings.some((f) => f.type === "drift")).toBe(true);
    expect(report.checks!.length).toBeGreaterThan(0);
  });

  it("rejects malformed reports", () => {
    expect(validate({ ...report, extra: 1 })).toBe(false);
    const bad = JSON.parse(JSON.stringify(report));
    bad.findings[0].wcag.ratio = 42;
    expect(validate(bad)).toBe(false);
  });

  it("has no timestamp unless asked, and writes screenshots and report.json", async () => {
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const shot = (report.findings.find((f) => f.type === "contrast") as ContrastFinding)
      .screenshot!;
    expect(shot).toMatch(/shots\/0001\.png$/);
    expect(
      readFileSync(join(dir, "out", "shots", "0001.png"))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    const written = JSON.parse(readFileSync(join(dir, "out", "report.json"), "utf8"));
    expect(written.summary).toEqual(report.summary);
  });
});

describe("HTML report", () => {
  it("opens offline in headless Chromium without console errors, in both themes and on a phone", async () => {
    const browser = await launchBrowser();
    try {
      for (const [width, scheme] of [
        [1280, "light"],
        [390, "dark"],
      ] as const) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          colorScheme: scheme,
        });
        const errors: string[] = [];
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("request", (r) => {
          if (!r.url().startsWith("file:")) errors.push(`network request: ${r.url()}`);
        });
        await page.goto(`file://${join(dir, "out", "index.html")}`);
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        const total = report.findings.length;
        expect(await page.locator(".finding").count()).toBe(total);
        await expect(page.locator(".headline strong").textContent()).resolves.toMatch(
          /^axe missed \d+ issues? that RuGBy caught\.$/,
        );
        // Filters work.
        await page.click('[data-filter-type="drift"]');
        const drift = report.findings.filter((f) => f.type === "drift").length;
        expect(await page.locator(".finding:not([hidden])").count()).toBe(drift);
        await page.fill("#f-search", "likely");
        await page.click('[data-filter-type="all"]');
        await page.fill("#f-search", "#cta");
        expect(await page.locator(".finding:not([hidden])").count()).toBeGreaterThan(0);
        // Images load.
        const broken = await page.evaluate(
          () =>
            Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length,
        );
        expect(broken).toBe(0);
        // Theme toggle.
        await page.click("#theme");
        expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(
          scheme === "dark" ? "light" : "dark",
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("shows a token palette and escapes page content", () => {
    const html = renderHtml({
      ...report,
      findings: [
        {
          ...(report.findings.find((f) => f.type === "contrast") as ContrastFinding),
          text: `<img src=x onerror="alert(1)">`,
        },
      ],
    });
    expect(html).not.toContain(`<img src=x`);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Token palette");
    expect(renderHtml({ ...report, findings: [] })).toContain("No contrast or drift findings");
  });
});

describe("terminal output", () => {
  it("is quiet when clean", () => {
    const clean: Report = { ...SAMPLE_REPORT, findings: [] };
    expect(formatTerminal(clean)).toMatchInlineSnapshot(`
      "RuGBy · 2 pages · 375,1440px × light,dark · tokens: dtcg (18)
      ✔ No contrast or drift findings (42 text elements checked)
      "
    `);
  });

  it("groups findings by page and matches the snapshot", () => {
    const out = formatTerminal(SAMPLE_REPORT, { htmlPath: "rugby-report/index.html" });
    expect(out).toMatchSnapshot();
    expect(out.includes("\u001b[")).toBe(false);
    expect(formatTerminal(SAMPLE_REPORT, { color: true }).includes("\u001b[")).toBe(true);
    expect(formatTerminal(SAMPLE_REPORT, { limit: 1 })).toContain("… 4 more in the full report");
  });
});
