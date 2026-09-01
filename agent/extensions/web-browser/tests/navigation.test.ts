import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserManager, createBrowserTools } from "../src/index.ts";

type FakePage = {
  requestedTimeouts: number[];
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<void>;
  url(): string;
  title(): Promise<string>;
};

type FakeBrowserOptions = {
  title?: string;
  finalUrl?: string;
  readTitleFromPage?: boolean;
  fetchUrl?: string;
};

function makeFakeBrowser(options: FakeBrowserOptions = {}) {
  const launches: Array<{ headless: boolean }> = [];
  const pages: FakePage[] = [];
  const browserType = {
    async launch(launchOptions: { headless: boolean }) {
      launches.push(launchOptions);
      let currentUrl = "";
      let currentTitle = options.title ?? "Fake page";
      const page: FakePage = {
        requestedTimeouts: [],
        async goto(url, gotoOptions) {
          currentUrl = options.finalUrl ?? url;
          page.requestedTimeouts.push(gotoOptions.timeout);
          if (options.readTitleFromPage) {
            const html = await fetch(options.fetchUrl ?? url).then((response) => response.text());
            currentTitle = /<title>(.*?)<\/title>/i.exec(html)?.[1] ?? "";
          }
        },
        url() {
          return currentUrl;
        },
        async title() {
          return currentTitle;
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
  return mkdtemp(join(tmpdir(), "pi-web-browser-navigation-"));
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

async function withServer(title: string, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) => (server as Server).close((error) => (error ? reject(error) : resolve())));
  }
}

test("navigate tool loads a localhost URL and returns final URL and title", async () => {
  const fake = makeFakeBrowser({ readTitleFromPage: true });
  const manager = new BrowserManager(fake.browserType as never);
  const [navigate] = createBrowserTools({ manager });

  await withServer("Local app", async (url) => {
    fake.pages.length = 0;
    const result = await navigate.execute("test-call", { url }, undefined, undefined, { cwd: process.cwd() } as never);

    const resultDetails = details(result);
    assert.equal(resultDetails.status, "loaded");
    assert.equal(resultDetails.session, "default");
    assert.equal(resultDetails.url, url);
    assert.equal(resultDetails.title, "Local app");
    assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Loaded Local app/);
  });
});

test("navigate tool allows public-style hosts when policy permits them", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ allowedHosts: ["docs.example.test"] }));

  await withServer("Docs", async (serverUrl) => {
    const fake = makeFakeBrowser({
      finalUrl: "http://docs.example.test/guide",
      readTitleFromPage: true,
      fetchUrl: serverUrl,
    });
    const manager = new BrowserManager(fake.browserType as never);
    const [navigate] = createBrowserTools({ manager });

    const result = await navigate.execute(
      "test-call",
      { url: "http://docs.example.test/guide" },
      undefined,
      undefined,
      { cwd } as never,
    );

    const resultDetails = details(result);
    assert.equal(resultDetails.status, "loaded");
    assert.equal(resultDetails.url, "http://docs.example.test/guide");
    assert.equal(resultDetails.title, "Docs");
  });
});

test("navigate checks allow list before launching Chromium", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ allowedHosts: ["allowed.test"] }));

  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const [navigate] = createBrowserTools({ manager });

  const result = await navigate.execute("test-call", { url: "https://blocked.test" }, undefined, undefined, { cwd } as never);

  assert.equal(details(result).status, "denied");
  assert.equal(fake.launches.length, 0);
});

test("navigate starts sessions headless by default and accepts a per-session override", async () => {
  const fake = makeFakeBrowser({ title: "Headless", finalUrl: "https://example.test/" });
  const manager = new BrowserManager(fake.browserType as never);
  const [navigate] = createBrowserTools({ manager });

  await navigate.execute("test-call", { url: "https://example.test/" }, undefined, undefined, { cwd: process.cwd() } as never);
  await navigate.execute(
    "test-call",
    { url: "https://example.test/", session: "headed", headless: false },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  assert.deepEqual(fake.launches, [{ headless: true }, { headless: false }]);
});

test("navigate uses configured timeout and per-call override", async () => {
  const root = await tempDir();
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "web-browser.json"), JSON.stringify({ navigationTimeoutMs: 1234 }));

  const fake = makeFakeBrowser({ title: "Timeouts", finalUrl: "https://example.test/" });
  const manager = new BrowserManager(fake.browserType as never);
  const [navigate] = createBrowserTools({ manager });

  await navigate.execute("test-call", { url: "https://example.test/" }, undefined, undefined, { cwd } as never);
  await navigate.execute("test-call", { url: "https://example.test/", timeoutMs: 4321 }, undefined, undefined, { cwd } as never);

  assert.deepEqual(fake.pages[0]?.requestedTimeouts, [1234, 4321]);
});

test("navigate launch failure tells the user how to install Chromium", async () => {
  const browserType = {
    async launch() {
      throw new Error("Executable doesn't exist at /tmp/chromium");
    },
  };
  const manager = new BrowserManager(browserType as never);
  const [navigate] = createBrowserTools({ manager });

  const result = await navigate.execute(
    "test-call",
    { url: "https://example.test/" },
    undefined,
    undefined,
    { cwd: process.cwd() } as never,
  );

  assert.equal(details(result).status, "browser_install_required");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /npx playwright install chromium/);
});
