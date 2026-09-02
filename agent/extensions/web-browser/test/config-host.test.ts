import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildSearchUrl, resolveConfig } from "../src/config.js";
import { assertNavigationAllowed, hostMatches } from "../src/host-policy.js";

test("config precedence is project, user, package, defaults", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "web-browser-config-"));
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(packageRoot, { recursive: true });

  await writeFile(path.join(packageRoot, "web-browser.json"), JSON.stringify({ navigationTimeoutMs: 10, blockedHosts: ["package.test"] }));
  await writeFile(path.join(agentDir, "web-browser.json"), JSON.stringify({ defaultHeadless: false, blockedHosts: ["user.test"] }));
  await writeFile(path.join(cwd, ".pi", "web-browser.json"), JSON.stringify({ allowedHosts: ["project.test"], artifactDir: "artifacts" }));

  const config = resolveConfig({ cwd, packageRoot, agentDir, trustProject: true });

  assert.equal(config.navigationTimeoutMs, 10);
  assert.equal(config.defaultHeadless, false);
  assert.deepEqual(config.blockedHosts, ["user.test"]);
  assert.deepEqual(config.allowedHosts, ["project.test"]);
  assert.equal(config.artifactDir, path.join(cwd, "artifacts"));
});

test("untrusted project config is ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "web-browser-untrusted-"));
  const cwd = path.join(root, "project");
  const packageRoot = path.join(root, "package");
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(cwd, ".pi", "web-browser.json"), JSON.stringify({ allowedHosts: ["project.test"] }));

  const config = resolveConfig({ cwd, packageRoot, agentDir: path.join(root, "missing-agent"), trustProject: false });
  assert.deepEqual(config.allowedHosts, []);
});

test("search URL builder replaces or appends query", () => {
  assert.equal(buildSearchUrl({ searchUrl: "https://example.test/search?q={query}" }, "a b"), "https://example.test/search?q=a%20b");
  assert.equal(buildSearchUrl({ searchUrl: "https://example.test/search" }, "a b"), "https://example.test/search?q=a+b");
});

test("host policy is permissive by default, blocks listed hosts, and restricts allow lists", () => {
  assert.doesNotThrow(() => assertNavigationAllowed("https://anything.test/", { allowedHosts: [], blockedHosts: [] }));
  assert.throws(() => assertNavigationAllowed("https://bad.test/", { allowedHosts: [], blockedHosts: ["bad.test"] }), /blockedHosts/);
  assert.throws(() => assertNavigationAllowed("https://other.test/", { allowedHosts: ["good.test"], blockedHosts: [] }), /allowedHosts/);
  assert.doesNotThrow(() => assertNavigationAllowed("https://docs.example.com/", { allowedHosts: ["*.example.com"], blockedHosts: [] }));
  assert.equal(hostMatches("example.com", "*.example.com"), true);
});
