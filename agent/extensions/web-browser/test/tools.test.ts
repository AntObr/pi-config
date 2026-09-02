import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerBrowserTools } from "../src/tools.js";
import { builtInDefaults } from "../src/config.js";
import type { WebBrowserConfig } from "../src/types.js";

function collectTools(manager: unknown, config: WebBrowserConfig) {
  const tools = new Map<string, any>();
  registerBrowserTools({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any, manager as any, () => config);
  return tools;
}

test("registered navigate tool enforces host policy before creating a session", async () => {
  let created = false;
  const manager = { getSession: async () => { created = true; throw new Error("should not create"); } };
  const tools = collectTools(manager, { ...builtInDefaults, blockedHosts: ["blocked.test"] });

  const result = await tools.get("browser_navigate").execute("id", { url: "https://blocked.test/" });

  assert.equal(result.isError, true);
  assert.equal(created, false);
  assert.match(result.content[0].text, /blockedHosts/);
});

test("registered HTML tool returns a preview and writes full HTML artifact", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "web-browser-tool-html-"));
  const html = `<html>${"x".repeat(80)}</html>`;
  const manager = {
    getSession: async () => ({ name: "docs", page: { content: async () => html } }),
  };
  const tools = collectTools(manager, { ...builtInDefaults, artifactDir, htmlPreviewMaxChars: 20 });

  const result = await tools.get("browser_html").execute("id", { session: "docs" });

  assert.equal(result.details.truncated, true);
  assert.ok(result.details.artifactPath);
  assert.equal(await readFile(result.details.artifactPath, "utf8"), html);
});

test("registered screenshot tool saves a PNG artifact path", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "web-browser-tool-png-"));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const manager = {
    getSession: async () => ({ name: "default", page: { screenshot: async () => png } }),
  };
  const tools = collectTools(manager, { ...builtInDefaults, artifactDir });

  const result = await tools.get("browser_screenshot").execute("id", {});

  assert.match(result.content[0].text, /Screenshot saved/);
  assert.match(result.details.artifactPath, /\.png$/);
  assert.deepEqual(await readFile(result.details.artifactPath), png);
});

test("registered close tool reports closed sessions", async () => {
  const manager = { closeSession: async (name: string) => name === "default" };
  const tools = collectTools(manager, builtInDefaults);

  const result = await tools.get("browser_close").execute("id", {});

  assert.equal(result.details.closed, true);
  assert.match(result.content[0].text, /Closed browser session/);
});
