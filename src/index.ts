export { type AuditOptions, DEFAULT_HIDE_SELECTORS, type ProgressEvent } from "./audit/options.js";
export { runAudit } from "./audit/run.js";
export type * from "./audit/types.js";
export { type ContrastCheckOptions, checkContrast } from "./check.js";
export * from "./tokens/index.js";

import type { AuditOptions } from "./audit/options.js";
import { runAudit } from "./audit/run.js";
import type { Report } from "./audit/types.js";

/** Audit pages and return the report object (the same JSON `rugby audit --json` prints). */
export function audit(options: AuditOptions): Promise<Report> {
  return runAudit(options);
}
