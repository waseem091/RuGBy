/**
 * End-to-end: audit every fixture page at 375/1440 × light/dark and compare
 * with fixtures/expected/*.json (ratio ±0.05, pass/fail, background kind, axe).
 */
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../../src/audit/run.js";
import type { ContrastCheck, Report } from "../../src/audit/types.js";

interface Expectation {
  selector: string;
  ratio: number;
  pass: boolean;
  kind: string;
  axe: string;
  why: string;
  note?: string;
  schemes?: string[];
  viewports?: number[];
}
interface ExpectedFile {
  page: string;
  viewports: number[];
  schemes: string[];
  description: string;
  expect: Expectation[];
  absent?: string[];
}

const expected: ExpectedFile[] = readdirSync("fixtures/expected")
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(`fixtures/expected/${f}`, "utf8")));

let report: Report;
let elapsed = 0;

beforeAll(async () => {
  const t0 = Date.now();
  report = await runAudit({
    targets: expected.map((e) => `fixtures/pages/${e.page}`),
    tokens: null,
    includeChecks: true,
    reportDir: null,
    drift: false,
    darkClass: "dark",
    viewports: [375, 1440],
    schemes: ["light", "dark"],
    concurrency: 6,
  });
  elapsed = Date.now() - t0;
}, 120_000);

describe("fixture pages", () => {
  it("every fixture page has expected results", () => {
    const pages = readdirSync("fixtures/pages")
      .filter((f) => f.endsWith(".html"))
      .sort();
    expect(expected.map((e) => e.page).sort()).toEqual(pages);
  });

  it("audits all fixture pages at two viewports and two schemes in under 60 seconds", () => {
    expect(report.pages.every((p) => p.status === "ok")).toBe(true);
    expect(report.summary.states).toBe(expected.length * 4);
    expect(elapsed).toBeLessThan(60_000);
  });

  for (const file of expected) {
    describe(file.page, () => {
      for (const exp of file.expect) {
        const viewports = exp.viewports ?? file.viewports;
        const schemes = exp.schemes ?? file.schemes;
        for (const viewport of viewports) {
          for (const scheme of schemes) {
            it(`${exp.selector} @${viewport} ${scheme}: ${exp.why}`, () => {
              const check = report.checks!.find(
                (c: ContrastCheck) =>
                  c.page === `local:/${file.page}` &&
                  c.selector === exp.selector &&
                  c.viewport === viewport &&
                  c.scheme === scheme,
              );
              expect(check, `no measurement for ${exp.selector}`).toBeDefined();
              expect(Math.abs(check!.wcag.ratio - exp.ratio)).toBeLessThanOrEqual(0.05);
              expect(check!.wcag.pass).toBe(exp.pass);
              expect(check!.background.kind).toBe(exp.kind);
              expect(check!.axeVerdict).toBe(exp.axe);
              if (exp.note) expect((check!.notes ?? []).join(" ")).toContain(exp.note);
            });
          }
        }
      }
      for (const selector of file.absent ?? []) {
        it(`${selector} is not measured`, () => {
          expect(
            report.checks!.some((c) => c.page === `local:/${file.page}` && c.selector === selector),
          ).toBe(false);
        });
      }
    });
  }

  it("has at least five fixtures where axe says incomplete and RuGBy gives a definite, correct verdict", () => {
    const resolved = expected.flatMap((f) =>
      f.expect.filter((e) => e.axe === "incomplete").map((e) => `${f.page} ${e.selector}`),
    );
    expect(new Set(resolved.map((r) => r.split(" ")[0])).size).toBeGreaterThanOrEqual(5);
    expect(report.summary.axe.incompleteResolved).toBeGreaterThanOrEqual(resolved.length * 4);
  });
});
