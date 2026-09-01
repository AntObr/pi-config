import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WebBrowserConfig } from "./types.js";

const CONFIG_FILE = "web-browser.json";

export const builtInDefaults: WebBrowserConfig = {
  searchUrl: "https://www.google.com/search?q={query}",
  defaultHeadless: true,
  navigationTimeoutMs: 30_000,
  allowedHosts: [],
  blockedHosts: [],
  artifactDir: path.join(CONFIG_DIR_NAME, "web-browser-artifacts"),
  htmlPreviewMaxChars: 20_000,
  inspectionTextMaxChars: 12_000,
};

type PartialConfig = Partial<WebBrowserConfig>;

function readJsonIfPresent(filePath: string): PartialConfig {
  if (!existsSync(filePath)) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Browser config must be a JSON object: ${filePath}`);
  }
  return parsed as PartialConfig;
}

function mergeConfig(base: WebBrowserConfig, override: PartialConfig): WebBrowserConfig {
  return {
    ...base,
    ...override,
    allowedHosts: override.allowedHosts ?? base.allowedHosts,
    blockedHosts: override.blockedHosts ?? base.blockedHosts,
  };
}

function resolveArtifactDir(cwd: string, artifactDir: string): string {
  return path.isAbsolute(artifactDir) ? artifactDir : path.resolve(cwd, artifactDir);
}

export function packageConfigPath(packageRoot: string): string {
  return path.join(packageRoot, CONFIG_FILE);
}

export function userConfigPath(agentDir = getAgentDir()): string {
  return path.join(agentDir, CONFIG_FILE);
}

export function projectConfigPath(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, CONFIG_FILE);
}

export function resolveConfig(options: {
  cwd: string;
  packageRoot: string;
  agentDir?: string;
  trustProject?: boolean;
}): WebBrowserConfig {
  const packageConfig = readJsonIfPresent(packageConfigPath(options.packageRoot));
  const userConfig = readJsonIfPresent(userConfigPath(options.agentDir));
  const projectConfig = options.trustProject === false ? {} : readJsonIfPresent(projectConfigPath(options.cwd));
  const merged = mergeConfig(mergeConfig(mergeConfig(builtInDefaults, packageConfig), userConfig), projectConfig);
  return { ...merged, artifactDir: resolveArtifactDir(options.cwd, merged.artifactDir) };
}

export function resolveContextConfig(ctx: ExtensionContext, packageRoot: string): WebBrowserConfig {
  return resolveConfig({ cwd: ctx.cwd, packageRoot, trustProject: ctx.isProjectTrusted() });
}

export function buildSearchUrl(config: Pick<WebBrowserConfig, "searchUrl">, query: string): string {
  const encoded = encodeURIComponent(query);
  if (config.searchUrl.includes("{query}")) return config.searchUrl.replaceAll("{query}", encoded);
  const url = new URL(config.searchUrl);
  url.searchParams.set("q", query);
  return url.toString();
}
