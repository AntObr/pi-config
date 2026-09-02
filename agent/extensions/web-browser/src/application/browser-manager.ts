import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { inspectPageInBrowser } from "../browser/inspection.ts";
import { rawHtmlInBrowser } from "../browser/raw-html.ts";
import type { BrowserSession, BrowserTypeLike, LocatorLike } from "../browser/types.ts";
import { screenshotArtifactFile } from "../support/artifacts.ts";
import {
  BrowserInspectionError,
  BrowserInteractionError,
  BrowserRawHtmlError,
  BrowserScreenshotError,
  BrowserSessionModeConflictError,
} from "../support/errors.ts";
import type {
  BrowserClosedDetails,
  BrowserInteractedDetails,
  BrowserScreenshotDetails,
  InspectionDetails,
  InteractionAction,
  InteractionRequest,
} from "../support/types.ts";

function requiredInteractionValue(action: InteractionAction, value: string | undefined): string {
  if (value === undefined) throw new BrowserInteractionError(`Cannot ${action}: provide a value.`);
  return value;
}

function missingInteractionTargetError(action: InteractionAction): BrowserInteractionError {
  return new BrowserInteractionError(`Cannot ${action}: provide an elementId from the latest inspection or a raw selector.`);
}

function requiredInteractionLocator(action: InteractionAction, locator: LocatorLike | undefined): LocatorLike {
  if (!locator) throw missingInteractionTargetError(action);
  return locator;
}

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();

  constructor(private readonly browserType: BrowserTypeLike = chromium) {}

  async navigate(
    url: string,
    options: { session: string; requestedHeadless?: boolean; defaultHeadless: boolean; timeoutMs: number; dynamicViewport?: boolean },
  ): Promise<{ url: string; title: string; dynamicViewport: boolean }> {
    const session = await this.getSession(options.session, options.requestedHeadless, options.defaultHeadless, options.dynamicViewport);
    await session.page.goto(url, { waitUntil: "load", timeout: options.timeoutMs });
    session.latestInspection = undefined;
    return { url: session.page.url(), title: await session.page.title(), dynamicViewport: session.dynamicViewport };
  }

  async inspect(name: string): Promise<Omit<InspectionDetails, "status" | "session" | "elementIdScope">> {
    const session = this.sessions.get(name);
    if (!session) throw new BrowserInspectionError(`Cannot inspect browser session ${name}: navigate first.`);

    const payload = await session.page.evaluate(inspectPageInBrowser);
    const inspectionId = ++session.inspectionSequence;
    const elements = payload.elements.map((element, index) => ({
      id: `e${index + 1}`,
      ...element,
    }));
    session.latestInspection = { elements };
    return {
      inspectionId,
      url: session.page.url(),
      title: await session.page.title(),
      text: payload.text,
      elements,
    };
  }

  async rawHtml(name: string, selector?: string): Promise<{ url: string; title: string; html: string }> {
    const session = this.sessions.get(name);
    if (!session) throw new BrowserRawHtmlError(`Cannot capture raw HTML for browser session ${name}: navigate first.`);

    if (selector === "") throw new BrowserRawHtmlError(`Cannot capture raw HTML: selector "" was not found.`);

    const payload = await session.page.evaluate(rawHtmlInBrowser, selector);
    if (!payload.selectorFound) throw new BrowserRawHtmlError(`Cannot capture raw HTML: selector ${selector} was not found.`);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      html: payload.html ?? "",
    };
  }

  async screenshot(name: string, artifactDir: string, fullPage: boolean): Promise<Omit<BrowserScreenshotDetails, "status" | "session">> {
    const session = this.sessions.get(name);
    if (!session) throw new BrowserScreenshotError(`Cannot capture screenshot for browser session ${name}: navigate first.`);

    try {
      await mkdir(artifactDir, { recursive: true });
    } catch {
      throw new BrowserScreenshotError(`Cannot create screenshot artifact directory ${artifactDir}: check that the path is writable.`);
    }

    const artifactFile = screenshotArtifactFile(name);
    const artifactPath = join(artifactDir, artifactFile);
    let title: string;
    try {
      title = await session.page.title();
      await session.page.screenshot({ path: artifactPath, fullPage });
    } catch {
      throw new BrowserScreenshotError(
        `Cannot capture screenshot for browser session ${name}: page is unavailable. Navigate or reload the page and try again.`,
      );
    }

    return {
      url: session.page.url(),
      title,
      artifactPath,
      artifactFile,
      fullPage,
    };
  }

  async interact(name: string, request: InteractionRequest): Promise<BrowserInteractedDetails> {
    const session = this.sessions.get(name);
    if (!session) throw new BrowserInteractionError(`Cannot interact with browser session ${name}: navigate first.`);

    const selector = this.resolveInteractionSelector(session, request);
    await this.performInteraction(session, selector, request);
    session.latestInspection = undefined;

    return {
      status: "interacted",
      session: name,
      action: request.action,
      ...(selector ? { selector } : {}),
      ...(request.elementId ? { elementId: request.elementId } : {}),
      ...(request.value !== undefined ? { value: request.value } : {}),
    };
  }

  async close(name: string): Promise<BrowserClosedDetails> {
    const session = this.sessions.get(name);
    if (!session) return { status: "closed", session: name, existed: false };

    await this.closeSession(session);
    this.sessions.delete(name);
    return { status: "closed", session: name, existed: true };
  }

  async closeAll(): Promise<BrowserClosedDetails[]> {
    const entries = [...this.sessions.entries()];

    return Promise.all(
      entries.map(async ([name, session]) => {
        await this.closeSession(session);
        this.sessions.delete(name);
        return { status: "closed", session: name, existed: true } satisfies BrowserClosedDetails;
      }),
    );
  }

  private async closeSession(session: BrowserSession): Promise<void> {
    try {
      await session.context.close();
    } finally {
      await session.browser.close();
    }
  }

  private resolveInteractionSelector(session: BrowserSession, request: InteractionRequest): string | undefined {
    if (request.selector && request.elementId) {
      throw new BrowserInteractionError(`Cannot ${request.action}: provide either an elementId or a raw selector, not both.`);
    }
    if (request.selector) return request.selector;
    if (!request.elementId) {
      if (request.action === "press") return undefined;
      throw missingInteractionTargetError(request.action);
    }

    const inspection = session.latestInspection;
    if (!inspection) {
      throw new BrowserInteractionError(`Element ID ${request.elementId} is stale. Inspect again, then use an element ID from the latest inspection.`);
    }

    const element = inspection.elements.find((candidate) => candidate.id === request.elementId);
    if (!element) {
      throw new BrowserInteractionError(`Element ID ${request.elementId} was not found in the latest inspection. Inspect again and choose a listed element ID.`);
    }
    const selector = element.selectors[0];
    if (!selector) {
      throw new BrowserInteractionError(`Element ID ${request.elementId} has no selector. Use a raw selector instead.`);
    }
    return selector;
  }

  private async performInteraction(
    session: BrowserSession,
    selector: string | undefined,
    request: InteractionRequest,
  ): Promise<void> {
    const locator = selector ? session.page.locator(selector) : undefined;
    switch (request.action) {
      case "click":
        await requiredInteractionLocator(request.action, locator).click();
        return;
      case "type":
        await requiredInteractionLocator(request.action, locator).type(requiredInteractionValue(request.action, request.value));
        return;
      case "fill":
        await requiredInteractionLocator(request.action, locator).fill(requiredInteractionValue(request.action, request.value));
        return;
      case "press": {
        const value = requiredInteractionValue(request.action, request.value);
        if (locator) await locator.press(value);
        else if (session.page.keyboard) await session.page.keyboard.press(value);
        else throw new BrowserInteractionError(`Cannot press ${value}: this browser page does not expose keyboard input.`);
        return;
      }
      case "select":
        await requiredInteractionLocator(request.action, locator).selectOption(requiredInteractionValue(request.action, request.value));
        return;
    }
  }

  private async getSession(
    name: string,
    requestedHeadless: boolean | undefined,
    defaultHeadless: boolean,
    requestedDynamicViewport: boolean | undefined,
  ): Promise<BrowserSession> {
    const existing = this.sessions.get(name);
    if (existing) {
      if (requestedHeadless !== undefined && requestedHeadless !== existing.headless) {
        throw new BrowserSessionModeConflictError(
          `Browser session ${name} is already ${existing.headless ? "headless" : "headed"}. Close it before changing mode.`,
        );
      }
      if (requestedDynamicViewport !== undefined && requestedDynamicViewport !== existing.dynamicViewport) {
        throw new BrowserSessionModeConflictError(
          `Browser session ${name} already uses ${existing.dynamicViewport ? "a dynamic" : "a fixed"} viewport. Close it before changing viewport mode.`,
        );
      }
      return existing;
    }

    const headless = requestedHeadless ?? defaultHeadless;
    const dynamicViewport = requestedDynamicViewport ?? !headless;
    const browser = await this.browserType.launch({ headless });
    const context = await browser.newContext(dynamicViewport ? { viewport: null } : undefined);
    const page = await context.newPage();
    const session = { browser, context, page, inspectionSequence: 0, headless, dynamicViewport };
    this.sessions.set(name, session);
    return session;
  }
}
