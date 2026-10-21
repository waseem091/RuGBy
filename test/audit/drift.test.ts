import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "../../src/audit/run.js";
import type { DriftFinding, Report } from "../../src/audit/types.js";

interface Planted {
  kind: string;
  color: string;
  property: string;
  rule: string;
  likelyTypo: boolean;
  nearestToken?: string;
  occurrences: number;
  replacement?: string;
  cause?: string;
  schemes?: string[];
}

const expected = JSON.parse(readFileSync("fixtures/drift-app/expected.json", "utf8")) as {
  drift: Planted[];
};
const css = readFileSync("fixtures/drift-app/app.css", "utf8").split("\n");
/** 1-based line of the declaration inside a rule, located in app.css independently. */
function lineOf(rule: string): number {
  const selector = rule.slice(0, rule.indexOf(" {"));
  const decl = rule.slice(rule.indexOf("{") + 2, rule.lastIndexOf(" }"));
  const unescaped = selector.replace(/\\\\/g, "\\");
  const i = css.findIndex((l) => l.includes(`${unescaped} {`) && l.includes(decl));
  return i + 1;
}

let report: Report;
let drift: DriftFinding[];

beforeAll(async () => {
  report = await runAudit({
    targets: ["fixtures/drift-app/index.html"],
    tokens: "fixtures/drift-app/tokens.json",
    viewports: [375, 1440],
    schemes: ["light", "dark"],
    reportDir: null,
  });
  drift = report.findings.filter((f): f is DriftFinding => f.type === "drift");
}, 120_000);

describe("drift detection on the fixture app", () => {
  it("reports exactly the five planted colors and nothing else", () => {
    expect(drift.map((f) => `${f.color} ${f.property}`).sort()).toEqual(
      expected.drift.map((p) => `${p.color} ${p.property}`).sort(),
    );
  });

  for (const p of expected.drift) {
    it(`finds the ${p.kind} (${p.color}) and traces it to ${p.rule}`, () => {
      const f = drift.find((d) => d.color === p.color && d.property === p.property)!;
      expect(f).toBeDefined();
      expect(f.source?.rule).toBe(p.rule);
      expect(f.source?.stylesheet).toBe("local:/app.css");
      expect(f.source?.line).toBe(lineOf(p.rule));
      expect(f.likelyTypo).toBe(p.likelyTypo);
      if (p.likelyTypo) expect(f.label).toBe("likely-typo");
      expect(f.occurrences).toBe(p.occurrences);
      if (p.nearestToken) expect(f.nearestToken?.name).toBe(p.nearestToken);
      if (p.replacement) expect(f.suggestion?.replacement).toBe(p.replacement);
      if (p.cause) expect(f.cause).toContain(p.cause);
      if (p.schemes) expect(f.schemes).toEqual(p.schemes);
      expect(f.nearestToken!.deltaE).toBeGreaterThan(0);
    });
  }

  it("labels the near-copy as a likely typo (ΔE < 0.5)", () => {
    const typo = drift.find((d) => d.likelyTypo)!;
    expect(typo.nearestToken!.deltaE).toBeLessThan(0.5);
  });

  it("ranks findings by occurrences × ΔE", () => {
    const ranks = drift.map((f) => f.occurrences * f.nearestToken!.deltaE);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("tracks which tokens are used, unused and drifted", () => {
    const usage = new Map(report.tokenUsage!.map((t) => [t.name, t]));
    expect(usage.get("color.blue.600")!.used).toBeGreaterThan(0); // SVG fill + button
    expect(usage.get("color.overlay")!.used).toBeGreaterThan(0); // translucent scrim token
    expect(usage.get("color.black")!.used).toBeGreaterThan(0); // box-shadow
    expect(usage.get("color.gray.600")!.used).toBe(0);
    expect(usage.get("color.gray.500")!.drifted).toBe(4);
  });

  it("falls back to the page's :root custom properties when no token file is found", async () => {
    const fallback = await runAudit({
      targets: ["fixtures/drift-app/index.html"],
      viewports: [1440],
      schemes: ["light"],
      reportDir: null,
      cwd: "fixtures/pages", // no token files here
    });
    expect(fallback.tokens?.format).toBe("page");
    expect(fallback.tokens?.source).toBe("local:/index.html (:root custom properties)");
    const colors = fallback.findings
      .filter((f) => f.type === "drift")
      .map((f) => (f as DriftFinding).color);
    expect(colors).toContain("#5B6472");
    expect(colors).toContain("#6B7281");
  });

  it("is deterministic", async () => {
    const again = await runAudit({
      targets: ["fixtures/drift-app/index.html"],
      tokens: "fixtures/drift-app/tokens.json",
      viewports: [375, 1440],
      schemes: ["light", "dark"],
      reportDir: null,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(report));
  });
});
