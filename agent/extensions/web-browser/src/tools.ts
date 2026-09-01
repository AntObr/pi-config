import { Type, type Static } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maybeTruncateToArtifact, writeArtifact } from "./artifacts.js";
import { BrowserManager, waitAfterAction } from "./browser-manager.js";
import { buildSearchUrl } from "./config.js";
import { assertNavigationAllowed } from "./host-policy.js";
import { formatInspection, inspectPage } from "./inspect.js";
import type { BrowserEngine, ToolResult, WebBrowserConfig } from "./types.js";

const SessionFields = {
  session: Type.Optional(Type.String({ description: "Named browser session. Defaults to default." })),
};

const BrowserEngineSchema = Type.Optional(Type.Literal("chromium", { description: "Browser engine. v1 supports chromium only." }));

const navigateSchema = Type.Object({
  ...SessionFields,
  url: Type.String({ description: "HTTP or HTTPS URL to open." }),
  headless: Type.Optional(Type.Boolean({ description: "Set only when creating the session. Defaults to config." })),
  timeoutMs: Type.Optional(Type.Number({ description: "Navigation timeout in milliseconds." })),
  engine: BrowserEngineSchema,
});

type NavigateInput = Static<typeof navigateSchema>;

const searchSchema = Type.Object({
  ...SessionFields,
  query: Type.String(),
  headless: Type.Optional(Type.Boolean()),
  timeoutMs: Type.Optional(Type.Number()),
  engine: BrowserEngineSchema,
});

type SearchInput = Static<typeof searchSchema>;

const inspectSchema = Type.Object({ ...SessionFields });

const htmlSchema = Type.Object({
  ...SessionFields,
  selector: Type.Optional(Type.String({ description: "Optional selector to capture one element's HTML." })),
});

type HtmlInput = Static<typeof htmlSchema>;

const screenshotSchema = Type.Object({
  ...SessionFields,
  selector: Type.Optional(Type.String({ description: "Optional selector to screenshot one element." })),
  fullPage: Type.Optional(Type.Boolean({ description: "Capture the full page. Defaults to false." })),
});

type ScreenshotInput = Static<typeof screenshotSchema>;

const interactionSchema = Type.Object({
  ...SessionFields,
  action: Type.Union([
    Type.Literal("click"),
    Type.Literal("fill"),
    Type.Literal("type"),
    Type.Literal("press"),
    Type.Literal("select"),
  ]),
  elementId: Type.Optional(Type.String({ description: "Element ID from the latest inspection." })),
  selector: Type.Optional(Type.String({ description: "Raw Playwright selector." })),
  text: Type.Optional(Type.String({ description: "Text for fill/type, or key for press." })),
  value: Type.Optional(Type.String({ description: "Option value for select." })),
  timeoutMs: Type.Optional(Type.Number()),
});

type InteractionInput = Static<typeof interactionSchema>;

const closeSchema = Type.Object({ ...SessionFields });

type CloseInput = Static<typeof closeSchema>;

function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

function errorResult(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
}

async function safeExecute(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error);
  }
}

async function navigateSession(options: {
  manager: BrowserManager;
  config: WebBrowserConfig;
  url: string;
  session?: string;
  headless?: boolean;
  timeoutMs?: number;
  engine?: BrowserEngine;
}): Promise<{ sessionName: string; finalUrl: string; headless: boolean }> {
  assertNavigationAllowed(options.url, options.config);
  const session = await options.manager.getSession({
    name: options.session,
    headless: options.headless,
    engine: options.engine,
  });
  await session.page.goto(options.url, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs ?? options.config.navigationTimeoutMs,
  });
  options.manager.invalidate(session);
  return { sessionName: session.name, finalUrl: session.page.url(), headless: session.headless };
}

export function registerBrowserTools(pi: ExtensionAPI, manager: BrowserManager, configProvider: () => WebBrowserConfig): void {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser navigate",
    description: "Open an HTTP or HTTPS URL in a named Chromium browser session.",
    parameters: navigateSchema,
    execute: async (_id, params: NavigateInput) =>
      safeExecute(async () => {
        const navigated = await navigateSession({
          manager,
          config: configProvider(),
          url: params.url,
          session: params.session,
          headless: params.headless,
          timeoutMs: params.timeoutMs,
          engine: params.engine,
        });
        return textResult(`Opened ${navigated.finalUrl} in session '${navigated.sessionName}'.`, {
          url: navigated.finalUrl,
          session: navigated.sessionName,
          headless: navigated.headless,
          engine: "chromium",
        });
      }),
  });

  pi.registerTool({
    name: "browser_search",
    label: "Browser search",
    description: "Search the web by navigating the browser to the configured search URL.",
    parameters: searchSchema,
    execute: async (_id, params: SearchInput) =>
      safeExecute(async () => {
        const config = configProvider();
        const navigated = await navigateSession({
          manager,
          config,
          url: buildSearchUrl(config, params.query),
          session: params.session,
          headless: params.headless,
          timeoutMs: params.timeoutMs,
          engine: params.engine,
        });
        return textResult(`Searched for ${JSON.stringify(params.query)} in session '${navigated.sessionName}'.`, {
          url: navigated.finalUrl,
          session: navigated.sessionName,
        });
      }),
  });

  pi.registerTool({
    name: "browser_inspect",
    label: "Browser inspect",
    description: "Return a compact report with URL, title, visible text, and current interactable elements.",
    parameters: inspectSchema,
    execute: async (_id, params: { session?: string }) =>
      safeExecute(async () => {
        const config = configProvider();
        const session = await manager.getSession({ name: params.session });
        const data = await inspectPage(session.page, session, config);
        return textResult(formatInspection({ ...data, inspectionVersion: session.inspectionVersion }), {
          url: data.url,
          title: data.title,
          session: session.name,
          inspectionVersion: session.inspectionVersion,
          elements: data.elements,
        });
      }),
  });

  pi.registerTool({
    name: "browser_html",
    label: "Browser HTML",
    description: "Return raw HTML for the whole page or one selector. Large HTML is saved to an artifact file.",
    parameters: htmlSchema,
    execute: async (_id, params: HtmlInput) =>
      safeExecute(async () => {
        const config = configProvider();
        const session = await manager.getSession({ name: params.session });
        const html = params.selector
          ? await session.page.locator(params.selector).evaluate((node) => (node as HTMLElement).outerHTML)
          : await session.page.content();
        const truncated = await maybeTruncateToArtifact({
          content: html,
          maxChars: config.htmlPreviewMaxChars,
          artifactDir: config.artifactDir,
          sessionName: session.name,
          kind: "html",
        });
        return textResult(truncated.text, {
          session: session.name,
          selector: params.selector,
          truncated: truncated.truncated,
          artifactPath: truncated.artifactPath,
        });
      }),
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser screenshot",
    description: "Capture a PNG screenshot and save it to the configured artifact directory.",
    parameters: screenshotSchema,
    execute: async (_id, params: ScreenshotInput) =>
      safeExecute(async () => {
        const config = configProvider();
        const session = await manager.getSession({ name: params.session });
        const target = params.selector ? session.page.locator(params.selector) : session.page;
        const buffer = await target.screenshot({ fullPage: params.selector ? undefined : params.fullPage });
        const artifactPath = await writeArtifact({
          artifactDir: config.artifactDir,
          sessionName: session.name,
          kind: "screenshot",
          extension: "png",
          content: buffer,
        });
        return textResult(`Screenshot saved to ${artifactPath}`, { session: session.name, artifactPath });
      }),
  });

  pi.registerTool({
    name: "browser_interact",
    label: "Browser interact",
    description: "Click, fill, type, press a key, or select an option by element ID or selector.",
    parameters: interactionSchema,
    execute: async (_id, params: InteractionInput) =>
      safeExecute(async () => {
        const session = await manager.getSession({ name: params.session });
        const selector = manager.selectorFor(session, params);
        const locator = session.page.locator(selector);
        const timeout = params.timeoutMs;
        if (params.action === "click") await locator.click({ timeout });
        if (params.action === "fill") await locator.fill(params.text ?? "", { timeout });
        if (params.action === "type") await locator.pressSequentially(params.text ?? "", { timeout });
        if (params.action === "press") await locator.press(params.text ?? "Enter", { timeout });
        if (params.action === "select") await locator.selectOption(params.value ?? params.text ?? "", { timeout });
        await waitAfterAction(session.page);
        manager.invalidate(session);
        return textResult(`${params.action} completed on ${selector}. Inspect again before using element IDs.`, {
          session: session.name,
          selector,
          action: params.action,
        });
      }),
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser close",
    description: "Close a named browser session. Defaults to default.",
    parameters: closeSchema,
    execute: async (_id, params: CloseInput) =>
      safeExecute(async () => {
        const name = params.session ?? "default";
        const closed = await manager.closeSession(name);
        return textResult(closed ? `Closed browser session '${name}'.` : `Browser session '${name}' was not open.`, {
          session: name,
          closed,
        });
      }),
  });
}
