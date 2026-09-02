import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BrowserManager } from "./browser-manager.js";
import { resolveContextConfig, resolveConfig } from "./config.js";
import { registerBrowserTools } from "./tools.js";
import type { WebBrowserConfig } from "./types.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default function webBrowserExtension(pi: ExtensionAPI): void {
  let config: WebBrowserConfig = resolveConfig({ cwd: process.cwd(), packageRoot, trustProject: false });
  const manager = new BrowserManager(() => config);

  pi.on("session_start", async (_event, ctx) => {
    config = resolveContextConfig(ctx, packageRoot);
  });

  pi.on("session_shutdown", async () => {
    await manager.closeAll();
  });

  registerBrowserTools(pi, manager, () => config);
}

export { BrowserManager } from "./browser-manager.js";
export { buildSearchUrl, builtInDefaults, resolveConfig } from "./config.js";
export { assertNavigationAllowed, hostMatches } from "./host-policy.js";
export { formatInspection, inspectPage } from "./inspect.js";
