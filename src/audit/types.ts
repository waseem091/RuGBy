/**
 * Public report types. This is the stable JSON contract documented in
 * docs/report-schema.md and schema/report.schema.json.
 */
import type { WcagLevel } from "../color/wcag.js";

export type Scheme = "light" | "dark";
export type Standard = "wcag2" | "apca" | "both";
export type AxeVerdict = "pass" | "fail" | "incomplete" | "not-checked";
export type BackgroundKind = "solid" | "gradient" | "image" | "mixed";
export type Severity = "error" | "warning" | "info";
export type FailOn = "contrast" | "drift";

/** A suggested replacement that fixes a finding. */
export interface Suggestion {
  /** Token name, e.g. `color.gray.700`; absent for a computed (non-token) color. */
  token?: string;
  /** The suggested color, `#RRGGBB`. */
  value: string;
  /** Which side of the pair changes. */
  target: "foreground" | "background";
  /** WCAG ratio after applying the suggestion against the measured worst-case background. */
  ratio?: number;
  /** APCA Lc after applying the suggestion. */
  lc?: number;
  /** The background pixel that decides the suggested color's verdict (it can differ from the current worst). */
  against?: string;
  /** ΔE (OKLab ×100) between the current and the suggested color. */
  deltaE: number;
  /** Concrete source edit, e.g. `#6b7281 → var(--color-gray-500)`. */
  replacement?: string;
}

export interface ContrastFinding {
  type: "contrast";
  severity: Severity;
  page: string;
  viewport: number;
  scheme: Scheme;
  selector: string;
  text: string;
  fontSizePx: number;
  fontWeight: number;
  largeText: boolean;
  /** Rendered text color (`#RRGGBB`), after opacity, before compositing on the background. */
  foreground: string;
  background: {
    kind: BackgroundKind;
    /** Background pixel at the 5th-percentile contrast (the verdict pixel). */
    worst: string;
    /** Background pixel at the median contrast. */
    median: string;
    /** Number of background pixels sampled. */
    sampled: number;
  };
  wcag: {
    /** 5th-percentile ratio: the verdict. */
    ratio: number;
    min: number;
    median: number;
    required: number;
    pass: boolean;
  };
  apca: { lc: number; required: number; pass: boolean };
  /** What axe-core's color-contrast rule said about the same element. */
  axeVerdict: AxeVerdict;
  /** Best fix, or null when no token passes (see notes). Absent when suggestions are off. */
  suggestion?: Suggestion | null;
  /** Path of the annotated screenshot crop, relative to the working directory. */
  screenshot?: string;
  notes?: string[];
  /** Other pages where the same element failed identically (sticky headers, footers). */
  alsoOn?: string[];
}

export interface DriftFinding {
  type: "drift";
  severity: Severity;
  page: string;
  /** Viewports and schemes where this color was seen. */
  viewports: number[];
  schemes: Scheme[];
  /** Rendered color, `#RRGGBB`. */
  color: string;
  /** True when ΔE to the nearest token is below 0.5: almost always a hard-coded near-copy. */
  likelyTypo: boolean;
  label?: "likely-typo";
  nearestToken: { name: string; value: string; deltaE: number } | null;
  property: string;
  selectors: string[];
  source: {
    rule: string;
    stylesheet: string | null;
    line?: number;
    origin?: string;
  } | null;
  occurrences: number;
  /** How the rendered color differs from the authored value (opacity, filter, compositing). */
  cause?: string[];
  suggestion?: Suggestion | null;
  /** Other pages where the same color comes from the same rule. */
  alsoOn?: string[];
}

export type Finding = ContrastFinding | DriftFinding;

/** Every measured text element (only with `includeChecks`). */
export interface ContrastCheck {
  page: string;
  viewport: number;
  scheme: Scheme;
  selector: string;
  text: string;
  fontSizePx: number;
  fontWeight: number;
  largeText: boolean;
  foreground: string;
  background: ContrastFinding["background"];
  wcag: ContrastFinding["wcag"];
  apca: ContrastFinding["apca"];
  axeVerdict: AxeVerdict;
  notes?: string[];
}

export interface PageStats {
  /** Text elements measured. */
  textChecked: number;
  /** Text elements skipped (clipped, transparent text, no pixels). */
  textSkipped: number;
  contrastFailures: number;
  axe: Record<AxeVerdict, number>;
  /** Elements axe left incomplete that RuGBy measured. */
  axeIncompleteResolved: number;
  /** …of which RuGBy found real failures. */
  axeIncompleteFailed: number;
  /** RuGBy failures that axe passed or did not check. */
  axeMissed: number;
}

export interface PageResult {
  url: string;
  viewport: number;
  scheme: Scheme;
  status: "ok" | "error";
  error?: string;
  stats: PageStats;
  notes: string[];
}

export interface TokenUsage {
  name: string;
  value: string;
  mode?: string;
  /** Elements painted with exactly this token. */
  used: number;
  /** Drifted colors whose nearest token is this one. */
  drifted: number;
}

export interface ReportSummary {
  pages: number;
  states: number;
  textChecked: number;
  findings: { contrast: Record<"error" | "warning", number>; drift: Record<Severity, number> };
  axe: {
    /** RuGBy contrast failures where axe said pass, incomplete or did not check. */
    missed: number;
    incomplete: number;
    incompleteResolved: number;
    incompleteFailed: number;
  };
}

export interface Report {
  tool: { name: "rugby"; version: string };
  generatedAt?: string;
  options: {
    viewports: number[];
    schemes: Scheme[];
    standard: Standard;
    level: WcagLevel;
    driftThreshold: number;
    selector: string;
  };
  tokens: { format: string; source: string; count: number; modes: string[] } | null;
  summary: ReportSummary;
  pages: PageResult[];
  findings: Finding[];
  tokenUsage?: TokenUsage[];
  checks?: ContrastCheck[];
}
