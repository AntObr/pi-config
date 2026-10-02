import type { Browser, BrowserContext, Page } from "playwright";

export type WebBrowserConfig = {
  searchUrl: string;
  defaultHeadless: boolean;
  navigationTimeoutMs: number;
  allowedHosts: string[];
  blockedHosts: string[];
  artifactDir: string;
  htmlPreviewMaxChars: number;
  inspectionTextMaxChars: number;
};

export type BrowserSession = {
  name: string;
  headless: boolean;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  elementMap: Map<string, string>;
  inspectionVersion: number;
};

export type ToolContent = Array<{ type: "text"; text: string }>;
export type ToolResult = { content: ToolContent; details: Record<string, unknown> | undefined; isError?: boolean };

export type BrowserEngine = "chromium";
