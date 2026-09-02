import type { ExtensionAPI, ExtensionContext, ToolDefinition, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { BrowserManager } from "../application/browser-manager.ts";
import { ELEMENT_ID_SCOPE, formatInspection } from "../browser/inspection.ts";
import type { BrowserConfig } from "../support/config.ts";
import { resolveBrowserConfig } from "../support/config.ts";
import { assertUrlAllowed, buildSearchUrl } from "../support/policy.ts";
import { formatClose, formatInteraction, formatRawHtmlResult, textResult, toolErrorResult } from "../support/results.ts";
import type { BrowserClosedDetails, BrowserScreenshotDetails, InspectionDetails, NavigationLoadedDetails } from "../support/types.ts";

const sessionParameter = Type.Optional(
  Type.String({
    description: "Named browser session. Defaults to 'default'.",
  }),
);

const navigationTimeoutParameter = Type.Optional(
  Type.Number({ description: "Navigation timeout in milliseconds." }),
);

export const defaultBrowserManager = new BrowserManager();

async function resolveConfigForTool(ctx?: ExtensionContext): Promise<BrowserConfig> {
  return resolveBrowserConfig({ cwd: ctx?.cwd });
}

async function checkedNavigationResult(
  params: { url: string; session?: string; headless?: boolean; timeoutMs?: number; dynamicViewport?: boolean },
  manager: BrowserManager,
  config: BrowserConfig,
): Promise<AgentToolResult<unknown>> {
  try {
    assertUrlAllowed(params.url, config);
    const session = params.session ?? "default";
    const timeoutMs = params.timeoutMs ?? config.navigationTimeoutMs;
    const loaded = await manager.navigate(params.url, {
      session,
      requestedHeadless: params.headless,
      defaultHeadless: config.headless,
      timeoutMs,
      dynamicViewport: params.dynamicViewport,
    });
    return textResult(`Loaded ${loaded.title || loaded.url} at ${loaded.url}.`, {
      status: "loaded",
      session,
      url: loaded.url,
      title: loaded.title,
      timeoutMs,
      dynamicViewport: loaded.dynamicViewport,
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
        dynamicViewport: Type.Optional(
          Type.Boolean({ description: "Use the headed window's native viewport instead of Playwright's fixed viewport when creating a new session." }),
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
      async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
        try {
          const config = await resolveConfigForTool(ctx);
          const session = params.session ?? "default";
          const captured = await manager.rawHtml(session, params.selector);
          return formatRawHtmlResult({ session, selector: params.selector, ...captured }, config.artifactDir);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
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
      async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> {
        try {
          const config = await resolveConfigForTool(ctx);
          const session = params.session ?? "default";
          const fullPage = params.fullPage ?? false;
          const captured = await manager.screenshot(session, config.artifactDir, fullPage);
          const details = { status: "captured", session, ...captured } satisfies BrowserScreenshotDetails;
          return textResult(`Screenshot saved to ${captured.artifactPath}.`, details);
        } catch (error) {
          const result = toolErrorResult(error);
          if (result) return result;
          throw error;
        }
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
      async execute(_toolCallId, params): Promise<AgentToolResult<BrowserClosedDetails>> {
        const session = params.session ?? "default";
        const details = await manager.close(session);
        return textResult(formatClose(details), details);
      },
    }),
  ] satisfies ToolDefinition[];
}

export const browserTools = createBrowserTools();

export function registerBrowserTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  for (const tool of browserTools) pi.registerTool(tool);
}
