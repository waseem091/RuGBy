import type { WcagLevel } from "../color/wcag.js";
import { UsageError } from "../errors.js";
import type { TokenSet } from "../tokens/types.js";
import type { Scheme, Standard } from "./types.js";

/** Common consent-banner containers, hidden before measuring (disable with `defaultHide: false`). */
export const DEFAULT_HIDE_SELECTORS = [
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  "#didomi-host",
  "#truste-consent-track",
  "#iubenda-cs-banner",
  "#cookiescript_injected",
  "#hs-eu-cookie-confirmation",
  "#gdpr-cookie-message",
  "#cmpbox",
  ".qc-cmp2-container",
  ".osano-cm-window",
  ".fc-consent-root",
  ".cky-consent-container",
  ".cc-window",
  "[id^='sp_message_container']",
];

export interface ProgressEvent {
  url: string;
  viewport: number;
  scheme: Scheme;
  done: number;
  total: number;
  error?: string;
}

export interface AuditOptions {
  /** URLs, local .html files, or build directories. */
  targets: string[];
  /** Sitemap URL to expand into pages. */
  sitemap?: string;
  /** Page limit for directories and sitemaps. Default 10. */
  maxPages?: number;
  /**
   * Token source: a path (file, comma list or directory), a loaded TokenSet,
   * `null` for none, or undefined to auto-detect (then fall back to the page's
   * `:root` custom properties).
   */
  tokens?: string | TokenSet | null;
  /** Viewport widths in px. Default [375, 1440]. */
  viewports?: number[];
  /** Emulated prefers-color-scheme values. Default ["light", "dark"]. */
  schemes?: Scheme[];
  /** Contrast model that decides pass/fail. Default "wcag2". */
  standard?: Standard;
  /** WCAG level. Default "AA". */
  level?: WcagLevel;
  /** ΔE (OKLab ×100) above which a color is off-token. Default 2. */
  driftThreshold?: number;
  /** Limit the audit to elements under this selector. Default "body". */
  selector?: string;
  /** Extra selectors to hide before measuring (modals, banners). */
  hide?: string[];
  /** Hide common consent banners. Default true. */
  defaultHide?: boolean;
  /** Class toggled on <html> for the dark scheme (e.g. "dark"). */
  darkClass?: string;
  /** Directory for screenshots (and the HTML report). null: no screenshots. Default "rugby-report". */
  reportDir?: string | null;
  /** Include `generatedAt`. Default false (deterministic output). */
  timestamps?: boolean;
  /** Include every measured text element in `report.checks`. Default false. */
  includeChecks?: boolean;
  /** Pages measured in parallel. Default 4. */
  concurrency?: number;
  /** Navigation timeout per page in ms. Default 30000. */
  timeoutMs?: number;
  /** Detect token drift. Default true. */
  drift?: boolean;
  /** Run axe-core for comparison. Default true. */
  axe?: boolean;
  /** Compute fix suggestions. Default true. */
  suggestions?: boolean;
  /** Working directory for token auto-detection and relative paths. */
  cwd?: string;
  /** Chromium executable. */
  executablePath?: string;
  /** Called after each page × viewport × scheme. */
  onProgress?: (event: ProgressEvent) => void;
  /** Text elements measured per page at most. Default 5000. */
  maxTextItems?: number;
  /** Pages taller than this are measured down to this height. Default 20000. */
  maxPageHeight?: number;
  /** Minimum ms between navigations to the same public host. Default 2000. */
  rateLimitMs?: number;
}

export type ResolvedOptions = Required<
  Omit<
    AuditOptions,
    "sitemap" | "tokens" | "darkClass" | "executablePath" | "onProgress" | "reportDir"
  >
> &
  Pick<AuditOptions, "sitemap" | "tokens" | "darkClass" | "executablePath" | "onProgress"> & {
    reportDir: string | null;
  };

export function resolveOptions(o: AuditOptions): ResolvedOptions {
  const viewports = o.viewports ?? [375, 1440];
  if (!viewports.length || viewports.some((v) => !Number.isInteger(v) || v < 200 || v > 4000)) {
    throw new UsageError(
      `Viewports must be integers between 200 and 4000, got ${viewports.join(",")}`,
    );
  }
  const schemes = o.schemes ?? ["light", "dark"];
  if (!schemes.length || schemes.some((s) => s !== "light" && s !== "dark")) {
    throw new UsageError(`Schemes must be light and/or dark, got ${schemes.join(",")}`);
  }
  const standard = o.standard ?? "wcag2";
  if (!["wcag2", "apca", "both"].includes(standard)) {
    throw new UsageError(`--standard must be wcag2, apca or both, got ${standard}`);
  }
  const level = o.level ?? "AA";
  if (level !== "AA" && level !== "AAA")
    throw new UsageError(`--level must be AA or AAA, got ${level}`);
  const driftThreshold = o.driftThreshold ?? 2;
  if (!(driftThreshold >= 0)) throw new UsageError("--drift-threshold must be a number ≥ 0");
  return {
    targets: o.targets,
    sitemap: o.sitemap,
    maxPages: o.maxPages ?? 10,
    tokens: o.tokens,
    viewports: [...new Set(viewports)],
    schemes: [...new Set(schemes)],
    standard,
    level,
    driftThreshold,
    selector: o.selector ?? "body",
    hide: o.hide ?? [],
    defaultHide: o.defaultHide ?? true,
    darkClass: o.darkClass,
    reportDir: o.reportDir === undefined ? "rugby-report" : o.reportDir,
    timestamps: o.timestamps ?? false,
    includeChecks: o.includeChecks ?? false,
    concurrency: Math.max(1, o.concurrency ?? 4),
    timeoutMs: o.timeoutMs ?? 30_000,
    drift: o.drift ?? true,
    axe: o.axe ?? true,
    suggestions: o.suggestions ?? true,
    cwd: o.cwd ?? process.cwd(),
    executablePath: o.executablePath,
    onProgress: o.onProgress,
    maxTextItems: o.maxTextItems ?? 5000,
    maxPageHeight: o.maxPageHeight ?? 20_000,
    rateLimitMs: o.rateLimitMs ?? 2000,
  };
}
