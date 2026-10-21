import { describe, expect, it } from "vitest";
import type { ColorNode } from "../../src/audit/page-script.js";
import { rgba, toHex } from "../../src/color/index.js";
import { classifyColor, exactRawToken, nearestToken } from "../../src/drift/match.js";
import { renderColor } from "../../src/drift/render.js";
import {
  groupDrift,
  pageTokenSet,
  replacementFor,
  tailwindName,
  tokenUsage,
} from "../../src/drift/stage.js";
import { makeToken } from "../../src/tokens/normalize.js";

const node = (bg: string, extra: Partial<ColorNode> = {}): ColorNode => ({
  bg,
  opacity: 1,
  filter: "none",
  bgImage: false,
  parent: -1,
  ...extra,
});

const tokens = [
  makeToken({ name: "color.white", value: "#ffffff" }),
  makeToken({ name: "color.gray.500", value: "#6b7280" }),
  makeToken({ name: "color.blue.500", value: "#3b82f6" }),
  makeToken({ name: "color.overlay", value: "rgba(17, 24, 39, 0.5)" }),
];

describe("renderColor", () => {
  it("leaves opaque colors untouched", () => {
    const r = renderColor(
      "color",
      "rgb(107, 114, 128)",
      0,
      [node("rgba(0, 0, 0, 0)")],
      "rgb(255, 255, 255)",
    )!;
    expect(toHex(r.rendered)).toBe("#6B7280");
    expect(r.causes).toEqual([]);
    expect(r.modified).toBe(false);
  });

  it("composites an opacity group over what is behind it, not over its own background", () => {
    // A white-text badge (blue bg, opacity .6) on white: text stays white, bg fades.
    const nodes = [
      node("rgb(255, 255, 255)"),
      node("rgb(59, 130, 246)", { opacity: 0.6, parent: 0 }),
    ];
    const text = renderColor("color", "rgb(255, 255, 255)", 1, nodes, "rgb(255, 255, 255)")!;
    expect(toHex(text.rendered)).toBe("#FFFFFF");
    const bg = renderColor(
      "background-color",
      "rgb(59, 130, 246)",
      1,
      nodes,
      "rgb(255, 255, 255)",
    )!;
    expect(toHex(bg.rendered)).toBe("#89B4FA");
    expect(bg.causes).toEqual(["opacity 0.6"]);
  });

  it("applies filters and flags image backdrops", () => {
    const nodes = [
      node("rgb(0, 0, 0)", { bgImage: true }),
      node("rgb(251, 191, 36)", { filter: "brightness(0.5)", parent: 0 }),
    ];
    const r = renderColor("background-color", "rgb(251, 191, 36)", 1, nodes, "rgb(255, 255, 255)")!;
    expect(toHex(r.rendered)).toBe("#7E6012");
    expect(r.causes).toContain("filter: brightness(0.5)");
    const translucent = renderColor(
      "background-color",
      "rgba(0, 0, 0, 0.5)",
      1,
      nodes,
      "rgb(255, 255, 255)",
    )!;
    expect(translucent.unknownBackdrop).toBe(true);
    expect(translucent.causes.at(-1)).toMatch(/background image/);
  });

  it("uses the canvas color at the root and compares box-shadow colors as authored", () => {
    const r = renderColor(
      "background-color",
      "rgba(0, 0, 0, 0.5)",
      0,
      [node("rgba(0, 0, 0, 0)")],
      "rgb(18, 18, 18)",
    )!;
    expect(toHex(r.rendered)).toBe("#090909");
    const shadow = renderColor("box-shadow", "rgba(0, 0, 0, 0.1)", 0, [node("white")], "white")!;
    expect(toHex(shadow.rendered)).toBe("#000000");
    expect(renderColor("color", "nope", 0, [node("white")], "white")).toBeNull();
    expect(renderColor("color", "red", 5, [node("white")], "white")).toBeNull();
  });
});

describe("token matching", () => {
  it("finds the nearest opaque token and exact translucent tokens", () => {
    expect(nearestToken(rgba("#6b7281"), tokens)!.token.name).toBe("color.gray.500");
    expect(nearestToken(rgba("#000"), [tokens[3]!])).toBeNull();
    expect(exactRawToken(rgba("rgba(17,24,39,.5)"), tokens)!.name).toBe("color.overlay");
  });

  it("classifies exact, typo, near and off-token colors", () => {
    const c = (hex: string, modified = false) =>
      classifyColor(rgba(hex), rgba(hex), modified, tokens, 2).status;
    expect(c("#6b7280")).toBe("exact");
    expect(c("#6b7281")).toBe("typo");
    expect(c("#6b7281", true)).toBe("near");
    expect(c("#6f7584")).toBe("near");
    expect(c("#ff00ff")).toBe("off");
    expect(classifyColor(rgba("#808080"), rgba("rgba(17,24,39,.5)"), false, tokens, 2).status).toBe(
      "exact",
    );
    expect(classifyColor(rgba("#123456"), rgba("#123456"), false, [], 2)).toEqual({
      status: "off",
      match: null,
    });
  });
});

describe("replacements and grouping", () => {
  const gray = tokens[1]!;
  const src = (selector: string, value: string) => ({
    rule: `${selector} { color: ${value} }`,
    selector,
    declaration: `color: ${value}`,
    value,
    stylesheet: "local:/app.css",
    line: 3,
    origin: "regular",
    inherited: false,
  });

  it("writes Tailwind, literal and generic replacements", () => {
    expect(tailwindName(gray)).toBe("gray-500");
    expect(
      replacementFor(
        { property: "color", source: src(".text-\\[\\#6b7281\\]", "#6b7281"), causes: [] },
        gray,
      ),
    ).toBe("text-[#6b7281] → text-gray-500");
    expect(
      replacementFor(
        {
          property: "color",
          source: src(".hover\\:text-\\[\\#6b7281\\]:hover", "#6b7281"),
          causes: [],
        },
        gray,
      ),
    ).toBe("hover:text-[#6b7281] → hover:text-gray-500");
    expect(
      replacementFor({ property: "color", source: src(".muted", "rgb(1 2 3)"), causes: [] }, gray),
    ).toBe("rgb(1 2 3) → var(--color-gray-500)");
    expect(
      replacementFor(
        { property: "color", source: src(".x", "var(--brand)"), causes: ["opacity 0.5"] },
        gray,
      ),
    ).toBe("color: var(--brand) → color: var(--color-gray-500) (renders opacity 0.5)");
    expect(replacementFor({ property: "fill", source: null, causes: [] }, gray)).toBe(
      "fill: var(--color-gray-500)",
    );
  });

  it("groups by color, property and rule across states and pages", () => {
    const entry = (page: string, selector: string, viewport: number) => ({
      index: 0,
      property: "color",
      value: "#6b7281",
      rendered: rgba("#6b7281"),
      status: "typo" as const,
      match: { token: gray, deltaE: 0.16 },
      causes: [],
      source: src(".muted", "#6b7281"),
      selector,
      page,
      viewport,
      scheme: "light" as const,
    });
    const findings = groupDrift([
      entry("a", "p.muted", 375),
      entry("a", "p.muted", 1440),
      entry("b", "span.muted", 375),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      occurrences: 2,
      viewports: [375, 1440],
      alsoOn: ["b"],
      label: "likely-typo",
    });
    const usage = tokenUsage(pageTokenSet("x", tokens), new Map([["color.white", 3]]), findings);
    expect(usage.find((u) => u.name === "color.white")!.used).toBe(3);
    expect(usage.find((u) => u.name === "color.gray.500")!.drifted).toBe(2);
    expect(tokenUsage(null, new Map(), findings)).toEqual([]);
    expect(pageTokenSet("x", [])).toBeNull();
  });
});
