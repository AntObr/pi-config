import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveArtifactsDir } from "../src/config.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "pi-browser-config-"));
}

test("config precedence is project, then user, then package, then defaults", async () => {
  const cwd = await tempDir();
  const userDir = await tempDir();
  const packageConfig = join(await tempDir(), "config.json");
  const userConfig = join(userDir, "web-browser.json");

  await mkdir(join(cwd, ".pi"));
  await writeFile(packageConfig, JSON.stringify({ searchUrl: "https://package.test/?q={query}", defaultHeadless: false, navigationTimeoutMs: 10 }));
  await writeFile(userConfig, JSON.stringify({ searchUrl: "https://user.test/?q={query}", navigationTimeoutMs: 20 }));
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ searchUrl: "https://project.test/?q={query}" }));

  const config = await loadConfig(cwd, { packageConfigPath: packageConfig, userConfigPath: userConfig });

  assert.equal(config.searchUrl, "https://project.test/?q={query}");
  assert.equal(config.defaultHeadless, false);
  assert.equal(config.navigationTimeoutMs, 20);
});

test("relative artifactsDir resolves under cwd", async () => {
  const cwd = await tempDir();
  const packageConfig = join(await tempDir(), "config.json");
  const userConfig = join(await tempDir(), "missing.json");
  await writeFile(packageConfig, JSON.stringify({ artifactsDir: ".pi/browser-stuff" }));

  const config = await loadConfig(cwd, { packageConfigPath: packageConfig, userConfigPath: userConfig });

  assert.equal(resolveArtifactsDir(cwd, config), join(cwd, ".pi", "browser-stuff"));
});

test("searchUrl must include query placeholder", async () => {
  const cwd = await tempDir();
  const packageConfig = join(await tempDir(), "config.json");
  const userConfig = join(await tempDir(), "missing.json");
  await writeFile(packageConfig, JSON.stringify({ searchUrl: "https://example.test/search" }));

  await assert.rejects(() => loadConfig(cwd, { packageConfigPath: packageConfig, userConfigPath: userConfig }), /searchUrl must include \{query\}/);
});
