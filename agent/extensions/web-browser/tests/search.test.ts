import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserManager, DEFAULT_BROWSER_CONFIG, buildSearchUrl, createBrowserTools } from "../src/index.ts";

type FakePage = {
  requestedUrls: string[];
  requestedTimeouts: number[];
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<void>;
  url(): string;
  title(): Promise<string>;
};

function makeFakeBrowser(title = "Search results") {
  const launches: Array<{ headless: boolean }> = [];
  const pages: FakePage[] = [];
  const browserType = {
    async launch(launchOptions: { headless: boolean }) {
      launches.push(launchOptions);
      let currentUrl = "";
      const page: FakePage = {
        requestedUrls: [],
        requestedTimeouts: [],
        async goto(url, options) {
          currentUrl = url;
          page.requestedUrls.push(url);
          page.requestedTimeouts.push(options.timeout);
        },
        url() {
          return currentUrl;
        },
        async title() {
          return title;
        },
      };
      pages.push(page);
      return {
        async newContext() {
          return {
            async newPage() {
              return page;
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
  return { browserType, launches, pages };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-web-browser-search-"));
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

async function searchFixture(config: Record<string, unknown>) {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify(config));

  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const search = createBrowserTools({ manager }).find((tool) => tool.name === "browser_search");
  assert.ok(search);

  return { cwd, fake, search };
}

test("default search URL uses Google and encodes the query", () => {
  assert.equal(buildSearchUrl("react docs", DEFAULT_BROWSER_CONFIG), "https://www.google.com/search?q=react+docs");
});

test("search tool navigates to the configured search URL", async () => {
  const { cwd, fake, search } = await searchFixture({ searchUrl: "http://search.test/?q={query}", allowedHosts: ["search.test"] });

  const result = await search.execute("test-call", { query: "local fake search", session: "research" }, undefined, undefined, { cwd } as never);

  const url = "http://search.test/?q=local+fake+search";
  assert.deepEqual(fake.pages[0]?.requestedUrls, [url]);
  assert.equal(details(result).status, "loaded");
  assert.equal(details(result).session, "research");
  assert.equal(details(result).url, url);
});

test("search uses normal navigation timeout handling", async () => {
  const { cwd, fake, search } = await searchFixture({
    searchUrl: "http://search.test/?q={query}",
    allowedHosts: ["search.test"],
    navigationTimeoutMs: 1111,
  });

  await search.execute("test-call", { query: "timeouts" }, undefined, undefined, { cwd } as never);
  await search.execute("test-call", { query: "timeouts", timeoutMs: 2222 }, undefined, undefined, { cwd } as never);

  assert.deepEqual(fake.pages[0]?.requestedTimeouts, [1111, 2222]);
});

test("search checks host policy before launching Chromium", async () => {
  const { cwd, fake, search } = await searchFixture({ searchUrl: "https://blocked.test/search?q={query}", blockedHosts: ["blocked.test"] });

  const result = await search.execute("test-call", { query: "blocked" }, undefined, undefined, { cwd } as never);

  assert.equal(details(result).status, "denied");
  assert.equal(fake.launches.length, 0);
});
