import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import { BrowserConfigError } from "./errors.ts";

export type BrowserConfig = {
  headless: boolean;
  navigationTimeoutMs: number;
  searchUrl: string;
  allowedHosts: string[];
  blockedHosts: string[];
  artifactDir: string;
};

type BrowserConfigFile = Partial<BrowserConfig>;

export type ResolveBrowserConfigOptions = {
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
  artifactDir: join(homedir(), CONFIG_DIR_NAME, "web-browser-artifacts"),
};

const packageDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

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
