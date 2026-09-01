import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type PlaceholderDetails = {
  status: "not_implemented";
  tool: string;
};

type NavigationDeniedDetails = {
  status: "denied";
  reason: string;
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

function toolErrorResult(error: unknown): AgentToolResult<ConfigErrorDetails | NavigationDeniedDetails> | undefined {
  if (error instanceof BrowserConfigError) return configErrorResult(error);
  if (error instanceof NavigationPolicyError) return navigationDeniedResult(error);
  return undefined;
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

async function resolveConfigForTool(ctx?: ExtensionContext): Promise<BrowserConfig> {
  return resolveBrowserConfig({ cwd: ctx?.cwd });
}

async function checkedNavigationResult(url: string, tool: string, ctx?: ExtensionContext): Promise<AgentToolResult<unknown>> {
  try {
    const config = await resolveConfigForTool(ctx);
    assertUrlAllowed(url, config);
    return notImplemented(tool);
  } catch (error) {
    const result = toolErrorResult(error);
    if (result) return result;
    throw error;
  }
}

export const browserTools = [
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
      return checkedNavigationResult(params.url, "browser_navigate", ctx);
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
        assertUrlAllowed(url, config);
        return notImplemented("browser_search");
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
    async execute() {
      return notImplemented("browser_inspect");
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
    async execute() {
      return notImplemented("browser_interact");
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

export function registerBrowserTools(pi: Pick<ExtensionAPI, "registerTool">): void {
  for (const tool of browserTools) pi.registerTool(tool);
}

export default function webBrowserExtension(pi: ExtensionAPI): void {
  registerBrowserTools(pi);
}
