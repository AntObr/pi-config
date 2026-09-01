import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type PlaceholderDetails = {
  status: "not_implemented";
  tool: string;
};

const sessionParameter = Type.Optional(
  Type.String({
    description: "Named browser session. Defaults to 'default'.",
  }),
);

const navigationTimeoutParameter = Type.Optional(
  Type.Number({ description: "Navigation timeout in milliseconds." }),
);

function notImplemented(tool: string): AgentToolResult<PlaceholderDetails> {
  return {
    content: [
      {
        type: "text",
        text: `${tool} is registered, but browser behavior is not implemented yet. Playwright-backed behavior will be added in a later ticket.`,
      },
    ],
    details: {
      status: "not_implemented",
      tool,
    },
  };
}

export const browserTools = [
  {
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
    async execute() {
      return notImplemented("browser_navigate");
    },
  },
  {
    name: "browser_search",
    label: "Browser search",
    description: "Search the web through a browser session.",
    promptSnippet: "browser_search: search the web through a browser session",
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      session: sessionParameter,
      timeoutMs: navigationTimeoutParameter,
    }),
    async execute() {
      return notImplemented("browser_search");
    },
  },
  {
    name: "browser_inspect",
    label: "Browser inspect",
    description: "Return a compact inspection of the current browser page.",
    promptSnippet: "browser_inspect: inspect the current browser page",
    parameters: Type.Object({
      session: sessionParameter,
    }),
    async execute() {
      return notImplemented("browser_inspect");
    },
  },
  {
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
  },
  {
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
  },
  {
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
    async execute() {
      return notImplemented("browser_interact");
    },
  },
  {
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
  },
] satisfies ToolDefinition[];

export function registerBrowserTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  for (const tool of browserTools) pi.registerTool(tool);
}

export default function webBrowserExtension(pi: ExtensionAPI): void {
  registerBrowserTools(pi);
}
