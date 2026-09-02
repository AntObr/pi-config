import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { chromium } from "playwright";

type PlaceholderDetails = {
  status: "not_implemented";
  tool: string;
};

type NavigationDeniedDetails = {
  status: "denied";
  reason: string;
};

type NavigationLoadedDetails = {
  status: "loaded";
  session: string;
  url: string;
  title: string;
  timeoutMs: number;
};

type BrowserInstallRequiredDetails = {
  status: "browser_install_required";
  reason: string;
};

type BrowserInspectionUnavailableDetails = {
  status: "inspection_unavailable";
  reason: string;
};

type BrowserInteractionUnavailableDetails = {
  status: "interaction_unavailable";
  reason: string;
};

type BrowserInteractedDetails = {
  status: "interacted";
  session: string;
  action: InteractionAction;
  selector?: string;
  elementId?: string;
  value?: string;
};

type InteractionAction = "click" | "type" | "fill" | "press" | "select";
type InteractionRequest = { action: InteractionAction; elementId?: string; selector?: string; value?: string };

type InspectElementDetails = {
  id: string;
  tag: string;
  type?: string;
  text?: string;
  label?: string;
  href?: string;
  selectors: string[];
};

type InspectionDetails = {
  status: "inspected";
  session: string;
  inspectionId: number;
  elementIdScope: string;
  url: string;
  title: string;
  text: string;
  elements: InspectElementDetails[];
};

type ConfigErrorDetails = {
  status: "config_error";
  reason: string;
};

export type BrowserConfig = {
  headless: boolean;
  navigationTimeoutMs: number;
  searchUrl: string;
  allowedHosts: string[];
  blockedHosts: string[];
  artifactDir: string;
};

type BrowserConfigFile = Partial<BrowserConfig>;

type ResolveBrowserConfigOptions = {
  cwd?: string;
  userConfigDir?: string;
  packageDir?: string;
};

export const BROWSER_CONFIG_FILE = "web-browser.json";

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
  headless: true,
  navigationTimeoutMs: 30_000,
  searchUrl: "https://www.google.com/search?q={query}",
  allowedHosts: [],
  blockedHosts: [],
  artifactDir: join(CONFIG_DIR_NAME, "web-browser-artifacts"),
};

export class BrowserConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserConfigError";
  }
}

class NavigationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigationPolicyError";
  }
}

class BrowserInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserInspectionError";
  }
}

class BrowserInteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserInteractionError";
  }
}

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

const sessionParameter = Type.Optional(
  Type.String({
    description: "Named browser session. Defaults to 'default'.",
  }),
);

const navigationTimeoutParameter = Type.Optional(
  Type.Number({ description: "Navigation timeout in milliseconds." }),
);

function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function notImplemented(tool: string): AgentToolResult<PlaceholderDetails> {
  return textResult(
    `${tool} is registered, but browser behavior is not implemented yet. Playwright-backed behavior will be added in a later ticket.`,
    { status: "not_implemented", tool },
  );
}

function configErrorResult(error: BrowserConfigError): AgentToolResult<ConfigErrorDetails> {
  return textResult(error.message, { status: "config_error", reason: error.message });
}

function navigationDeniedResult(error: NavigationPolicyError): AgentToolResult<NavigationDeniedDetails> {
  return textResult(error.message, { status: "denied", reason: error.message });
}

function browserInstallRequiredResult(error: Error): AgentToolResult<BrowserInstallRequiredDetails> {
  const message = `Chromium is not installed for Playwright. Run \`npx playwright install chromium\` and try again.`;
  return textResult(message, { status: "browser_install_required", reason: error.message });
}

function inspectionUnavailableResult(error: BrowserInspectionError): AgentToolResult<BrowserInspectionUnavailableDetails> {
  return textResult(error.message, { status: "inspection_unavailable", reason: error.message });
}

function interactionUnavailableResult(error: BrowserInteractionError): AgentToolResult<BrowserInteractionUnavailableDetails> {
  return textResult(error.message, { status: "interaction_unavailable", reason: error.message });
}

function toolErrorResult(
  error: unknown,
):
  | AgentToolResult<
      ConfigErrorDetails | NavigationDeniedDetails | BrowserInstallRequiredDetails | BrowserInspectionUnavailableDetails | BrowserInteractionUnavailableDetails
    >
  | undefined {
  if (error instanceof BrowserConfigError) return configErrorResult(error);
  if (error instanceof NavigationPolicyError) return navigationDeniedResult(error);
  if (error instanceof BrowserInspectionError) return inspectionUnavailableResult(error);
  if (error instanceof BrowserInteractionError) return interactionUnavailableResult(error);
  if (error instanceof Error && isMissingChromiumError(error)) return browserInstallRequiredResult(error);
  return undefined;
}

function isMissingChromiumError(error: Error): boolean {
  return /Executable doesn't exist|playwright install/i.test(error.message);
}

function defaultUserConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function configPaths(options: Required<ResolveBrowserConfigOptions>): string[] {
  return [
    join(options.packageDir, BROWSER_CONFIG_FILE),
    join(options.userConfigDir, BROWSER_CONFIG_FILE),
    join(options.cwd, CONFIG_DIR_NAME, BROWSER_CONFIG_FILE),
  ];
}

async function readConfigFile(path: string): Promise<BrowserConfigFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw new BrowserConfigError(
      `Could not read web browser config at ${path}: ${(error as Error).message}. Fix permissions or remove the file.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BrowserConfigError(
      `Could not parse web browser config at ${path}: ${(error as Error).message}. Use valid JSON.`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: expected a JSON object.`);
  }

  validateConfigFile(parsed, path);
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStringArray(value: unknown, key: string, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: ${key} must be an array of non-empty strings.`);
  }
}

function validateConfigFile(config: Record<string, unknown>, path: string): asserts config is BrowserConfigFile {
  if (config.headless !== undefined && typeof config.headless !== "boolean") {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: headless must be a boolean.`);
  }
  if (
    config.navigationTimeoutMs !== undefined &&
    (typeof config.navigationTimeoutMs !== "number" || !Number.isFinite(config.navigationTimeoutMs) || config.navigationTimeoutMs <= 0)
  ) {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: navigationTimeoutMs must be a positive number.`);
  }
  if (config.searchUrl !== undefined && (typeof config.searchUrl !== "string" || !config.searchUrl.includes("{query}"))) {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: searchUrl must be a string containing {query}.`);
  }
  if (config.allowedHosts !== undefined) validateStringArray(config.allowedHosts, "allowedHosts", path);
  if (config.blockedHosts !== undefined) validateStringArray(config.blockedHosts, "blockedHosts", path);
  if (config.artifactDir !== undefined && (typeof config.artifactDir !== "string" || config.artifactDir.length === 0)) {
    throw new BrowserConfigError(`Invalid web browser config at ${path}: artifactDir must be a non-empty string.`);
  }
}

export async function resolveBrowserConfig(options: ResolveBrowserConfigOptions = {}): Promise<BrowserConfig> {
  const resolvedOptions = {
    cwd: options.cwd ?? process.cwd(),
    userConfigDir: options.userConfigDir ?? defaultUserConfigDir(),
    packageDir: options.packageDir ?? packageDirectory,
  } satisfies Required<ResolveBrowserConfigOptions>;

  let config: BrowserConfig = { ...DEFAULT_BROWSER_CONFIG };
  for (const path of configPaths(resolvedOptions)) {
    const fileConfig = await readConfigFile(path);
    if (fileConfig) config = { ...config, ...fileConfig };
  }

  return {
    ...config,
    allowedHosts: [...config.allowedHosts],
    blockedHosts: [...config.blockedHosts],
    artifactDir: isAbsolute(config.artifactDir) ? config.artifactDir : resolve(resolvedOptions.cwd, config.artifactDir),
  };
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

function hostMatches(pattern: string, host: string): boolean {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === normalizedPattern;
}

export function assertUrlAllowed(url: string, config: Pick<BrowserConfig, "allowedHosts" | "blockedHosts">): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NavigationPolicyError(`Navigation denied: ${url} is not a valid URL.`);
  }

  const host = normalizeHost(parsed.hostname);
  const blockedBy = config.blockedHosts.find((pattern) => hostMatches(pattern, host));
  if (blockedBy) {
    throw new NavigationPolicyError(`Navigation denied: ${host} matches blockedHosts entry ${blockedBy}.`);
  }

  if (config.allowedHosts.length > 0 && !config.allowedHosts.some((pattern) => hostMatches(pattern, host))) {
    throw new NavigationPolicyError(
      `Navigation denied: ${host} is not in allowedHosts (${config.allowedHosts.join(", ")}).`,
    );
  }
}

export function buildSearchUrl(query: string, config: Pick<BrowserConfig, "searchUrl">): string {
  const encodedQuery = new URLSearchParams({ q: query }).toString().replace(/^q=/, "");
  return config.searchUrl.replace("{query}", encodedQuery);
}

type BrowserTypeLike = {
  launch(options: { headless: boolean }): Promise<BrowserLike>;
};

type BrowserLike = {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
};

type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};

type InspectedPagePayload = {
  text: string;
  elements: Array<Omit<InspectElementDetails, "id">>;
};

type LocatorLike = {
  click(): Promise<unknown>;
  type(value: string): Promise<unknown>;
  fill(value: string): Promise<unknown>;
  press(value: string): Promise<unknown>;
  selectOption(value: string): Promise<unknown>;
};

type PageLike = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  evaluate<R>(pageFunction: () => R): Promise<R>;
  locator(selector: string): LocatorLike;
  keyboard?: { press(value: string): Promise<unknown> };
};

type BrowserSession = {
  browser: BrowserLike;
  context: BrowserContextLike;
  page: PageLike;
  inspectionSequence: number;
  latestInspection?: {
    elements: InspectElementDetails[];
  };
};

function inspectPageInBrowser(): InspectedPagePayload {
  const maxTextLength = 8_000;
  const selector = "a[href], button, input, select, textarea";

  function normalizeText(value: string | null | undefined): string | undefined {
    const text = value?.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 200) : undefined;
  }

  function cssEscape(value: string): string {
    const escape = (globalThis as typeof globalThis & { CSS?: { escape?: (text: string) => string } }).CSS?.escape;
    if (escape) return escape(value);
    return value.replace(/^-?\d|[^a-zA-Z0-9_-]/g, (character) => `\\${character.codePointAt(0)?.toString(16)} `);
  }

  function quoted(value: string): string {
    return `"${value.replace(/(["\\])/g, "\\$1")}"`;
  }

  function isUsable(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (element.matches("input[type='hidden'], [hidden], [aria-hidden='true']")) return false;
    return element.getClientRects().length > 0;
  }

  function labelFor(element: Element): string | undefined {
    if (!(element instanceof HTMLElement)) return undefined;
    const ariaLabel = normalizeText(element.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelledText = normalizeText(
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText)
          .filter(Boolean)
          .join(" "),
      );
      if (labelledText) return labelledText;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element.id) {
        const explicitLabel = normalizeText(document.querySelector(`label[for="${cssEscape(element.id)}"]`)?.textContent);
        if (explicitLabel) return explicitLabel;
      }
      const wrappedLabel = normalizeText(element.closest("label")?.textContent);
      if (wrappedLabel) return wrappedLabel;
      const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? normalizeText(element.placeholder) : undefined;
      if (placeholder) return placeholder;
      const name = normalizeText(element.getAttribute("name"));
      if (name) return name;
    }
    return undefined;
  }

  function selectorsFor(element: Element, text: string | undefined, label: string | undefined): string[] {
    const selectors: string[] = [];
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute("id");
    if (id) selectors.push(`#${cssEscape(id)}`);
    for (const attr of ["data-testid", "data-test", "data-cy", "name", "placeholder", "aria-label"] as const) {
      const value = element.getAttribute(attr);
      if (value) selectors.push(`${tag}[${attr}=${quoted(value)}]`);
    }
    if (label && element.closest("label")) selectors.push(`label:has-text(${quoted(label)}) ${tag}`);
    if (element instanceof HTMLAnchorElement && element.href) selectors.push(`a[href=${quoted(element.href)}]`);
    if ((tag === "button" || tag === "a") && text) selectors.push(`${tag}:has-text(${quoted(text)})`);
    if (label && selectors.length === 0) selectors.push(`${tag}:near(:text(${quoted(label)}))`);
    return [...new Set(selectors)].slice(0, 4);
  }

  const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextLength);
  const elements = Array.from(document.querySelectorAll(selector))
    .filter(isUsable)
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const text = normalizeText(element.textContent);
      const label = labelFor(element);
      const type = element instanceof HTMLInputElement ? element.type : undefined;
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      return {
        tag,
        ...(type ? { type } : {}),
        ...(text ? { text } : {}),
        ...(label ? { label } : {}),
        ...(href ? { href } : {}),
        selectors: selectorsFor(element, text, label),
      };
    });

  return { text, elements };
}

const ELEMENT_ID_SCOPE = "latest inspection only; inspect again after navigation or page changes";

function formatInspection(details: InspectionDetails): string {
  const lines = [`URL: ${details.url}`, `Title: ${details.title || "(untitled)"}`, "", "Visible text:", details.text || "(no visible text)", "", "Interactable elements:"];
  if (details.elements.length === 0) {
    lines.push("(none found)");
  } else {
    for (const element of details.elements) {
      const name = element.text ?? element.label ?? element.href ?? element.tag;
      const parts = [`[${element.id}]`, element.tag];
      if (element.type) parts.push(`type=${element.type}`);
      parts.push(quotedForReport(name));
      if (element.selectors.length > 0) parts.push(`selectors: ${element.selectors.join(", ")}`);
      lines.push(parts.join(" "));
    }
  }
  lines.push("", `Element IDs are scoped to the ${ELEMENT_ID_SCOPE}.`);
  return lines.join("\n");
}

function quotedForReport(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function requiredInteractionValue(action: InteractionAction, value: string | undefined): string {
  if (value === undefined) throw new BrowserInteractionError(`Cannot ${action}: provide a value.`);
  return value;
}

function missingInteractionTargetError(action: InteractionAction): BrowserInteractionError {
  return new BrowserInteractionError(`Cannot ${action}: provide an elementId from the latest inspection or a raw selector.`);
}

function formatInteraction(details: BrowserInteractedDetails): string {
  const target = details.elementId ? `element ${details.elementId}` : details.selector ? `selector ${details.selector}` : "page keyboard";
  return `Ran ${details.action} on ${target}. Inspect again before using element IDs.`;
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
    options: { session: string; headless: boolean; timeoutMs: number },
  ): Promise<{ url: string; title: string }> {
    const session = await this.getSession(options.session, options.headless);
    await session.page.goto(url, { waitUntil: "load", timeout: options.timeoutMs });
    session.latestInspection = undefined;
    return { url: session.page.url(), title: await session.page.title() };
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

  private async getSession(name: string, headless: boolean): Promise<BrowserSession> {
    const existing = this.sessions.get(name);
    if (existing) return existing;

    const browser = await this.browserType.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    const session = { browser, context, page, inspectionSequence: 0 };
    this.sessions.set(name, session);
    return session;
  }
}

const defaultBrowserManager = new BrowserManager();

async function resolveConfigForTool(ctx?: ExtensionContext): Promise<BrowserConfig> {
  return resolveBrowserConfig({ cwd: ctx?.cwd });
}

async function checkedNavigationResult(
  params: { url: string; session?: string; headless?: boolean; timeoutMs?: number },
  manager: BrowserManager,
  config: BrowserConfig,
): Promise<AgentToolResult<unknown>> {
  try {
    assertUrlAllowed(params.url, config);
    const session = params.session ?? "default";
    const timeoutMs = params.timeoutMs ?? config.navigationTimeoutMs;
    const loaded = await manager.navigate(params.url, {
      session,
      headless: params.headless ?? config.headless,
      timeoutMs,
    });
    return textResult(`Loaded ${loaded.title || loaded.url} at ${loaded.url}.`, {
      status: "loaded",
      session,
      url: loaded.url,
      title: loaded.title,
      timeoutMs,
    } satisfies NavigationLoadedDetails);
  } catch (error) {
    const result = toolErrorResult(error);
    if (result) return result;
    throw error;
  }
}

type BrowserToolDependencies = {
  manager?: BrowserManager;
};

export function createBrowserTools(dependencies: BrowserToolDependencies = {}): ToolDefinition[] {
  const manager = dependencies.manager ?? defaultBrowserManager;
  return [
    defineTool({
      name: "browser_navigate",
      label: "Browser navigate",
      description: "Open a URL in a named browser session.",
      promptSnippet: "browser_navigate: open a URL in a named browser session",
      parameters: Type.Object({
        url: Type.String({ description: "URL to open." }),
        session: sessionParameter,
        headless: Type.Optional(
          Type.Boolean({ description: "Choose headless mode when creating a new session." }),
        ),
        timeoutMs: navigationTimeoutParameter,
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const config = await resolveConfigForTool(ctx);
          return checkedNavigationResult(params, manager, config);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
      },
    }),
    defineTool({
      name: "browser_search",
      label: "Browser search",
      description: "Search the web through a browser session.",
      promptSnippet: "browser_search: search the web through a browser session",
      parameters: Type.Object({
        query: Type.String({ description: "Search query." }),
        session: sessionParameter,
        timeoutMs: navigationTimeoutParameter,
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const config = await resolveConfigForTool(ctx);
          const url = buildSearchUrl(params.query, config);
          return checkedNavigationResult({ url, session: params.session, timeoutMs: params.timeoutMs }, manager, config);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
      },
    }),
    defineTool({
      name: "browser_inspect",
      label: "Browser inspect",
      description: "Return a compact inspection of the current browser page.",
      promptSnippet: "browser_inspect: inspect the current browser page",
      parameters: Type.Object({
        session: sessionParameter,
      }),
      async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
        try {
          const session = params.session ?? "default";
          const inspected = await manager.inspect(session);
          const details = {
            status: "inspected",
            session,
            elementIdScope: ELEMENT_ID_SCOPE,
            ...inspected,
          } satisfies InspectionDetails;
          return textResult(formatInspection(details), details);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
      },
    }),
    defineTool({
      name: "browser_raw_html",
      label: "Browser raw HTML",
      description: "Return raw HTML for the current page or a selector.",
      promptSnippet: "browser_raw_html: capture raw HTML from the current page",
      parameters: Type.Object({
        session: sessionParameter,
        selector: Type.Optional(Type.String({ description: "Optional selector to capture." })),
      }),
      async execute() {
        return notImplemented("browser_raw_html");
      },
    }),
    defineTool({
      name: "browser_screenshot",
      label: "Browser screenshot",
      description: "Save a screenshot for the current page.",
      promptSnippet: "browser_screenshot: save a screenshot for the current page",
      parameters: Type.Object({
        session: sessionParameter,
        fullPage: Type.Optional(Type.Boolean({ description: "Capture the full page." })),
      }),
      async execute() {
        return notImplemented("browser_screenshot");
      },
    }),
    defineTool({
      name: "browser_interact",
      label: "Browser interact",
      description: "Click, type, fill, press, or select on the current page.",
      promptSnippet: "browser_interact: interact with elements on the current page",
      parameters: Type.Object({
        session: sessionParameter,
        action: Type.Union([
          Type.Literal("click"),
          Type.Literal("type"),
          Type.Literal("fill"),
          Type.Literal("press"),
          Type.Literal("select"),
        ]),
        elementId: Type.Optional(Type.String({ description: "Element ID from the latest inspection." })),
        selector: Type.Optional(Type.String({ description: "Raw selector to target." })),
        value: Type.Optional(Type.String({ description: "Text, key, or option value for the action." })),
      }),
      async execute(_toolCallId, params): Promise<AgentToolResult<unknown>> {
        try {
          const session = params.session ?? "default";
          const details = await manager.interact(session, params);
          return textResult(formatInteraction(details), details);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
      },
    }),
    defineTool({
      name: "browser_close",
      label: "Browser close",
      description: "Close a named browser session.",
      promptSnippet: "browser_close: close a named browser session",
      parameters: Type.Object({
        session: sessionParameter,
      }),
      async execute() {
        return notImplemented("browser_close");
      },
    }),
  ] satisfies ToolDefinition[];
}

export const browserTools = createBrowserTools();

export function registerBrowserTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  for (const tool of browserTools) pi.registerTool(tool);
}

export default function webBrowserExtension(pi: ExtensionAPI): void {
  registerBrowserTools(pi);
}
