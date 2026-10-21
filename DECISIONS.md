# Decisions

One line per decision: what was chosen, why, and the alternative.

## Process

- **Branch:** worked on `claude/blissful-pascal-p4qr6q` (the branch this session was assigned by its harness) instead of `claude/tender-planck-1vd81z` named in the build prompt; the harness forbids pushing anywhere else. Alternative: the prompt's branch name.
- **Package manager:** pnpm 10 (available in the environment). `pnpm.onlyBuiltDependencies` allow-lists esbuild/biome install scripts. Alternative: npm.

## Tooling

- **Lint/format:** Biome (one dev dependency instead of eslint + prettier + plugins). Alternative: eslint + prettier.
- **Pinned versions:** `playwright-core@1.56.1` because the environment's preinstalled Chromium (`/opt/pw-browsers/chromium-1194`) belongs to that release; TypeScript 5.9, Vitest 3.2 and Commander 14 (Commander 15 requires Node ≥ 22.12, the prompt requires Node ≥ 20). Alternative: latest of each.
- **PNG codec:** a small in-house encoder/decoder (`src/util/png.ts`, ~250 lines, `node:zlib` only) for the all-RGB fixture, screenshot sampling and report crops. Alternative: `pngjs` as a runtime dependency.
- **all-RGB fixture:** generated with the PNG Sub filter, which compresses the 48 MiB of pixels to ~186 KB in under a second, so it is cheap to regenerate in every test run. Alternative: commit it (forbidden by the prompt).

## Blockers

- **Public sites are unreachable from this environment.** The sandbox's egress policy answers 403 to CONNECT for ui.shadcn.com, nextjs.org, developer.mozilla.org, tailwindcss.com, vercel.com, radix-ui.com and example.com (checked 2026-10-21). Phase 9 (real-world validation) cannot use live sites from here; see `docs/case-studies.md`.

## Color core

- **WCAG linearization threshold:** 0.04045 (IEC sRGB) rather than WCAG's printed 0.03928; no 8-bit value falls between them, which the exhaustive test confirms against a 0.03928 reference. Alternative: 0.03928.
- **APCA required-Lc table:** the 0.0.98G-4g "font lookup table" (rows 14–96px, weights 100–900). Sizes between rows use the next smaller row; sizes below 14px use the 14px row; cells APCA marks "do not use" require Lc 100 and are flagged `prohibited`. The table was transcribed from memory of the published README (no network access to re-check it). **Owner should verify against apca-w3.** Alternative: apca-w3's inverse `fontLookupAPCA`.
- **Gamut mapping:** CSS Color 4 OKLCH chroma reduction (binary search, JND 0.02) for every space, not just Display-P3. Alternative: plain clipping.
- **ΔE:** Euclidean OKLab ×100 (ΔEOK); ΔE in OKLCH is the same distance. Alternative: CIEDE2000.
- **culori as oracle only:** its `hard-light`/`overlay` blend formulas are wrong (`2s(1-b)-1` instead of Screen), so those two modes are tested against the spec formula instead; its Lab D50 adaptation differs from CSS Color 4 by ~1e-5 on a 0–100 scale.
- **Compositing space:** all compositing, blend modes and CSS filter functions use gamma-encoded sRGB, matching how Chromium paints CSS (not linear light). Alternative: linearRGB (the SVG default).
- **Bare HSL triplets** (`222.2 84% 4.9%`, the shadcn/ui custom-property convention) parse as colors only when `bareHsl` is set, which the CSS-variable token loader does. Alternative: never accept them.

## Tokens

- **Canonical names:** every format normalizes to a dotted `color.<path>` name plus the CSS variable that would carry it (`--color-gray-500`); Tailwind `DEFAULT` keys name their parent. Alternative: keep each format's native naming.
- **Modes from several DTCG files:** with more than one file, each file's last dotted name segment is its mode (`colors.dark.tokens.json` → `dark`), except files named `tokens`, `base`, `core`, `global`, `primitive(s)` or `default`, which are mode-less shared primitives. `$extensions.mode` / `$extensions.modes` objects add per-mode values. Alternative: require an explicit mode flag.
- **CSS theme scopes:** only `:root`, `html`, `:host`, `@theme`, `.dark`/`.light`/`.theme-*`/`*-theme`/`*-mode` classes, `[data-theme|mode|color-scheme|appearance=…]` and `@media (prefers-color-scheme)` blocks define tokens; component-scoped custom properties (`.card { --x }`) are ignored. Alternative: treat every custom property as a token.
- **Tailwind without tailwindcss installed:** read `theme.colors` + `theme.extend.colors` straight from the config module and warn that the default palette is missing. Alternative: fail.
- **Matching uses exact floats, display uses hex:** each token keeps its gamut-mapped float sRGB for matching; `value` is the 8-bit hex for humans.

## Rendering engine

- **Local inputs are served over HTTP:** `.html` files and build directories are served by a built-in static server on 127.0.0.1 (not `file://`), so same-origin iframes, relative assets and fonts behave as in production. URLs from that server appear as `local:/path` in reports so output is deterministic. Alternative: `file://` URLs.
- **Animations:** instead of the prompt's `animation: none`, inject `animation-duration: 0s; animation-delay: 0s; animation-iteration-count: 1; transition: none` and call `finish()` on running animations. `animation: none` would drop `fill-mode: forwards` end states and leave fade-in content invisible. Alternative: `animation: none`.
- **Network idle:** wait until no request has been in flight for 250 ms (cap 5 s) instead of Playwright's fixed 500 ms `networkidle`, which cost about 0.5 s on every one of hundreds of page loads. Alternative: `waitForLoadState("networkidle")`.
- **Style injection:** constructable stylesheets (`adoptedStyleSheets`) plus `bypassCSP: true` on the browser context, so strict CSPs don't block the freeze/hide CSS; inline `style` attributes (CSSOM) to hide text. Alternative: `<style>` tags.
- **Hiding text:** besides `color: transparent`, also `-webkit-text-fill-color`, `text-decoration-color` and `text-emphasis-color` are made transparent so underlines and fill overrides don't leak into the background sample.
- **One hiding pass, not overlap batches:** all measured text is hidden for a single background screenshot. An earlier version batched non-overlapping text so that text over text would count as background, but with tight line-heights adjacent line boxes overlap, so neighbors stayed visible and their glyphs were sampled as "background" (on a synthetic docs page, 1,746 of 4,002 elements falsely failed). Text overlapping other text is rare; tight leading is everywhere. Alternative: overlap batches (more screenshots, wrong results).
- **Capture before measuring:** the first full-page capture can re-lay-out the page. Inline `<code>` pulls in a lazily loaded monospace fallback font, which `document.fonts.ready` does not cover, and positions shifted by ~1px per row: 100px at the bottom of a long page. RuGBy takes the normal screenshot first, measures text boxes afterwards, and re-measures once if they moved during the hidden-text capture. `fixtures/pages/code-grid.html` is the regression test.
- **Fully covered pixels only:** a text box's partly covered edge pixels are not sampled (unless the box is thinner than a pixel); they belong as much to the neighbor (an inline code chip, a border) and caused borderline false failures.
- **Full-page capture:** Playwright's full-page screenshot keeps the layout (`100vh` heroes and fixed elements stay where they are at scroll 0), verified by a probe, so rects measured at the top of the page line up with the image. Pages taller than 20,000 px are measured down to that height.
- **Glyph-edge filter:** background pixels within ΔE 1 of the foreground are ignored unless that would leave nothing (then the text really is invisible and the ratio is ~1).
- **Background kind:** `solid` when 95% of sampled pixels are within ΔE 2.5 of the median; otherwise `image` if an image (`url()` background or media element) overlaps the text, else `gradient` if a CSS gradient does, else `mixed`. A glass card whose blurred backdrop is uniform is honestly `solid`.
- **Severity:** `error` when the 5th-percentile ratio fails and either the background is solid or the median fails too; `warning` when only part of the text (on a non-uniform background) fails.
- **Rendered foreground:** `foreground` in a finding is the text color as painted against the worst background pixel (after opacity and blend modes), not the authored value.
- **Cross-page dedupe:** identical failures (same selector, text, colors, viewport, scheme) on several pages are reported once with `alsoOn`.
- **Disabled controls** (and `aria-disabled`) are skipped, as WCAG exempts inactive components; so are transparent-fill text (`background-clip: text`), SVG text and form-control internals.
- **Expected results** in `fixtures/expected/` are computed from first principles by `scripts/compute-expected.mjs`: each fixture places a flat plateau of the worst color where the text starts (≥5% of its pixels at any viewport), so the 5th-percentile verdict is known exactly regardless of font metrics. culori supplies luminance and CSS Color 4 gamut mapping as an independent oracle.

## Drift

- **Rendered color model:** each element is a layer (its content over its own background), filtered by its own `filter`, faded by its own `opacity`, then composited over its parent's background, up to the canvas. This is exact for solid colors, so a 60%-opacity badge composites over what is *behind* it, and white text inside it stays white. Background images make the backdrop approximate (noted as a cause). Alternative: sample pixels for every painted color.
- **Token + alpha is on-token:** an authored value whose RGB equals an opaque token, with alpha < 1 and no opacity or filter (Tailwind `bg-foreground/5`, `color-mix(in oklab, var(--x) 5%, transparent)`), is a deliberate tint, not drift. Without this, shadcn/ui's docs produced 120+ drift findings, almost all of them alpha modifiers. Element `opacity` and `filter` still count as drift (they are the planted "opacity stack" and "filter" cases). Alternative: report tints as drift.
- **Disabled controls are skipped in drift too**, as in contrast: they are faded on purpose.
- **`--tokens none` turns drift off** instead of falling back to the page's custom properties.
- **Tracing representatives:** off-token colors are grouped by property, value, rendered color and cause; up to three members per group are traced and the source is reused when they agree. This cut drift time by about a third on a 4,000-element page without changing results.
- **What counts as a typo:** `likely-typo` only for authored opaque values within ΔE 0.5 of a token. Compositing noise near a token is on-token. Alternative: any rendered color under ΔE 0.5.
- **Exact vs near:** below ΔE 0.1 is the token; between 0.5 and `--drift-threshold` is on-token ("near", counted as usage); 0.1–0.5 authored values are reported as typos. An unmodified translucent value equal to a translucent token (a scrim) is on-token.
- **Box shadows:** compared by their authored color, ignoring alpha, and reported as `info` (which `--fail-on drift` ignores), because shadows are translucent black by design. Alternative: skip them.
- **Browser defaults:** a painted color with no author declaration anywhere in the cascade (initial values, user-agent styles such as link underlines) is not drift. This needs CDP tracing; when CDP fails, colors are reported with selectors only.
- **Modes:** colors match against tokens of every mode, so a dark value of a token is never drift in light mode. Alternative: match per scheme.
- **Grouping:** by rendered color + property + source rule (or selector when untraced), across viewports, schemes and pages; `occurrences` counts distinct page+selector pairs, not states.
- **Page-token fallback:** without a token file, each page's computed `:root` custom properties (per scheme) are the tokens; the report's token source says so.

## Suggestions

- **Re-evaluation over the real pixels:** each failing text keeps its background-pixel histogram, and every candidate token is re-scored with the same 5th-percentile math (a darker text color moves the worst pixel on a gradient, so testing against the old worst pixel is not enough). An acceptance test applies every suggestion to a copy of the page, re-renders and re-measures.
- **Ranking:** OKLab ΔE to the current color, +10 for a different hue family (neutral, or one of twelve 30° hue sectors), +2 for a different token group. Then background tokens (closest to the median background). Then `null` with a plain note, which also says when opacity is the real problem.
- **No tokens at all:** suggest the nearest passing OKLCH lightness at the same chroma and hue, snapped to 8 bits before verifying, since the hex is what gets applied.

## Reports

- **HTML is server-rendered** into one static file with inline CSS and a ~40-line inline script for filters and the theme toggle; findings work without JavaScript. Screenshots live in `shots/` next to it and `report.json` is written alongside, so the folder is the complete artifact. Alternative: render from embedded JSON with client-side JS.
- **JSON Schema draft-07** with `additionalProperties: false` everywhere, so an undocumented field fails the schema test. Alternative: draft 2020-12 (needs ajv's 2020 build).
- **Terminal output** groups identical failures across viewports and schemes onto one line pair and prints a single ✔ line when clean. Color follows `NO_COLOR` / `FORCE_COLOR` / TTY.
- **Snapshot tests use a hand-written report**, because real measurements of text over gradients depend on font metrics, which differ between machines.
- **Tests run files sequentially** (`fileParallelism: false`): browser suites contend for CPU otherwise. The 60-second fixture-audit bound is asserted on the uninstrumented CLI in CI and in tests when coverage is off (V8 coverage slows the pixel loops ~4×).

## Action, MCP, agent docs

- **Runtime dependencies** (justification): `commander` (CLI parsing), `playwright-core` (Chromium automation; `-core` because it does not download browsers on install), `@axe-core/playwright` (the axe comparison the prompt requires), `@modelcontextprotocol/sdk` + `zod` (the MCP server the prompt requires; zod is the SDK's schema language). PNG, static serving, color math and token parsing are in-house. Tailwind is only used if the audited project has it installed.
- **The MCP SDK is loaded only by `rugby-mcp`**, so `rugby audit` never imports it. Alternative: a hand-rolled JSON-RPC server (fewer transitive dependencies, but the prompt names the SDK).
- **GitHub Action is a composite action** that installs RuGBy from the action's own checkout (`pnpm install --frozen-lockfile`, which builds via `prepare`) and Chromium (`playwright-core install --with-deps`). It passes inputs through `env`, never by interpolating into scripts, uploads `rugby-report/` even on failure, writes the terminal output to the job summary, and exits with RuGBy's code. Alternative: a Docker action (slower to start, heavier to maintain).
- **This repo's CI uses the action twice:** on the fixture pages with `fail-on: none` (they fail by design), and on the drift fixture with `fail-on: drift`, asserting that the job fails with exit code 1 and exactly 5 findings.

## Case studies

- **Run from GitHub Actions instead of this sandbox:** the sandbox cannot reach public sites (see Blockers), so `.github/workflows/case-studies.yml` audits them from a GitHub-hosted runner (read-only, RuGBy's 2 s per-host rate limit, 2 pages × 2 viewports × 2 schemes per site) and commits a compact digest (`docs/case-studies/data.json` plus crops under 200 KB) back to the branch. The full reports are uploaded as an artifact. Alternative: skip Phase 9.
- **Sites:** shadcn/ui, a Vercel template demo (Next.js Commerce), Tailwind CSS/Plus, Radix, Next.js, MDN, GitHub, Stripe, Linear, Svelte. Ten instead of eight, so that a site blocking headless browsers doesn't drop the count below eight.
- **Tokens for real sites:** none are published, so drift uses each page's own `:root` custom properties (`format: "page"`). Drift numbers are therefore "colors not in the page's own custom properties", a weaker signal than a real token file.
