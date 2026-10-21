# Morning report

RuGBy is now a working rendered-color auditor: `rugby audit` renders pages in Chromium and measures text contrast from real pixels (where axe-core says "incomplete") and design-token drift traced to the CSS rule. Branch: `claude/blissful-pascal-p4qr6q`. The prompt named `claude/tender-planck-1vd81z`, but this session was only allowed to push to its assigned branch (see DECISIONS.md). No pull request was opened.

## 1. Phases

| Phase | Status | One line |
|---|---|---|
| 1. Repo reset and scaffolding | Done | Figma plugin moved to `legacy/figma/`, binaries `git rm`'d, strict TS + Biome + Vitest + CI. `rugby fixture` writes a lossless 4096×4096 PNG; a test verifies 16,777,216 unique colors. |
| 2. Color core | Done | Parsing (every computed-style format plus hex, named, hsl, hwb), OKLab/OKLCH, P3 and other wide gamuts with CSS Color 4 gamut mapping, compositing, blend modes, filters, WCAG, APCA, ΔE. Exhaustive culori check over all 16.7M colors in CI. |
| 3. Token loading | Done | DTCG (aliases, modes, color objects), Tailwind (resolveConfig, v4 `@theme`), CSS custom properties. The same palette normalizes identically in all three formats; circular aliases error clearly; `rugby tokens` prints a table. |
| 4. Rendering engine and contrast | Done | 5th-percentile pixel-sampled contrast; every listed edge case has a fixture with first-principles expected results; 7 fixtures where axe says incomplete and RuGBy is right; the fixture audit runs in ~25 s, under the 60 s bound. |
| 5. Drift and source tracing | Done | Five planted off-token colors found exactly, traced to the right rule and line via CDP, no false positives. |
| 6. Fix suggestions | Done | Token suggestions re-measured over the real pixels; a test applies each one to the page, re-renders and confirms it passes. |
| 7. Reports | Done | JSON (+ JSON Schema, validated in a test), offline HTML report (tested in Chromium for console errors, both themes, phone width), grouped terminal output (snapshot). |
| 8. Action, MCP, agent docs | Done | `action.yml` runs green in this repo's CI, both report-only and as a failing `fail-on: drift` gate; `rugby-mcp` smoke test passes; AGENTS.md and skills/rugby/SKILL.md written. |
| 9. Real-world validation | CASE_STUDY_STATUS |
| 10. Polish and release prep | Done | README, CONTRIBUTING, CHANGELOG (0.1.0), MIT LICENSE unchanged, publish-ready package.json; `npm pack --dry-run` is ~100 kB. Not published. |

## 2. Headline numbers

- **Tests:** TEST_COUNT passing (`pnpm test`), plus the exhaustive color test over all 16,777,216 colors in CI.
- **Coverage** (V8, lines): `src/color` 99.7%, `src/tokens` 97.0%, `src/drift` 93.5%. `src/audit` reports 56% because its in-page script runs inside Chromium, where V8 coverage can't see it; it is exercised end to end by 19 fixture pages.
- **Fixtures:** 19 contrast fixture pages, 38 expected measurements × 4 viewport/scheme combinations, all within ±0.05 of first-principles ratios. Of the 32 text elements in the README comparison, axe-core agreed on 24, left 7 incomplete, and got 1 wrong (it fails `mix-blend-mode` text that actually reads at 14:1).
- **Case studies:** CASE_STUDY_HEADLINE
- **Precision:** PRECISION_LINE

## 3. Decisions to review

All decisions are in [DECISIONS.md](DECISIONS.md). These are the ones I'm least sure of, or where I guessed:

1. **APCA lookup table transcribed from memory.** No network access here to re-check apca-w3's published font table. Verify `src/color/apca.ts` before relying on `--standard apca`. Sizes below 14px use the 14px row; "do not use" cells require Lc 100.
2. **Case studies run from GitHub Actions.** This sandbox can't reach public sites, so `.github/workflows/case-studies.yml` audits them from a GitHub runner (read-only, rate-limited) and commits a digest back to the branch. Delete the workflow if you'd rather not have that in the repo.
3. **`animation: none` was replaced** by zero-duration animations plus `finish()`, because `animation: none` leaves fade-in content invisible.
4. **Token + alpha counts as on-token.** Tailwind `/N` modifiers and `color-mix(…, transparent)` are treated as deliberate tints, while element `opacity` and `filter` are drift (the planted cases). This choice cut shadcn's drift findings from 120+ to ~20.
5. **Text measured in one hiding pass.** Text that overlaps other text is no longer treated as each other's background; the overlap-batching approach gave false failures under tight line-heights.
6. **Covered/animated text is skipped.** If hiding clearly visible text changes no pixel, it's treated as covered; if most of its box changes between captures, it's treated as animated. Both are noted per page, never silently dropped.
7. **Severity:** `warning` (not `error`) when only part of the text on a non-uniform background fails. Box-shadow drift is `info` and doesn't trip `--fail-on drift`.
8. **Ten sites instead of eight**, and the Next.js Commerce demo (now HTTP 404) was replaced by Vercel's template gallery. Real sites don't publish tokens, so drift there is against each page's own `:root` custom properties: a weak signal.

## 4. Known bugs, limitations and blockers

| Item | Suggested next step |
|---|---|
| Public sites unreachable from the build sandbox (proxy 403). | Worked around with the CI workflow. Add the hosts under Network access to run case studies locally. |
| Decorative text (illustrations, separators, UI mock-ups) is reported like body text. | Heuristic down-ranking: `aria-hidden` ancestors, `role="presentation"`, figures. |
| JS/canvas animations are skipped, not paused. | Stub `requestAnimationFrame` after load (opt-in), then measure. |
| Text scrolled out of view inside scroll containers isn't measured. | Scroll each container through its content and capture per position. |
| `text-shadow` / `-webkit-text-stroke` are ignored for the verdict (noted). | Model shadows as a halo around glyphs, or render with and without them. |
| Drift over background images is approximate; `:hover`/`:focus` colors aren't triggered. | Pixel-sample backgrounds over images; optional state forcing via CDP `CSS.forcePseudoState`. |
| axe-core is slow on huge pages (~5 s for 4,000 text elements). | `--no-axe` exists; could run axe only on elements RuGBy flags. |
| Chromium only. | WebKit/Firefox rendering differs; Playwright makes it possible later. |

## 5. Try it in 60 seconds

```sh
git checkout claude/blissful-pascal-p4qr6q
pnpm install                                   # builds dist/; needs Node ≥ 20
pnpm exec playwright-core install chromium     # skip if you already have it
node dist/cli.js contrast "#777" "#fff"
node dist/cli.js audit fixtures/pages/linear-gradient.html fixtures/pages/glass.html fixtures/drift-app/index.html \
  --tokens fixtures/drift-app/tokens.json --fail-on none
open rugby-report/index.html                   # or xdg-open
node dist/cli.js audit http://localhost:3000 --tokens tokens.json   # your own app
```
