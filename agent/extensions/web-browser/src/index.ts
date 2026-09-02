import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerBrowserShutdown } from "./extension/shutdown.ts";
import { registerBrowserTools } from "./extension/tools.ts";

export { BrowserManager } from "./application/browser-manager.ts";
export { browserTools, createBrowserTools, registerBrowserTools } from "./extension/tools.ts";
export { registerBrowserShutdown } from "./extension/shutdown.ts";
export { DEFAULT_BROWSER_CONFIG, BROWSER_CONFIG_FILE, resolveBrowserConfig } from "./support/config.ts";
export type { BrowserConfig, ResolveBrowserConfigOptions } from "./support/config.ts";
export { BrowserConfigError } from "./support/errors.ts";
export { assertUrlAllowed, buildSearchUrl } from "./support/policy.ts";

export default function webBrowserExtension(pi: ExtensionAPI): void {
  registerBrowserTools(pi);
  registerBrowserShutdown(pi);
}
