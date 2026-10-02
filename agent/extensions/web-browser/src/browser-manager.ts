import type { Page } from "playwright";
import { assertNavigationAllowed } from "./host-policy.js";
import type { BrowserEngine, BrowserSession, WebBrowserConfig } from "./types.js";

const INSTALL_COMMAND = "npx playwright install chromium";

export function normalizeLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|browserType.launch|chromium/i.test(message)) {
    return new Error(`Chromium is not installed for Playwright. Run: ${INSTALL_COMMAND}`);
  }
  return error instanceof Error ? error : new Error(message);
}

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();

  constructor(private readonly configProvider: () => WebBrowserConfig) {}

  async getSession(options: { name?: string; headless?: boolean; engine?: BrowserEngine } = {}): Promise<BrowserSession> {
    const name = options.name ?? "default";
    const existing = this.sessions.get(name);
    if (existing) return existing;
    const engine = options.engine ?? "chromium";
    if (engine !== "chromium") throw new Error("Only Chromium is supported in v1");
    const config = this.configProvider();
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: options.headless ?? config.defaultHeadless });
      const context = await browser.newContext();
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.isNavigationRequest()) {
          try {
            assertNavigationAllowed(request.url(), this.configProvider());
          } catch {
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      const page = await context.newPage();
      const session: BrowserSession = {
        name,
        headless: options.headless ?? config.defaultHeadless,
        browser,
        context,
        page,
        elementMap: new Map(),
        inspectionVersion: 0,
      };
      this.sessions.set(name, session);
      return session;
    } catch (error) {
      throw normalizeLaunchError(error);
    }
  }

  async closeSession(name = "default"): Promise<boolean> {
    const session = this.sessions.get(name);
    if (!session) return false;
    this.sessions.delete(name);
    await session.browser.close();
    return true;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.browser.close()));
  }

  invalidate(session: BrowserSession): void {
    session.elementMap.clear();
    session.inspectionVersion += 1;
  }

  selectorFor(session: BrowserSession, target: { elementId?: string; selector?: string }): string {
    if (target.selector) return target.selector;
    if (!target.elementId) throw new Error("Provide elementId or selector");
    const selector = session.elementMap.get(target.elementId);
    if (!selector) throw new Error(`Unknown elementId '${target.elementId}'. Inspect the page again and use a current id.`);
    return selector;
  }
}

export async function waitAfterAction(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
}
