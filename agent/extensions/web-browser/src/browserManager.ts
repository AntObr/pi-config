import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { BrowserConfig } from "./config.js";
import { assertNavigationAllowed } from "./hostPolicy.js";
import type { BrowserInteractionAction } from "./actions.js";

export type ElementSummary = {
  elementId: number;
  tag: string;
  role?: string;
  text: string;
  type?: string;
  name?: string;
  href?: string;
  placeholder?: string;
  suggestedSelectors: string[];
};

export type InspectResult = {
  session: string;
  url: string;
  title: string;
  text: string;
  elements: ElementSummary[];
  note: string;
};

type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  headless: boolean;
  config: BrowserConfig;
  elementSelectors: Map<number, string>;
  lastBlockedNavigation?: string;
};

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();

  async getOrCreateSession(name: string, config: BrowserConfig, headless?: boolean) {
    const existing = this.sessions.get(name);
    if (existing) {
      existing.config = config;
      return existing;
    }

    const sessionHeadless = headless ?? config.defaultHeadless;
    try {
      const browser = await chromium.launch({ headless: sessionHeadless });
      const context = await browser.newContext();
      const page = await context.newPage();
      const session: BrowserSession = { browser, context, page, headless: sessionHeadless, config, elementSelectors: new Map<number, string>() };
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (!request.isNavigationRequest() || request.resourceType() !== "document") {
          await route.continue();
          return;
        }

        try {
          assertNavigationAllowed(request.url(), session.config);
          await route.continue();
        } catch (error) {
          session.lastBlockedNavigation = error instanceof Error ? error.message : String(error);
          await route.abort("blockedbyclient");
        }
      });
      this.sessions.set(name, session);
      return session;
    } catch (error) {
      throw withInstallHint(error);
    }
  }

  async navigate(args: { session: string; url: string; headless?: boolean; timeoutMs?: number }, config: BrowserConfig) {
    assertNavigationAllowed(args.url, config);
    const browserSession = await this.getOrCreateSession(args.session, config, args.headless);
    browserSession.lastBlockedNavigation = undefined;
    try {
      await browserSession.page.goto(args.url, {
        waitUntil: "domcontentloaded",
        timeout: args.timeoutMs ?? config.navigationTimeoutMs,
      });
    } catch (error) {
      if (browserSession.lastBlockedNavigation) throw new Error(browserSession.lastBlockedNavigation);
      throw error;
    }
    browserSession.elementSelectors.clear();
    return this.basicPageState(args.session, browserSession.page, browserSession.headless);
  }

  async inspect(sessionName: string, config: BrowserConfig, options: { maxTextLength?: number } = {}): Promise<InspectResult> {
    const browserSession = await this.getOrCreateSession(sessionName, config);
    const page = browserSession.page;
    const [title, text, elements] = await Promise.all([
      page.title(),
      visibleText(page, options.maxTextLength ?? 12_000),
      collectElements(page),
    ]);

    browserSession.elementSelectors = new Map(elements.map((element) => [element.elementId, element.suggestedSelectors[0] ?? ""]));

    return {
      session: sessionName,
      url: page.url(),
      title,
      text,
      elements,
      note: "elementId values are valid only until the next navigation or DOM-changing interaction. Inspect again after page changes.",
    };
  }

  async html(sessionName: string, config: BrowserConfig, selector?: string) {
    const browserSession = await this.getOrCreateSession(sessionName, config);
    if (selector) return browserSession.page.locator(selector).first().evaluate((node) => (node as HTMLElement).outerHTML);
    return browserSession.page.content();
  }

  async screenshot(sessionName: string, config: BrowserConfig, path: string, fullPage: boolean) {
    const browserSession = await this.getOrCreateSession(sessionName, config);
    await browserSession.page.screenshot({ path, fullPage });
  }

  async interact(args: {
    session: string;
    action: BrowserInteractionAction;
    selector?: string;
    elementId?: number;
    value?: string;
    key?: string;
    timeoutMs?: number;
  }, config: BrowserConfig) {
    const browserSession = await this.getOrCreateSession(args.session, config);
    const selector = resolveSelector(browserSession, args.selector, args.elementId);
    const locator = browserSession.page.locator(selector).first();
    const timeout = args.timeoutMs ?? config.navigationTimeoutMs;

    browserSession.lastBlockedNavigation = undefined;
    try {
      if (args.action === "click") await locator.click({ timeout });
      else if (args.action === "fill") await locator.fill(requiredValue(args.value, "value"), { timeout });
      else if (args.action === "type") await locator.pressSequentially(requiredValue(args.value, "value"), { timeout });
      else if (args.action === "press") await locator.press(requiredValue(args.key, "key"), { timeout });
      else await locator.selectOption(requiredValue(args.value, "value"), { timeout });
    } catch (error) {
      if (browserSession.lastBlockedNavigation) throw new Error(browserSession.lastBlockedNavigation);
      throw error;
    }

    browserSession.elementSelectors.clear();
    await browserSession.page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeout, 5_000) }).catch(() => undefined);
    if (browserSession.lastBlockedNavigation) throw new Error(browserSession.lastBlockedNavigation);
    return this.basicPageState(args.session, browserSession.page, browserSession.headless);
  }

  async close(sessionName?: string) {
    if (sessionName) {
      const session = this.sessions.get(sessionName);
      if (!session) return { closed: [] as string[] };
      await session.browser.close();
      this.sessions.delete(sessionName);
      return { closed: [sessionName] };
    }

    const names = [...this.sessions.keys()];
    await Promise.all([...this.sessions.values()].map((session) => session.browser.close()));
    this.sessions.clear();
    return { closed: names };
  }

  private async basicPageState(session: string, page: Page, headless: boolean) {
    return {
      session,
      headless,
      url: page.url(),
      title: await page.title().catch(() => ""),
    };
  }
}

async function visibleText(page: Page, maxLength: number) {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n[visible text truncated]` : text;
}

async function collectElements(page: Page): Promise<ElementSummary[]> {
  return page.evaluate(() => {
    const cssEscape = (value: string) => {
      const css = (globalThis as unknown as { CSS?: { escape?: (input: string) => string } }).CSS;
      return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    };

    const textOf = (element: Element) => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const attrSelector = (name: string, value: string) => `[${name}="${value.replaceAll('"', '\\"')}"]`;
    const cssPath = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const parent: Element | null = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift(`#${cssEscape(current.id)}`);
          break;
        }
        if (!parent) {
          parts.unshift(tag);
          break;
        }
        const siblings = [...parent.children].filter((child) => child.tagName === current!.tagName);
        const index = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        current = parent;
      }
      return parts.join(" > ");
    };

    return [...document.querySelectorAll("a,button,input,select,textarea,[role=button],[role=link],summary,[contenteditable=true]")]
      .filter(isVisible)
      .slice(0, 200)
      .map((element, index) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const selectors: string[] = [];
        if (html.id) selectors.push(`#${cssEscape(html.id)}`);
        for (const attr of ["data-testid", "data-test", "aria-label", "name", "placeholder"]) {
          const value = html.getAttribute(attr);
          if (value) selectors.push(attrSelector(attr, value));
        }
        selectors.push(cssPath(element));

        return {
          elementId: index + 1,
          tag: element.tagName.toLowerCase(),
          role: html.getAttribute("role") ?? undefined,
          text: textOf(element),
          type: input.type || undefined,
          name: input.name || undefined,
          href: (element as HTMLAnchorElement).href || undefined,
          placeholder: input.placeholder || undefined,
          suggestedSelectors: [...new Set(selectors.filter(Boolean))],
        };
      });
  });
}

function resolveSelector(session: BrowserSession, selector?: string, elementId?: number) {
  if (selector) return selector;
  if (elementId === undefined) throw new Error("Provide selector or elementId");
  const mapped = session.elementSelectors.get(elementId);
  if (!mapped) throw new Error(`Unknown elementId ${elementId}. Run browser_inspect again and use an elementId from the latest result.`);
  return mapped;
}

function requiredValue(value: string | undefined, name: string) {
  if (value === undefined) throw new Error(`${name} is required for this action`);
  return value;
}

function withInstallHint(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("Please run") || message.includes("playwright install")) {
    return new Error(`${message}\n\nChromium is not installed for Playwright. Run: npx playwright install chromium`);
  }
  return error instanceof Error ? error : new Error(message);
}
