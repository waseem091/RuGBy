# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-21

First release of RuGBy as a rendered-color auditor. The original Figma plugin moved to `legacy/figma/`.

### Added

- `rugby audit`: renders pages, local files and build folders in headless Chromium at several viewports and color schemes, and measures text contrast from real pixels (5th-percentile WCAG 2.x ratio over every background pixel under each line, plus APCA Lc), including text on gradients, images, scrims, `backdrop-filter` and `mix-blend-mode`. Records axe-core's verdict for each element.
- Design-token drift detection: every painted color is composited through opacity, filters and translucent backgrounds, matched to the nearest token by OKLab ΔE, labeled `likely-typo` when ΔE < 0.5, and traced to its CSS rule, stylesheet and line through the Chrome DevTools Protocol.
- Fix suggestions: the nearest passing token (same hue family and group first), verified over the measured pixels; background tokens when no text color passes; exact source edits for drift (`#6b7281 → var(--color-gray-500)`, `text-[#6b7281] → text-gray-500`).
- Token loading from W3C Design Tokens JSON (aliases, modes, color objects), Tailwind configs (`resolveConfig`, v4 `@theme`) and CSS custom properties, with auto-detection. `rugby tokens` prints the normalized set.
- `rugby contrast` for one-off WCAG and APCA checks; `rugby fixture` regenerates the lossless all-RGB PNG.
- Reports: a JSON report with a documented schema (`docs/report-schema.md`, `schema/report.schema.json`), a self-contained offline HTML report with annotated screenshots and a token palette, and grouped terminal output.
- A color core (`rugby/color`) for CSS color parsing, OKLab/OKLCH, Display-P3 and other wide gamuts with CSS Color 4 gamut mapping, compositing, blend modes, CSS filters, WCAG and APCA, verified against culori over all 16,777,216 sRGB colors.
- GitHub Action (`action.yml`), MCP server (`rugby-mcp`) with read-only `rugby_audit`, `rugby_contrast` and `rugby_tokens` tools, a Node API, `AGENTS.md` and `skills/rugby/SKILL.md`.
- Options for sitemaps, selectors, hiding banners (common consent banners hidden by default), class-based dark mode, AAA, APCA, and a per-host rate limit for public sites.

### Removed

- The generated binaries (`colorbuckets/`, `hyperlapse/`, `allRGB.jpg`, `allRGB.psd`), replaced by `rugby fixture`.
