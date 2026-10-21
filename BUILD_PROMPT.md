# Build Prompt: RuGBy — Rendered-Color Auditor for the Web

> Paste everything below this line into a coding agent (Claude Code or similar) running inside a fresh clone of this repository.

---

## 0. Operating mode: fully autonomous. Read this first.

**The owner is asleep. Do not ask any questions and do not wait for any permission or confirmation.** No one will answer, and stopping to ask means the work does not get done.

- When something is ambiguous, pick the most reasonable option, write it down in `DECISIONS.md` (one line per decision: what you chose, why, and what the alternative was), and keep going.
- When you're blocked on one part (a dependency won't install, a site won't load, a browser feature is missing), work around it, record it in `DECISIONS.md` under "Blockers", and move on to the next item. Never end the session because of a single blocker.
- Don't stop after one phase. Work through every phase below in order until all of them are done or you truly can't make progress. A partial result that's pushed beats a perfect plan that isn't.
- Run, verify and fix things yourself: install packages, run tests, start dev servers, open headless browsers. No step needs a human.
- **Hard limits, still enforced without asking:**
  - Never force-push, rewrite published history, or push to any branch other than the working branch named in section 9.
  - Never delete anything outside this repository.
  - Never put secrets, tokens or personal data in code or commits.
  - Never open pull requests, file issues, or post comments on other people's repositories. Auditing public websites read-only is fine; contacting their owners is not.
  - Only audit public sites you load read-only, plus local fixtures. No login walls, no form submissions, and nothing that floods a site with requests (at most one page every 2 seconds per domain).

---

## 1. Background

This repo started as **RuGBy**, a Figma plugin and "all-RGB pixel engine" that turns hex ranges into one-pixel rectangles and stitches all 16,777,216 RGB colors into one 4096×4096 image. On its own that isn't useful to anyone. The repo is being turned into a real tool for **design engineers**: the people who own the gap between a design system and production UI code.

What already exists (reuse what helps, then archive it):
- `figma/`: the Figma plugin (`code.js`, `ui.html`, an unused WebGL `worker.js`, plus Python helpers). **Move it to `legacy/figma/` and leave it alone.**
- `colorbuckets/`, `hyperlapse/`, `allRGB.jpg`, `allRGB.psd`: about 40MB of generated binaries. `allRGB.jpg` is lossy and only contains about 4M of the 16.7M colors, so it's useless as a reference. **Remove them from the working tree with `git rm`** and replace them with a script that regenerates a lossless all-RGB PNG on demand (see section 5.1). Don't rewrite history to purge them.

---

## 2. The problem this tool solves

Design engineers ship interfaces whose **rendered** colors don't match what the design system says they should be. Today's tools have two blind spots:

1. **Contrast checks skip the hard cases.** axe-core, the engine behind Lighthouse and most CI accessibility checks, can't evaluate text over gradients, background images, semi-transparent layers, `mix-blend-mode`, `backdrop-filter`, or text overlapping the edge of an element. It reports these as "incomplete" or "needs review", and most CI setups treat that as a pass. The only automatic resolver is part of Deque's paid product. References: dequelabs/axe-core issues #4628 and #975.
2. **Colors drift away from the design tokens.** Opacity stacking, CSS filters, dark-mode overrides, hardcoded hex values, Tailwind arbitrary values (`text-[#6b7280]`) and third-party CSS all produce colors that aren't in the token set. Linters like stylelint only read source code. Nothing audits the colors the browser actually paints.

**RuGBy measures the actual rendered pixels.** It renders real pages in a headless browser, measures contrast on the pixels behind each piece of text, finds every painted color that isn't a token, traces each one to the CSS that produced it, and suggests the closest token that would fix it.

---

## 3. Product definition

### 3.1 Command-line interface (the primary interface)

```
npx rugby audit <url-or-file...> [options]
npx rugby audit http://localhost:3000 --tokens tokens.json --json > report.json
npx rugby audit ./dist/index.html --viewports 375,768,1440 --schemes light,dark
npx rugby audit --sitemap https://example.com/sitemap.xml --max-pages 25
npx rugby tokens <tokens-file>          # parse and print the normalized token set
npx rugby contrast "#777" "#fff"        # quick one-off contrast check (WCAG + APCA)
npx rugby fixture                       # regenerate the lossless all-RGB test PNG
```

Options for `audit`:
| Flag | Default | Meaning |
|---|---|---|
| `--tokens <path>` | auto-detect | W3C Design Tokens JSON, Tailwind config, or a CSS file with custom properties |
| `--viewports <list>` | `375,1440` | viewport widths in px |
| `--schemes <list>` | `light,dark` | emulated `prefers-color-scheme` values |
| `--standard <wcag2\|apca\|both>` | `wcag2` | which contrast model decides pass/fail |
| `--level <AA\|AAA>` | `AA` | WCAG level |
| `--drift-threshold <ΔE>` | `2.0` | OKLCH ΔE above which a color counts as off-token |
| `--json` | off | print the machine-readable report to stdout |
| `--html <path>` | `rugby-report/index.html` | write the HTML report with annotated screenshots |
| `--fail-on <contrast,drift,none>` | `contrast` | which finding types make the exit code nonzero |
| `--max-pages <n>` | `10` | crawl limit when using `--sitemap` |
| `--selector <css>` | `body` | limit the audit to part of the page |

Exit codes: `0` clean, `1` findings matching `--fail-on`, `2` bad input or config, `3` internal error.

### 3.2 What a finding looks like (stable JSON contract, documented in `docs/report-schema.md`)

```json
{
  "type": "contrast",
  "severity": "error",
  "page": "http://localhost:3000/pricing",
  "viewport": 375,
  "scheme": "dark",
  "selector": "main > section.hero h2",
  "text": "Start your free trial",
  "fontSizePx": 18, "fontWeight": 400, "largeText": false,
  "foreground": "#9CA3AF",
  "background": { "kind": "gradient", "worst": "#D1D5DB", "sampled": 412 },
  "wcag": { "ratio": 1.94, "required": 4.5, "pass": false },
  "apca": { "lc": -28.1, "required": 60, "pass": false },
  "axeVerdict": "incomplete",
  "suggestion": { "token": "color.gray.700", "value": "#374151", "ratio": 7.1 },
  "screenshot": "rugby-report/shots/0007.png"
}
```

```json
{
  "type": "drift",
  "severity": "warning",
  "page": "http://localhost:3000/",
  "color": "#6B7281",
  "nearestToken": { "name": "color.gray.500", "value": "#6B7280", "deltaE": 0.4 },
  "property": "color",
  "selectors": ["a.footer-link", "p.muted"],
  "source": { "rule": ".muted { color: #6b7281 }", "stylesheet": "/_next/static/css/app.css" },
  "occurrences": 14
}
```

Drift findings below ΔE 0.5 are labeled `"likely-typo"`, because those are almost always a hardcoded near-copy of a token.

### 3.3 Other interfaces (build after the CLI works)
- **Node API:** `import { audit } from "rugby"`, returning the same report object.
- **GitHub Action:** `action.yml` that runs the audit against a URL or build folder, uploads the HTML report as an artifact, and fails the job based on `--fail-on`.
- **MCP server:** a `rugby-mcp` binary with read-only tools `rugby_audit`, `rugby_contrast` and `rugby_tokens`, so AI agents can run an audit, apply fixes, and audit again.
- **Agent docs:** `AGENTS.md` at the repo root plus `skills/rugby/SKILL.md` that say exactly when to use the tool and the command to run.

---

## 4. Technical decisions (already made, don't revisit)

- **Language:** TypeScript (strict mode), Node ≥ 20, ESM only.
- **Package manager:** pnpm if available, otherwise npm. Single package at the repo root, not a monorepo.
- **Browser:** Playwright with Chromium. If a Chromium is preinstalled (check `PLAYWRIGHT_BROWSERS_PATH` or `/opt/pw-browsers`), use it and don't download browsers.
- **Color math:** write your own small, well-tested module for sRGB ↔ linear ↔ OKLab/OKLCH, WCAG 2.x relative luminance and contrast, and APCA (0.0.98G-4g constants). You may add `culori` as a dev dependency **only as a test oracle** to cross-check results, never at runtime.
- **CLI:** `commander` (or `cac`). **Tests:** `vitest`. **Lint and format:** `eslint` + `prettier`, or `biome`.
- **Accessibility baseline:** `@axe-core/playwright`, so each finding records what axe said about the same element (`pass`, `fail`, `incomplete`, or `not-checked`). This comparison is the headline evidence for the tool.
- **Report HTML:** one self-contained static file (inline CSS and JS, no framework, works offline). Screenshots go next to it.

---

## 5. Build phases with acceptance criteria

Work in this order. Commit at the end of each phase (more often is fine). A phase is done only when its acceptance criteria pass **and you've run them**.

### Phase 1: Repo reset and scaffolding
- Move `figma/` to `legacy/figma/` and `git rm` the binary assets listed in section 1. Rewrite `README.md` for the new tool and keep one short "History" paragraph about the Figma plugin.
- Set up `package.json`, `tsconfig.json`, lint, format, vitest, a `bin` entry for `rugby`, and a CI workflow `.github/workflows/ci.yml` (install, lint, typecheck, test, plus one end-to-end audit of the local fixtures).
- Add `scripts/fixture.ts` (exposed as `rugby fixture`): it writes `fixtures/allrgb.png`, a lossless 4096×4096 PNG with every 24-bit color exactly once, where pixel index = `r<<16 | g<<8 | b`. **Don't commit the PNG.** Add it to `.gitignore` and generate it in tests or CI.
- **Accept when:** `npm test`, `npm run lint` and `npm run typecheck` all pass, `npx rugby --help` works, and `rugby fixture` produces a PNG with exactly 16,777,216 unique colors (verified by a test).

### Phase 2: Color core (`src/color/`)
- Parse every CSS color format Chromium can return from `getComputedStyle`: `rgb()`/`rgba()` in both legacy and space-separated syntax, `color(srgb …)`, `color(display-p3 …)`, `oklch()`, `oklab()`, `lab()`, `lch()`, hex, and `transparent`.
- Add conversions to and from linear sRGB, OKLab/OKLCH, and Display-P3 (with gamut mapping to sRGB for contrast math, clipping chroma in OKLCH).
- Add alpha compositing (source-over), plus WCAG 2.x luminance, contrast ratio and AA/AAA thresholds including the large-text rules (≥ 24px, or ≥ 18.66px when bold).
- Add APCA Lc with the published minimum-Lc lookup by font size and weight, and ΔE in OKLab (Euclidean, scaled ×100).
- **Accept when:** unit tests cover every function, and an **exhaustive test runs over the all-RGB fixture**: for all 16.7M colors, OKLab and luminance match the `culori` oracle within 1e-6, and WCAG contrast against white and black matches a reference formula. If it's too slow, run the exhaustive pass behind `RUGBY_EXHAUSTIVE=1` in CI and test a 1-in-257 stride by default. Also include known-value tests (for example `#777` on `#fff` gives 4.48:1, which fails AA).

### Phase 3: Token loading (`src/tokens/`)
- Load the W3C Design Tokens Community Group format (`$value`, `$type: "color"`, aliases like `{color.gray.500}`, nested groups, and modes stored as separate files or `$extensions`).
- Load Tailwind: run `tailwindcss/resolveConfig` on a `tailwind.config.{js,ts,cjs,mjs}` and flatten `theme.colors`. For Tailwind v4 CSS-first configs, read `@theme { --color-*: … }` blocks.
- Load CSS custom properties: any `--*` property whose value parses as a color, read from a given CSS file **or** from the live page through `getComputedStyle(document.documentElement)`.
- Auto-detect in this order: an explicit `--tokens` path, then `tokens.json` or `*.tokens.json`, then a Tailwind config, then the page's `:root` custom properties.
- **Accept when:** fixture token files for all three formats (in `fixtures/tokens/`) normalize to the same internal shape, aliases resolve, circular aliases raise a clear error, and `rugby tokens` prints a readable table.

### Phase 4: Rendering engine and contrast (`src/audit/`). This is the core.
For each page × viewport × color scheme:
1. Load the page with Playwright, wait for `networkidle` and `document.fonts.ready`, then disable animations and transitions by injecting CSS: `*{animation:none!important;transition:none!important;caret-color:transparent!important}`.
2. **Collect text nodes:** walk the DOM for visible elements with direct, non-whitespace text children. Skip `display:none`, `visibility:hidden`, `opacity:0`, zero-size and off-screen elements. Use `Range.getClientRects()` to get per-line text boxes, not the element box.
3. **Measure the foreground** from the computed `color`, composited with the element's effective opacity (multiply `opacity` up through its ancestors).
4. **Measure the background from real pixels:** for each batch of text elements, set `color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important` on those elements only, take one screenshot, sample every pixel inside each text line box, then restore the styles. Use batches so you don't need one screenshot per element. Use `deviceScaleFactor: 1` for sampling.
5. **Worst-case contrast:** compute contrast of the foreground against each sampled background pixel. Report the **5th-percentile** ratio as the verdict (so one stray anti-aliased pixel doesn't decide it), plus the minimum and the median. Classify the background kind as `solid`, `gradient`, `image`, or `mixed` from the pixel variance and the computed `background-image`.
6. **Run axe** on the same page state and record its verdict for each element by matching selectors.
7. Turn every failure into a `contrast` finding with a screenshot crop (text box plus 16px padding, outlined).

Edge cases to handle explicitly, each with a fixture page in `fixtures/pages/`:
- text on a linear gradient, a radial gradient, a photo, and a semi-transparent overlay over a photo
- `mix-blend-mode: difference` text, `backdrop-filter: blur()` glass cards, and text with `text-shadow` (contrast is measured without the shadow; add a note when a shadow exists)
- text inside a scroll container, inside `position: fixed` headers, and inside an `<iframe>` from the same origin
- dark mode via `prefers-color-scheme` **and** via a `.dark` class on `<html>` (a `--dark-class <name>` option that toggles it)
- `display-p3` colors (gamut-map them and add a note)

- **Accept when:** every fixture page has an expected-results JSON in `fixtures/expected/`, and the audit matches it (contrast within ±0.05, correct pass/fail, correct background kind). At least **five** fixtures must be cases where axe says `incomplete` and RuGBy gives a definite, correct verdict. A full audit of all fixture pages at two viewports and two schemes must finish in under 60 seconds.

### Phase 5: Drift detection and source tracing (`src/drift/`)
- For every visible element, collect the computed `color`, `background-color`, `border-*-color`, `outline-color`, `text-decoration-color`, `fill` and `stroke` (for SVG), plus box-shadow colors. Composite translucent colors over what's behind them, because what you report is the rendered color.
- Match each unique color to its nearest token by OKLab ΔE. If ΔE is above `--drift-threshold`, it's off-token; between 0 and 0.5, label it `likely-typo`.
- **Trace the source** through the Chrome DevTools Protocol (`CSS.getMatchedStylesForNode`) to find the winning rule, selector, stylesheet URL and line. If CDP fails, fall back to just the selector.
- Group findings by color and source rule, count occurrences, and rank them by occurrences × ΔE.
- **Accept when:** a fixture app with five planted off-token colors (one hardcoded hex, one Tailwind arbitrary value, one opacity stack, one filter, one dark-mode override) reports exactly those five, traced to the right rules, with zero false positives on token-correct elements.

### Phase 6: Fix suggestions
- For each contrast failure, search the token set for the color closest to the current foreground (smallest OKLCH ΔE, preferring the same hue family and the same token group like `gray`) that **passes** against the measured worst-case background. If no foreground token works, try a background token. If nothing passes, say so plainly.
- For drift, suggest the nearest token and, when the source is known, the exact replacement (`#6b7281 → var(--color-gray-500)` or `text-[#6b7281] → text-gray-500`).
- **Accept when:** tests show every suggestion actually passes when applied, by re-running the contrast math with the suggested value.

### Phase 7: Reports
- `--json` output that follows `docs/report-schema.md`, with a JSON Schema at `schema/report.schema.json` and a test that validates real output against it.
- The HTML report: a summary at the top (counts by type and severity, and "axe missed N issues that RuGBy caught"), a filterable findings list, annotated screenshots, before/after swatches for suggestions, and a token palette showing which tokens are used, unused, or drifted. It must work offline, support light and dark mode, and be readable on a phone.
- Human-readable terminal output by default: grouped, colored, and quiet when there are no findings.
- **Accept when:** a snapshot test covers the terminal output, the schema test passes, and the HTML report opens without console errors in headless Chromium (checked by a test).

### Phase 8: GitHub Action, MCP server, agent docs
- `action.yml` with inputs `url`, `build-dir` (serve it with a built-in static server), `tokens`, and `fail-on`, which uploads `rugby-report/` as an artifact. Use it in this repo's own CI against the fixtures.
- An MCP server (`src/mcp/`, using `@modelcontextprotocol/sdk`) exposing read-only tools whose results are the JSON report. It never writes files except the report folder.
- `AGENTS.md` and `skills/rugby/SKILL.md`: when to use RuGBy, the exact commands, how to read the findings, and the loop "audit, apply suggestion, audit again".
- **Accept when:** the Action runs green in CI on the fixtures, and an MCP smoke test (spawn the server, call `rugby_contrast`, check the response) passes.

### Phase 9: Real-world validation (your launch evidence)
- Audit at least **8 well-known public sites** read-only: for example the shadcn/ui docs, a Vercel template demo, Tailwind UI marketing pages, the Radix docs, the Next.js docs, the MDN home page, and the GitHub marketing site. Use the home page plus one content page each, at 375 and 1440 widths, in light and dark. Respect the rate limit in section 0.
- Write `docs/case-studies.md`: for each site, the counts, the three most interesting findings that **axe reported as incomplete or missed**, and cropped screenshots (stored in `docs/case-studies/`, each under 200KB). State it plainly; no dunking on anyone.
- Manually review a sample of 20 findings, label each as a true or false positive, and report the precision. Fix the causes of any false positives you find, then re-run.
- **Accept when:** the case-study doc exists with real data, and measured precision is ≥ 90% on the sample, or the doc honestly says what it is and what's next.

### Phase 10: Polish and release prep
- A `README.md` that leads with the problem in one sentence and a 30-second quickstart, then shows a screenshot of the HTML report and the "axe vs RuGBy" comparison table, then documents commands, configuration, the JSON schema, CI usage, MCP usage, and limitations.
- `CONTRIBUTING.md`, `CHANGELOG.md` (0.1.0), and confirm the `LICENSE` stays MIT.
- `package.json` ready to publish (`files`, `exports`, `bin`, `engines`, keywords). **Do not run `npm publish`.**
- A final `npm pack --dry-run` that's under 2MB.

---

## 6. Quality bar
- **Run the code, don't assume.** Every claim in the README and case studies must come from output you actually produced.
- Test coverage of at least 85% on `src/color`, `src/tokens` and `src/drift`, plus end-to-end tests for `src/audit`.
- No `any` in public types. Errors must be actionable, for example: `Could not parse token "color.brand" value "blue-ish": expected a CSS color`.
- Be deterministic: the same input produces the same report (sort everything, and no timestamps in the JSON unless you pass `--timestamps`).
- Performance target: 10 pages × 2 viewports × 2 schemes in under 3 minutes on a laptop.
- Keep dependencies few. Justify every runtime dependency in `DECISIONS.md`.

## 7. Known pitfalls (handle these on purpose)
- **Anti-aliasing:** sample inside the text box but ignore pixels whose color is within ΔE 1 of the foreground (leftover glyph edges), and use the 5th percentile, not the minimum.
- **Device pixel ratio:** sample at DPR 1. Take report screenshots at DPR 2 if you want, but never mix the two.
- **Lazy-loaded images:** scroll the full page once before measuring, then scroll back to the top.
- **Sticky or fixed elements** show up in every viewport screenshot. Capture the full page, but deduplicate findings by selector.
- **Fonts:** wait for `document.fonts.ready`; record the computed font size and weight for the large-text rules.
- **Cookie banners and modals** can cover content. Add a `--hide <selector>` option and a small built-in list of common consent-banner selectors that are hidden by default (overridable with `--no-default-hide`).
- **CSP blocking injected scripts:** prefer `page.addInitScript` and CDP. If CSP blocks style injection, record it and fall back to evaluating through CDP `Runtime`.

## 8. Final deliverables checklist
- [ ] `rugby audit`, `tokens`, `contrast` and `fixture` commands all working
- [ ] JSON report plus schema, HTML report, terminal output
- [ ] Fixture pages with expected results, five or more where axe says incomplete and RuGBy is correct
- [ ] Drift detection with source tracing and fix suggestions
- [ ] GitHub Action, MCP server, `AGENTS.md`, `SKILL.md`
- [ ] `docs/case-studies.md` with real data from 8+ public sites
- [ ] README, CONTRIBUTING, CHANGELOG, DECISIONS
- [ ] CI green on the last pushed commit

## 9. Git workflow
- Work on branch **`claude/tender-planck-1vd81z`**, creating it if needed. Commit after every phase with a clear message (`phase 4: pixel-sampled contrast engine with axe comparison`).
- Push with `git push -u origin claude/tender-planck-1vd81z` after every phase, so progress survives if the session ends. If a push fails because of the network, retry up to 4 times with backoff (2s, 4s, 8s, 16s).
- Never force-push. Never push to `main`. Don't open a pull request.

## 10. When you finish (or run out of road)
Write `MORNING_REPORT.md` at the repo root and push it as the final commit. Include:
1. Which phases are done and which are partial, with a one-line status each.
2. The headline numbers: tests passing, coverage, fixture results, the case-study summary ("across N sites, axe left X contrast checks incomplete; RuGBy resolved Y of them, Z were real failures").
3. Every entry from `DECISIONS.md` that the owner should review, especially anything you guessed.
4. Known bugs, limitations and blockers, each with a suggested next step.
5. The exact commands to try it in 60 seconds.

Then stop. Again: **don't ask the owner anything and don't wait for approval at any point.** Decide, record, and continue.
