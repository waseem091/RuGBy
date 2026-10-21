/**
 * Compute fixtures/expected/*.json from first principles: each fixture is
 * designed so its worst-case background is a known flat color (a plateau in a
 * gradient or photo, a scrim over white, a blurred stripe average). Uses culori
 * as an independent oracle for luminance and CSS Color 4 gamut mapping.
 *   node scripts/compute-expected.mjs
 */
import { writeFileSync } from "node:fs";
import { formatHex, parse, toGamut, wcagContrast } from "culori";

const rgb = (hex) => {
  const c = parse(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
};
const css = ([r, g, b]) => ({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 });
const over = (fg, a, bg) => fg.map((c, i) => a * c + (1 - a) * bg[i]);
const ratio = (fg, bg) => Math.round(wcagContrast(css(fg), css(bg)) * 100) / 100;
const diff = (a, b) => a.map((c, i) => Math.abs(c - b[i]));

const W = rgb("#ffffff");
const ALL = { viewports: [375, 1440], schemes: ["light", "dark"] };
const e = (selector, fg, bg, kind, axe, why, extra = {}) => {
  const r = ratio(fg, bg);
  return { selector, ratio: r, pass: r >= (extra.required ?? 4.5), kind, axe, why, ...extra };
};
const strip = (x) => {
  const { required, ...rest } = x;
  return rest;
};

const stripeAvg = rgb("#1e3a8a").map((c, i) => (c + rgb("#3b82f6")[i]) / 2);
const glassBg = over(W, 0.15, stripeAvg).map(Math.round);
const p3 = toGamut("rgb", "oklch")(parse("color(display-p3 0.25 0.45 1)"));
const p3InGamut = parse("color(display-p3 0.2 0.2 0.25)");
const toRgb = (c) => rgb(formatHex({ ...c, mode: "rgb" }));

const pages = {
  "solid.html": {
    description: "Baseline: solid backgrounds, where axe and RuGBy should agree.",
    expect: [
      e("#pass", rgb("#111827"), W, "solid", "pass", "gray 900 on white"),
      e("#fail", rgb("#9ca3af"), W, "solid", "fail", "gray 400 on white"),
      e("#large-pass", rgb("#6b7280"), W, "solid", "pass", "24px is large text: needs 3:1", {
        required: 3,
      }),
      e(
        "#bold-large",
        rgb("#9ca3af"),
        W,
        "solid",
        "fail",
        "19px bold is large text (≥18.66px bold) but 2.54 < 3",
        { required: 3 },
      ),
      e("#on-dark", rgb("#e5e7eb"), rgb("#1f2937"), "solid", "pass", "gray 200 on gray 800"),
    ],
  },
  "linear-gradient.html": {
    description: "Text on CSS linear gradients with a flat 120px plateau where the text starts.",
    expect: [
      e(
        "#cta",
        W,
        rgb("#93c5fd"),
        "gradient",
        "incomplete",
        "white text; the worst background is the #93c5fd plateau under the first words",
      ),
      e(
        "#soft",
        rgb("#111827"),
        rgb("#bfdbfe"),
        "gradient",
        "incomplete",
        "dark text; the darkest background is the #bfdbfe plateau",
      ),
    ],
  },
  "radial-gradient.html": {
    description: "Text on a radial gradient whose bright 150px core sits behind the first words.",
    expect: [
      e("#burst", W, rgb("#fde68a"), "gradient", "incomplete", "white text over the #fde68a core"),
    ],
  },
  "photo.html": {
    description:
      "A caption set directly on a photo (synthetic, with a pale #e2e8f0 sky plateau at x < 260).",
    expect: [
      e(
        "#caption",
        W,
        rgb("#e2e8f0"),
        "image",
        "incomplete",
        "white text over the pale sky plateau",
      ),
    ],
  },
  "overlay-photo.html": {
    description: "White text on a 40% black scrim over a photo whose left 260px are pure white.",
    expect: [
      e(
        "#overlay-text",
        W,
        over([0, 0, 0], 0.4, W).map(Math.round),
        "image",
        "incomplete",
        "rgba(0,0,0,.4) over #fff = #999999",
      ),
    ],
  },
  "blend-difference.html": {
    description:
      "mix-blend-mode: difference. The rendered text color is |text − backdrop| per channel.",
    expect: [
      e(
        "#blend-fail",
        diff(W, rgb("#808080")),
        rgb("#808080"),
        "solid",
        "fail",
        "|#fff − #808080| = #7f7f7f on #808080",
      ),
      e(
        "#blend-pass",
        diff(W, rgb("#e5e7eb")),
        rgb("#e5e7eb"),
        "solid",
        "fail",
        "|#fff − #e5e7eb| = #1a1814 on #e5e7eb; axe ignores the blend and reports white on #e5e7eb (a false positive)",
      ),
    ],
  },
  "glass.html": {
    description:
      "A backdrop-filter: blur(24px) glass card (rgba(255,255,255,.15)) over 4px blue stripes.",
    expect: [
      e(
        "#glass-text",
        W,
        glassBg,
        "solid",
        "incomplete",
        "blur averages the stripes to their mean; white at 15% over it",
      ),
      e(
        "#glass-muted",
        rgb("#93c5fd"),
        glassBg,
        "solid",
        "incomplete",
        "blue 300 on the same glass",
      ),
    ],
  },
  "text-shadow.html": {
    description: "A text-shadow is ignored for the measurement (and noted).",
    expect: [
      e("#shadowed", W, rgb("#e5e7eb"), "solid", "fail", "white on #e5e7eb without the shadow", {
        note: "text-shadow",
      }),
    ],
  },
  "scroll-container.html": {
    description:
      "Text inside a 120px scroll container: visible rows are measured, scrolled-out rows are not.",
    expect: [
      e("#row-1", rgb("#4b5563"), rgb("#f9fafb"), "solid", "pass", "gray 600 on gray 50"),
      e("#row-2", rgb("#9ca3af"), rgb("#f9fafb"), "solid", "fail", "gray 400 on gray 50"),
      e(
        "#row-3",
        rgb("#111827"),
        rgb("#f9fafb"),
        "solid",
        "pass",
        "partly visible row; its visible part is measured",
      ),
    ],
    absent: ["#row-4", "#row-5", "#row-6"],
  },
  "fixed-header.html": {
    description: "A position: fixed header measured once at the top of the page.",
    expect: [
      e("#nav", rgb("#4b5563"), rgb("#111827"), "solid", "fail", "gray 600 on gray 900"),
      e("#body-1", rgb("#111827"), W, "solid", "pass", "body text"),
    ],
  },
  "iframe.html": {
    description: "Text inside a same-origin iframe is measured with the frame offset.",
    expect: [
      e("#outer", rgb("#111827"), W, "solid", "pass", "outer document"),
      e("iframe >>> #inner-fail", rgb("#9ca3af"), W, "solid", "fail", "inside the iframe", {
        note: "iframe",
      }),
      e("iframe >>> #inner-pass", rgb("#111827"), W, "solid", "pass", "inside the iframe"),
    ],
  },
  "iframe-inner.html": {
    description: "The iframe document on its own.",
    expect: [
      e("#inner-fail", rgb("#9ca3af"), W, "solid", "fail", "gray 400 on white"),
      e("#inner-pass", rgb("#111827"), W, "solid", "pass", "gray 900 on white"),
    ],
  },
  "dark-media.html": {
    description: "Dark mode through @media (prefers-color-scheme: dark).",
    expect: [
      e("#themed", rgb("#374151"), W, "solid", "pass", "light: gray 700 on white", {
        schemes: ["light"],
      }),
      e("#themed", rgb("#4b5563"), rgb("#111827"), "solid", "fail", "dark: gray 600 on gray 900", {
        schemes: ["dark"],
      }),
    ],
  },
  "dark-class.html": {
    description: 'Dark mode through a .dark class on <html> (audited with darkClass: "dark").',
    expect: [
      e(
        "#class-themed",
        rgb("#9ca3af"),
        rgb("#f9fafb"),
        "solid",
        "fail",
        "light: gray 400 on gray 50",
        { schemes: ["light"] },
      ),
      e(
        "#class-themed",
        rgb("#d1d5db"),
        rgb("#030712"),
        "solid",
        "pass",
        "dark: gray 300 on gray 950",
        { schemes: ["dark"] },
      ),
    ],
  },
  "p3.html": {
    description:
      "Display-P3 text colors, gamut-mapped to sRGB in OKLCH (culori toGamut as the oracle).",
    expect: [
      e(
        "#p3-blue",
        toRgb(p3),
        W,
        "solid",
        "fail",
        `color(display-p3 0.25 0.45 1) maps to ${formatHex(p3)}`,
        { note: "display-p3" },
      ),
      e("#p3-in-gamut", toRgb(p3InGamut), W, "solid", "pass", "in gamut: no mapping"),
    ],
  },
  "code-grid.html": {
    description:
      "A long grid with inline <code>: the lazily loaded monospace font re-lays-out the page during the first full-page capture. Text boxes must be measured after that.",
    expect: [
      e(
        "#btn-last",
        W,
        rgb("#18181b"),
        "solid",
        "pass",
        "white on zinc 900, at the bottom of a page that shifts during capture",
      ),
      e(
        "#muted-last",
        rgb("#9ca3af"),
        W,
        "solid",
        "fail",
        "gray 400 on white, in the last card only",
      ),
    ],
    // Every text box must line up in both captures: nothing may be skipped as covered or animated.
    // (test/audit/alignment.test.ts also checks that #muted-last's screenshot crop shows its text.)
    noSkips: true,
  },
  "covered.html": {
    description:
      "Text under an opaque panel is not visible, so it is not measured (hiding it changes no pixel).",
    expect: [e("#visible", rgb("#111827"), W, "solid", "pass", "the visible control paragraph")],
    absent: ["#covered-text"],
  },
  "animated.html": {
    description:
      "Text over a background that a JavaScript animation repaints every frame is skipped: its background differs between captures.",
    expect: [
      e(
        "#static",
        rgb("#111827"),
        W,
        "solid",
        "pass",
        "static text on the same page is still measured",
      ),
    ],
    absent: ["#animated-text"],
  },
  "opacity.html": {
    description: "Opacity multiplies up the tree (0.6 × 0.5 = 0.3) and composites the text color.",
    expect: [
      e("#faded", over(rgb("#111827"), 0.3, W), W, "solid", "fail", "gray 900 at 30% over white", {
        note: "opacity",
      }),
      e(
        "#translucent",
        over(rgb("#111827"), 0.8, W),
        W,
        "solid",
        "pass",
        "rgba(17,24,39,.8) over white",
      ),
    ],
  },
};

for (const [page, spec] of Object.entries(pages)) {
  const out = {
    page,
    ...ALL,
    description: spec.description,
    expect: spec.expect.map(strip),
    ...(spec.absent ? { absent: spec.absent } : {}),
    ...(spec.noSkips ? { noSkips: true } : {}),
  };
  writeFileSync(
    `fixtures/expected/${page.replace(/\.html$/, ".json")}`,
    `${JSON.stringify(out, null, 2)}\n`,
  );
}
console.log(`wrote ${Object.keys(pages).length} expected files`);
