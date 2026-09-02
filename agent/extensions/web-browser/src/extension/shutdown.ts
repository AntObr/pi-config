import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { BrowserManager } from "../application/browser-manager.ts";
import { defaultBrowserManager } from "./tools.ts";

export function registerBrowserShutdown(pi: Pick<ExtensionAPI, "on">, manager: Pick<BrowserManager, "closeAll"> = defaultBrowserManager): void {
  pi.on("session_shutdown", async () => {
    await manager.closeAll();
  });
}
