import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserManager, createBrowserTools } from "../src/index.ts";

function makeFakeBrowser(options: { url?: string; title?: string; html: string; regions?: Record<string, string> }) {
  const browserType = {
    async launch() {
      let currentUrl = options.url ?? "https://example.test/page";
      return {
        async newContext() {
          return {
            async newPage() {
              return {
                async goto(url: string) {
                  currentUrl = url;
                },
                url() {
                  return currentUrl;
                },
                async title() {
                  return options.title ?? "Example page";
                },
                async evaluate(_pageFunction: unknown, selector?: string) {
                  if (!selector) return { html: options.html, selectorFound: true };
                  const html = options.regions?.[selector];
                  return html === undefined ? { selectorFound: false } : { html, selectorFound: true };
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
  return browserType;
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-web-browser-raw-html-"));
}

function toolNamed(name: string, tools = createBrowserTools()) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeTool(tool: ReturnType<typeof toolNamed>, params: Record<string, unknown>, cwd = process.cwd()) {
  return tool.execute("test-call", params, undefined, undefined, { cwd } as never);
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? result.content[0].text ?? "" : "";
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

test("raw HTML returns the current page HTML when no selector is provided", async () => {
  const manager = new BrowserManager(makeFakeBrowser({ html: "<!doctype html><html><body><h1>Whole page</h1></body></html>" }) as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" });
  const result = await executeTool(toolNamed("browser_raw_html", tools), {});

  assert.equal(details(result).status, "captured");
  assert.equal(details(result).selector, undefined);
  assert.equal(details(result).truncated, false);
  assert.match(text(result), /<h1>Whole page<\/h1>/);
});

test("raw HTML returns only the selected region when a selector is provided", async () => {
  const manager = new BrowserManager(
    makeFakeBrowser({
      html: "<html><body><main><p>Selected</p></main><aside>Ignored</aside></body></html>",
      regions: { main: "<main><p>Selected</p></main>" },
    }) as never,
  );
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" });
  const result = await executeTool(toolNamed("browser_raw_html", tools), { selector: "main" });

  assert.equal(details(result).selector, "main");
  assert.match(text(result), /<main><p>Selected<\/p><\/main>/);
  assert.doesNotMatch(text(result), /Ignored/);
});

test("raw HTML saves large output to an artifact and returns a truncated preview", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ artifactDir: "artifacts" }));
  const largeHtml = `<html><body>${"x".repeat(60_000)}</body></html>`;
  const manager = new BrowserManager(makeFakeBrowser({ html: largeHtml }) as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" }, cwd);
  const result = await executeTool(toolNamed("browser_raw_html", tools), {}, cwd);

  const resultDetails = details(result);
  assert.equal(resultDetails.truncated, true);
  assert.equal(resultDetails.artifactPath, join(cwd, "artifacts", resultDetails.artifactFile as string));
  assert.match(text(result), /truncated/i);
  assert.match(text(result), /Full HTML saved to /);
  assert.ok(text(result).length < largeHtml.length);
  assert.equal(await readFile(resultDetails.artifactPath as string, "utf8"), largeHtml);
});

test("raw HTML reports the missing selector", async () => {
  const manager = new BrowserManager(makeFakeBrowser({ html: "<html><body></body></html>" }) as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" });
  const result = await executeTool(toolNamed("browser_raw_html", tools), { selector: "#missing" });

  assert.equal(details(result).status, "raw_html_unavailable");
  assert.match(text(result), /#missing/);
  assert.match(text(result), /not found/i);
});

test("raw HTML treats an empty selector as a missing selector, not a whole page request", async () => {
  const manager = new BrowserManager(makeFakeBrowser({ html: "<html><body><h1>Whole page</h1></body></html>" }) as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" });
  const result = await executeTool(toolNamed("browser_raw_html", tools), { selector: "" });

  assert.equal(details(result).status, "raw_html_unavailable");
  assert.match(text(result), /selector ""/);
  assert.doesNotMatch(text(result), /Whole page/);
});
