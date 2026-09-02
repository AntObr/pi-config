import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserManager, createBrowserTools } from "../src/index.ts";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFakeBrowser(options: { screenshotError?: Error } = {}) {
  const screenshotCalls: Array<{ path: string; fullPage?: boolean }> = [];
  const browserType = {
    async launch() {
      let currentUrl = "";
      return {
        async newContext() {
          return {
            async newPage() {
              return {
                async goto(url: string) {
                  currentUrl = url;
                },
                url() {
                  return currentUrl || "https://example.test/page";
                },
                async title() {
                  return "Example page";
                },
                async evaluate() {
                  return { text: "Example", elements: [] };
                },
                async screenshot(call: { path: string; fullPage?: boolean }) {
                  screenshotCalls.push(call);
                  if (options.screenshotError) throw options.screenshotError;
                  await writeFile(call.path, pngBytes);
                  return pngBytes;
                },
              };
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
  return { browserType, screenshotCalls };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-web-browser-screenshot-"));
}

function toolNamed(name: string, tools: ReturnType<typeof createBrowserTools>) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeTool(tool: ReturnType<typeof toolNamed>, params: Record<string, unknown>, cwd: string) {
  return tool.execute("test-call", params, undefined, undefined, { cwd } as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? result.content[0].text ?? "" : "";
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

test("screenshot saves a PNG artifact for the active named session and returns only the path", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page", session: "docs" }, cwd);
  const result = await executeTool(toolNamed("browser_screenshot", tools), { session: "docs", fullPage: true }, cwd);

  const resultDetails = details(result);
  assert.equal(resultDetails.status, "captured");
  assert.equal(resultDetails.session, "docs");
  assert.equal(resultDetails.url, "https://example.test/page");
  assert.equal(resultDetails.title, "Example page");
  assert.equal(resultDetails.artifactPath, join(cwd, ".pi", "web-browser-artifacts", resultDetails.artifactFile as string));
  assert.match(resultDetails.artifactFile as string, /^screenshot-docs-.*\.png$/);
  assert.deepEqual(fake.screenshotCalls, [{ path: resultDetails.artifactPath as string, fullPage: true }]);
  assert.deepEqual(await readFile(resultDetails.artifactPath as string), pngBytes);
  assert.equal(text(result), `Screenshot saved to ${resultDetails.artifactPath}.`);
  assert.doesNotMatch(text(result), /iVBOR|base64|89504e47/i);
});

test("screenshot uses a configured artifact directory", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ artifactDir: "browser-output" }));
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" }, cwd);
  const result = await executeTool(toolNamed("browser_screenshot", tools), {}, cwd);

  const resultDetails = details(result);
  assert.equal(resultDetails.artifactPath, join(cwd, "browser-output", resultDetails.artifactFile as string));
  assert.deepEqual(await readFile(resultDetails.artifactPath as string), pngBytes);
});

test("screenshot failures return an actionable error without Playwright internals", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  const fake = makeFakeBrowser({ screenshotError: new Error("page.screenshot: Protocol error (Page.captureScreenshot): Target closed") });
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" }, cwd);
  const result = await executeTool(toolNamed("browser_screenshot", tools), {}, cwd);

  assert.equal(details(result).status, "screenshot_unavailable");
  assert.match(text(result), /Cannot capture screenshot for browser session default/);
  assert.match(text(result), /navigate or reload/i);
  assert.doesNotMatch(text(result), /Protocol error|Page\.captureScreenshot|page\.screenshot/i);
});

test("screenshot reports artifact directory failures without filesystem internals", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ artifactDir: "not-a-directory/child" }));
  await writeFile(join(cwd, "not-a-directory"), "file blocks artifact directory creation");
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" }, cwd);
  const result = await executeTool(toolNamed("browser_screenshot", tools), {}, cwd);

  assert.equal(details(result).status, "screenshot_unavailable");
  assert.match(text(result), /Cannot create screenshot artifact directory/);
  assert.match(text(result), /writable/);
  assert.doesNotMatch(text(result), /ENOTDIR|EACCES|node:internal/i);
});
