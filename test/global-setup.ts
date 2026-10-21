import { execFileSync } from "node:child_process";

/** Build dist/ once so CLI and MCP tests exercise the real binaries. */
export default function setup(): void {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    stdio: "inherit",
  });
}
