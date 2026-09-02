import assert from "node:assert/strict";
import test from "node:test";

import { BrowserManager, createBrowserTools, registerBrowserShutdown } from "../src/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type FakePage = {
  goto(url: string): Promise<void>;
  url(): string;
  title(): Promise<string>;
  evaluate(): Promise<{ text: string; elements: [] }>;
};

function makeFakeBrowser() {
  const launches: Array<{ headless: boolean }> = [];
  const closedBrowsers: number[] = [];
  const closedContexts: number[] = [];
  let nextId = 1;

  const browserType = {
    async launch(options: { headless: boolean }) {
      launches.push(options);
      const id = nextId++;
      let currentUrl = "";
      const page: FakePage = {
        async goto(url: string) {
          currentUrl = url;
        },
        url() {
          return currentUrl;
        },
        async title() {
          return `Title for ${currentUrl}`;
        },
        async evaluate() {
          return { text: `Text for ${currentUrl}`, elements: [] };
        },
      };
      return {
        async newContext() {
          return {
            async newPage() {
              return page;
            },
            async close() {
              closedContexts.push(id);
            },
          };
        },
        async close() {
          closedBrowsers.push(id);
        },
      };
    },
  };

  return { browserType, launches, closedBrowsers, closedContexts };
}

function toolNamed(name: string, tools: ReturnType<typeof createBrowserTools>) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeTool(tool: ReturnType<typeof toolNamed>, params: Record<string, unknown>) {
  return tool.execute("test-call", params, undefined, undefined, { cwd: process.cwd() } as never);
}

async function executeNamedTool(tools: ReturnType<typeof createBrowserTools>, name: string, params: Record<string, unknown>) {
  return executeTool(toolNamed(name, tools), params);
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

function makeToolsFixture() {
  const fakeBrowser = makeFakeBrowser();
  const manager = new BrowserManager(fakeBrowser.browserType as never);
  const tools = createBrowserTools({ manager });
  return { fakeBrowser, manager, tools };
}

test("named browser sessions keep independent page state", async () => {
  const { tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/docs" });
  await executeNamedTool(tools, "browser_navigate", { session: "app", url: "https://example.test/app" });

  const docs = details(await executeNamedTool(tools, "browser_inspect", { session: "docs" }));
  const app = details(await executeNamedTool(tools, "browser_inspect", { session: "app" }));

  assert.equal(docs.url, "https://example.test/docs");
  assert.equal(docs.text, "Text for https://example.test/docs");
  assert.equal(app.url, "https://example.test/app");
  assert.equal(app.text, "Text for https://example.test/app");
});

test("omitting the session name uses the default session", async () => {
  const { tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { url: "https://example.test/default" });

  const inspected = details(await executeNamedTool(tools, "browser_inspect", {}));
  assert.equal(inspected.session, "default");
  assert.equal(inspected.url, "https://example.test/default");
});

test("browser_close reports missing sessions without throwing", async () => {
  const { fakeBrowser, tools } = makeToolsFixture();

  const closed = details(await executeNamedTool(tools, "browser_close", { session: "missing" }));

  assert.equal(closed.status, "closed");
  assert.equal(closed.session, "missing");
  assert.equal(closed.existed, false);
  assert.deepEqual(fakeBrowser.closedContexts, []);
  assert.deepEqual(fakeBrowser.closedBrowsers, []);
});

test("browser_close closes the requested named session only", async () => {
  const { fakeBrowser, tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/docs" });
  await executeNamedTool(tools, "browser_navigate", { session: "app", url: "https://example.test/app" });

  const closed = details(await executeNamedTool(tools, "browser_close", { session: "docs" }));

  assert.equal(closed.status, "closed");
  assert.equal(closed.session, "docs");
  assert.equal(closed.existed, true);
  assert.deepEqual(fakeBrowser.closedContexts, [1]);
  assert.deepEqual(fakeBrowser.closedBrowsers, [1]);

  const app = details(await executeNamedTool(tools, "browser_inspect", { session: "app" }));
  assert.equal(app.url, "https://example.test/app");
});

test("navigating after close creates a fresh session", async () => {
  const { fakeBrowser, tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/one" });
  await executeNamedTool(tools, "browser_close", { session: "docs" });
  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/two" });

  assert.deepEqual(fakeBrowser.closedContexts, [1]);
  assert.deepEqual(fakeBrowser.closedBrowsers, [1]);
  assert.equal(fakeBrowser.launches.length, 2);

  const inspected = details(await executeNamedTool(tools, "browser_inspect", { session: "docs" }));
  assert.equal(inspected.url, "https://example.test/two");
});

test("session shutdown closes every open session", async () => {
  const { fakeBrowser, manager, tools } = makeToolsFixture();
  let handler: (() => Promise<void>) | undefined;

  registerBrowserShutdown(
    {
      on(event, registeredHandler) {
        assert.equal(event, "session_shutdown");
        handler = registeredHandler as () => Promise<void>;
      },
    } as Pick<ExtensionAPI, "on">,
    manager,
  );

  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/docs" });
  await executeNamedTool(tools, "browser_navigate", { session: "app", url: "https://example.test/app" });

  assert.ok(handler);
  await handler();

  assert.deepEqual(fakeBrowser.closedContexts, [1, 2]);
  assert.deepEqual(fakeBrowser.closedBrowsers, [1, 2]);
  await assert.rejects(() => manager.inspect("docs"), /navigate first/);
});

test("closeAll closes every open session and is idempotent", async () => {
  const { fakeBrowser, manager, tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { session: "docs", url: "https://example.test/docs" });
  await executeNamedTool(tools, "browser_navigate", { session: "app", url: "https://example.test/app" });

  const closed = await manager.closeAll();

  assert.deepEqual(closed, [
    { status: "closed", session: "docs", existed: true },
    { status: "closed", session: "app", existed: true },
  ]);
  assert.deepEqual(fakeBrowser.closedContexts, [1, 2]);
  assert.deepEqual(fakeBrowser.closedBrowsers, [1, 2]);
  await assert.rejects(() => manager.inspect("docs"), /navigate first/);

  assert.deepEqual(await manager.closeAll(), []);
});

test("headless mode is fixed for an existing session until it closes", async () => {
  const { fakeBrowser, tools } = makeToolsFixture();

  await executeNamedTool(tools, "browser_navigate", { session: "watch", url: "https://example.test/one", headless: false });
  const conflict = details(
    await executeNamedTool(tools, "browser_navigate", { session: "watch", url: "https://example.test/two", headless: true }),
  );

  assert.equal(conflict.status, "session_mode_conflict");
  assert.deepEqual(fakeBrowser.launches, [{ headless: false }]);

  const inspected = details(await executeNamedTool(tools, "browser_inspect", { session: "watch" }));
  assert.equal(inspected.url, "https://example.test/one");

  const closed = details(await executeNamedTool(tools, "browser_close", { session: "watch" }));
  assert.equal(closed.status, "closed");
  assert.deepEqual(fakeBrowser.closedContexts, [1]);
  assert.deepEqual(fakeBrowser.closedBrowsers, [1]);

  await executeNamedTool(tools, "browser_navigate", { session: "watch", url: "https://example.test/three", headless: true });
  assert.deepEqual(fakeBrowser.launches, [{ headless: false }, { headless: true }]);
});
