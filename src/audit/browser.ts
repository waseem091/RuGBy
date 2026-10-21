/** Locating and launching Chromium through playwright-core. */
import { existsSync, readdirSync } from "node:fs";
import type { Browser } from "playwright-core";
import { UsageError } from "../errors.js";

const PREINSTALLED = "/opt/pw-browsers";

/** Use a preinstalled browser directory when the environment has one. */
function configureBrowsersPath(): void {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  if (existsSync(PREINSTALLED) && readdirSync(PREINSTALLED).some((d) => d.startsWith("chromium"))) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = PREINSTALLED;
  }
}

export interface LaunchOptions {
  /** Explicit Chromium/Chrome executable (also `RUGBY_CHROMIUM`). */
  executablePath?: string;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  configureBrowsersPath();
  const { chromium } = await import("playwright-core");
  const executablePath = options.executablePath ?? process.env.RUGBY_CHROMIUM;
  try {
    return await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        // Pixels must be plain sRGB for the color math to hold.
        "--force-color-profile=srgb",
        "--hide-scrollbars",
        "--disable-lcd-text",
        "--font-render-hinting=none",
      ],
    });
  } catch (error) {
    const message = (error as Error).message;
    if (/Executable doesn't exist|browserType.launch/.test(message)) {
      throw new UsageError(
        `Could not start Chromium. Install it with \`npx playwright-core install chromium\`, or point RUGBY_CHROMIUM at a Chrome/Chromium binary.\n${message.split("\n")[0]}`,
      );
    }
    throw error;
  }
}

/** Default viewport height for a width, so pages lay out like a real device. */
export function viewportHeight(width: number): number {
  if (width < 600) return 812;
  if (width < 1024) return 1024;
  return 900;
}
