import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export type BrowserConfig = {
  searchUrl: string;
  defaultHeadless: boolean;
  navigationTimeoutMs: number;
  allowedHosts: string[];
  blockedHosts: string[];
  artifactsDir: string;
};

export const DEFAULT_CONFIG: BrowserConfig = {
  searchUrl: "https://www.google.com/search?q={query}",
  defaultHeadless: true,
  navigationTimeoutMs: 30_000,
  allowedHosts: [],
  blockedHosts: [],
  artifactsDir: `${CONFIG_DIR_NAME}/web-browser-artifacts`,
};

type PartialBrowserConfig = Partial<BrowserConfig>;

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export type LoadConfigOptions = {
  packageConfigPath?: string;
  userConfigPath?: string;
};

export function getConfigPaths(cwd: string, options: LoadConfigOptions = {}) {
  return {
    project: join(cwd, CONFIG_DIR_NAME, "web-browser.json"),
    user: options.userConfigPath ?? join(homedir(), CONFIG_DIR_NAME, "agent", "web-browser.json"),
    package: options.packageConfigPath ?? join(packageRoot, "config.json"),
  };
}

export async function loadConfig(cwd: string, options: LoadConfigOptions = {}): Promise<BrowserConfig> {
  const paths = getConfigPaths(cwd, options);
  const packageConfig = await readConfig(paths.package);
  const userConfig = await readConfig(paths.user);
  const projectConfig = await readConfig(paths.project);

  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...packageConfig,
    ...userConfig,
    ...projectConfig,
  });
}

async function readConfig(path: string): Promise<PartialBrowserConfig> {
  if (!existsSync(path)) return {};

  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as PartialBrowserConfig;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid browser config at ${path}: expected a JSON object`);
  }
  return parsed;
}

function normalizeConfig(input: PartialBrowserConfig): BrowserConfig {
  const searchUrl = stringOrDefault(input.searchUrl, DEFAULT_CONFIG.searchUrl);
  if (!searchUrl.includes("{query}")) {
    throw new Error("Browser config searchUrl must include {query}");
  }

  return {
    searchUrl,
    defaultHeadless: booleanOrDefault(input.defaultHeadless, DEFAULT_CONFIG.defaultHeadless),
    navigationTimeoutMs: numberOrDefault(input.navigationTimeoutMs, DEFAULT_CONFIG.navigationTimeoutMs),
    allowedHosts: stringArrayOrDefault(input.allowedHosts, DEFAULT_CONFIG.allowedHosts),
    blockedHosts: stringArrayOrDefault(input.blockedHosts, DEFAULT_CONFIG.blockedHosts),
    artifactsDir: stringOrDefault(input.artifactsDir, DEFAULT_CONFIG.artifactsDir),
  };
}

function stringOrDefault(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringArrayOrDefault(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

export function resolveArtifactsDir(cwd: string, config: BrowserConfig) {
  return isAbsolute(config.artifactsDir) ? config.artifactsDir : resolve(cwd, config.artifactsDir);
}
