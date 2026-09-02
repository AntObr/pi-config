import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { BrowserManager } from "./src/browserManager.js";
import { loadConfig } from "./src/config.js";
import { buildSearchUrl } from "./src/search.js";
import { truncateForTool } from "./src/truncate.js";
import { createArtifactPath, timestampedName, writeArtifact } from "./src/artifacts.js";
import { BROWSER_INTERACTION_ACTIONS } from "./src/actions.js";

const sessionField = Type.Optional(Type.String({ description: "Named browser session. Defaults to 'default'." }));
const headlessField = Type.Optional(Type.Boolean({ description: "Headless mode for a new named browser session. Ignored if the session already exists." }));
const timeoutField = Type.Optional(Type.Integer({ minimum: 1, description: "Navigation or action timeout in milliseconds. Defaults to config navigationTimeoutMs." }));

export default function (pi: ExtensionAPI) {
  const manager = new BrowserManager();

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description: "Open a URL in a named Chromium browser session. Creates the session if needed. Missing Chromium errors tell the user to run npx playwright install chromium.",
    promptSnippet: "Open URLs in a Playwright Chromium browser for local app testing or web browsing",
    promptGuidelines: [
      "Use browser_navigate to open localhost apps, documentation pages, or search results in Chromium.",
      "Use browser_inspect after browser_navigate or browser_interact to read the page and discover current elementId values.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Absolute URL to load, such as http://localhost:3000 or https://example.com." }),
      session: sessionField,
      headless: headlessField,
      timeoutMs: timeoutField,
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      onUpdate?.({ content: [{ type: "text", text: `Opening ${params.url}` }], details: {} });
      const state = await manager.navigate({ session: params.session ?? "default", url: params.url, headless: params.headless, timeoutMs: params.timeoutMs }, config);
      return textResult(`Opened ${state.url}\nTitle: ${state.title}\nSession: ${state.session}\nHeadless: ${state.headless}`, state);
    },
  });

  pi.registerTool({
    name: "browser_search",
    label: "Browser Search",
    description: "Search the web by navigating Chromium to the configured search URL. Default search URL is Google.",
    promptSnippet: "Search the web through the configured browser search page",
    promptGuidelines: ["Use browser_search when the agent needs to find public web pages through a browser rather than a direct search API."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      session: sessionField,
      headless: headlessField,
      timeoutMs: timeoutField,
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      const url = buildSearchUrl(params.query, config);
      onUpdate?.({ content: [{ type: "text", text: `Searching for ${params.query}` }], details: {} });
      const state = await manager.navigate({ session: params.session ?? "default", url, headless: params.headless, timeoutMs: params.timeoutMs }, config);
      return textResult(`Searched for ${params.query}\nOpened ${state.url}\nTitle: ${state.title}\nSession: ${state.session}`, { ...state, query: params.query });
    },
  });

  pi.registerTool({
    name: "browser_inspect",
    label: "Browser Inspect",
    description: "Return a compact report for the current page: URL, title, visible text, and interactable elements with elementId values and suggested selectors.",
    promptSnippet: "Inspect the current browser page as compact text plus interactable element IDs",
    promptGuidelines: ["Use browser_inspect before browser_interact. browser_inspect elementId values expire after navigation or DOM-changing actions."],
    parameters: Type.Object({
      session: sessionField,
      maxTextLength: Type.Optional(Type.Integer({ minimum: 100, maximum: 50_000, description: "Maximum visible text characters to include. Defaults to 12000." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      const result = await manager.inspect(params.session ?? "default", config, { maxTextLength: params.maxTextLength });
      return textResult(formatInspect(result), result);
    },
  });

  pi.registerTool({
    name: "browser_html",
    label: "Browser HTML",
    description: "Return raw HTML for the current page or a selector. Large HTML is truncated in the tool result and saved to an artifact file.",
    parameters: Type.Object({
      session: sessionField,
      selector: Type.Optional(Type.String({ description: "Optional Playwright selector. If provided, returns only the first matching element's outerHTML." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      const html = await manager.html(params.session ?? "default", config, params.selector);
      const truncated = truncateForTool(html);
      const details: Record<string, unknown> = {
        session: params.session ?? "default",
        selector: params.selector,
        truncated: truncated.truncated,
        originalBytes: truncated.originalBytes,
        originalLines: truncated.originalLines,
      };
      let text = truncated.content;
      if (truncated.truncated) {
        const path = await writeArtifact(ctx.cwd, config, timestampedName("page", "html"), html);
        details.path = path;
        text += `\n\n[HTML truncated from ${truncated.originalBytes} bytes and ${truncated.originalLines} lines. Full HTML saved to ${path}]`;
      }
      return { content: [{ type: "text", text }], details };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Capture the current browser page as a PNG artifact file and return the path.",
    parameters: Type.Object({
      session: sessionField,
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page. Defaults to true." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      const path = await createArtifactPath(ctx.cwd, config, timestampedName("screenshot", "png"));
      await manager.screenshot(params.session ?? "default", config, path, params.fullPage ?? true);
      return textResult(`Screenshot saved to ${path}`, { session: params.session ?? "default", path, fullPage: params.fullPage ?? true });
    },
  });

  pi.registerTool({
    name: "browser_interact",
    label: "Browser Interact",
    description: "Interact with the current page using an elementId from the latest browser_inspect result or a raw Playwright selector. Supports click, fill, type, press, and select.",
    promptSnippet: "Click, fill, type, press keys, or select options in the current browser page",
    promptGuidelines: ["Use browser_interact with elementId values from the latest browser_inspect result or with a raw selector when testing page markup."],
    parameters: Type.Object({
      session: sessionField,
      action: StringEnum(BROWSER_INTERACTION_ACTIONS),
      elementId: Type.Optional(Type.Integer({ minimum: 1, description: "elementId from the latest browser_inspect result." })),
      selector: Type.Optional(Type.String({ description: "Raw Playwright selector. Used when elementId is absent." })),
      value: Type.Optional(Type.String({ description: "Text or option value for fill, type, or select." })),
      key: Type.Optional(Type.String({ description: "Keyboard key for press, such as Enter or Escape." })),
      timeoutMs: timeoutField,
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const config = await loadConfig(ctx.cwd);
      onUpdate?.({ content: [{ type: "text", text: `${params.action} in browser session ${params.session ?? "default"}` }], details: {} });
      const state = await manager.interact({
        session: params.session ?? "default",
        action: params.action,
        selector: params.selector,
        elementId: params.elementId,
        value: params.value,
        key: params.key,
        timeoutMs: params.timeoutMs,
      }, config);
      return textResult(`Action complete: ${params.action}\nURL: ${state.url}\nTitle: ${state.title}\nInspect again before using elementId values.`, state);
    },
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser Close",
    description: "Close one named browser session, or all browser sessions if no session is provided.",
    parameters: Type.Object({
      session: sessionField,
    }),
    async execute(_id, params) {
      const result = await manager.close(params.session);
      return textResult(result.closed.length > 0 ? `Closed browser sessions: ${result.closed.join(", ")}` : "No matching browser session was open.", result);
    },
  });

  pi.on("session_shutdown", async () => {
    await manager.close();
  });
}

function textResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

function formatInspect(result: Awaited<ReturnType<BrowserManager["inspect"]>>) {
  const lines = [
    `Session: ${result.session}`,
    `URL: ${result.url}`,
    `Title: ${result.title}`,
    "",
    "Visible text:",
    result.text || "[no visible body text]",
    "",
    `Interactable elements (${result.elements.length}):`,
  ];

  for (const element of result.elements) {
    const label = [element.tag, element.type ? `type=${element.type}` : undefined, element.role ? `role=${element.role}` : undefined]
      .filter(Boolean)
      .join(" ");
    const text = element.text ? ` text="${element.text}"` : "";
    const extra = element.href ? ` href=${element.href}` : element.placeholder ? ` placeholder="${element.placeholder}"` : "";
    lines.push(`${element.elementId}. ${label}${text}${extra}`);
    if (element.suggestedSelectors.length > 0) lines.push(`   selectors: ${element.suggestedSelectors.join(" | ")}`);
  }

  lines.push("", result.note);
  return lines.join("\n");
}
