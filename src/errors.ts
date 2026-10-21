/** Bad input or configuration: the CLI exits with code 2. */
export class UsageError extends Error {
  override name = "UsageError";
}
