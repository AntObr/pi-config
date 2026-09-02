import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_BROWSER_CONFIG,
  assertUrlAllowed,
  browserTools,
  buildSearchUrl,
  resolveBrowserConfig,
  BrowserConfigError,
} from "../src/index.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-web-browser-config-"));
}

test("with no config files, built-in defaults are resolved", async () => {
  const root = await tempDir();
  const config = await resolveBrowserConfig({
    cwd: join(root, "project"),
    userConfigDir: join(root, "user"),
    packageDir: join(root, "package"),
  });

  assert.deepEqual(config, {
    ...DEFAULT_BROWSER_CONFIG,
    artifactDir: join(homedir(), ".pi", "web-browser-artifacts"),
  });
  assert.doesNotThrow(() => assertUrlAllowed("https://example.com/docs", config));
});

test("package, user, and project config merge with project settings winning", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  const userConfigDir = join(root, "user");
  const packageDir = join(root, "package");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(userConfigDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });

  await writeFile(
    join(packageDir, "web-browser.json"),
    JSON.stringify({
      headless: false,
      navigationTimeoutMs: 1000,
      searchUrl: "https://package.test/search?q={query}",
      allowedHosts: ["package.test"],
      blockedHosts: ["blocked-by-package.test"],
      artifactDir: "package-artifacts",
    }),
  );
  await writeFile(
    join(userConfigDir, "web-browser.json"),
    JSON.stringify({
      navigationTimeoutMs: 2000,
      allowedHosts: ["user.test"],
      artifactDir: "user-artifacts",
    }),
  );
  await writeFile(
    join(cwd, ".pi", "web-browser.json"),
    JSON.stringify({
      searchUrl: "https://project.test/search?q={query}",
      blockedHosts: ["blocked-by-project.test"],
    }),
  );

  const config = await resolveBrowserConfig({ cwd, userConfigDir, packageDir });

  assert.equal(config.headless, false);
  assert.equal(config.navigationTimeoutMs, 2000);
  assert.equal(config.searchUrl, "https://project.test/search?q={query}");
  assert.deepEqual(config.allowedHosts, ["user.test"]);
  assert.deepEqual(config.blockedHosts, ["blocked-by-project.test"]);
  assert.equal(config.artifactDir, join(cwd, "user-artifacts"));
});

test("a non-empty allowed host list restricts navigation", async () => {
  const config = { ...DEFAULT_BROWSER_CONFIG, allowedHosts: ["example.com", "*.example.org"] };

  assert.doesNotThrow(() => assertUrlAllowed("https://example.com/docs", config));
  assert.doesNotThrow(() => assertUrlAllowed("https://api.example.org/docs", config));
  assert.throws(
    () => assertUrlAllowed("https://other.test", config),
    /not in allowedHosts.*example\.com.*\*\.example\.org/i,
  );
});

test("blocked hosts are denied even when policy is otherwise permissive", () => {
  const config = { ...DEFAULT_BROWSER_CONFIG, blockedHosts: ["bad.test"] };

  assert.throws(() => assertUrlAllowed("https://bad.test/", config), /blockedHosts.*bad\.test/i);
  assert.doesNotThrow(() => assertUrlAllowed("https://good.test/", config));
});

test("invalid config produces an actionable error", async () => {
  const root = await tempDir();
  const userConfigDir = join(root, "user");
  await mkdir(userConfigDir, { recursive: true });
  await writeFile(join(userConfigDir, "web-browser.json"), "{ nope");

  await assert.rejects(
    () =>
      resolveBrowserConfig({
        cwd: join(root, "project"),
        userConfigDir,
        packageDir: join(root, "package"),
      }),
    (error) =>
      error instanceof BrowserConfigError &&
      /Could not parse web browser config/.test(error.message) &&
      error.message.includes(join(userConfigDir, "web-browser.json")),
  );
});

test("unreadable config produces an actionable error", async () => {
  const root = await tempDir();
  const packageDir = join(root, "package");
  await mkdir(join(packageDir, "web-browser.json"), { recursive: true });

  await assert.rejects(
    () =>
      resolveBrowserConfig({
        cwd: join(root, "project"),
        userConfigDir: join(root, "user"),
        packageDir,
      }),
    (error) =>
      error instanceof BrowserConfigError &&
      /Could not read web browser config/.test(error.message) &&
      error.message.includes(join(packageDir, "web-browser.json")),
  );
});

test("search URLs use configured template and URL-encode the query", () => {
  assert.equal(
    buildSearchUrl("react docs", { ...DEFAULT_BROWSER_CONFIG, searchUrl: "https://search.test/?q={query}" }),
    "https://search.test/?q=react+docs",
  );
});

test("navigate tool applies host policy before browser behavior", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ blockedHosts: ["blocked.test"] }));

  const navigate = browserTools.find((tool) => tool.name === "browser_navigate");
  assert.ok(navigate);

  const result = await navigate.execute(
    "test-call",
    { url: "https://blocked.test" },
    undefined,
    undefined,
    { cwd } as never,
  );

  assert.deepEqual(result.details, {
    status: "denied",
    reason: "Navigation denied: blocked.test matches blockedHosts entry blocked.test.",
  });
});
