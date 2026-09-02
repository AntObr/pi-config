import assert from "node:assert/strict";
import test from "node:test";

import { BrowserManager, createBrowserTools } from "../src/index.ts";

function makeFakeBrowser() {
  const actions: Array<{ action: string; selector?: string; value?: string }> = [];
  const browserType = {
    async launch() {
      let currentUrl = "";
      const page = {
        async goto(url: string) {
          currentUrl = url;
        },
        url() {
          return currentUrl || "https://example.test/form";
        },
        async title() {
          return "Form";
        },
        locator(selector: string) {
          return {
            async click() {
              actions.push({ action: "click", selector });
            },
            async type(value: string) {
              actions.push({ action: "type", selector, value });
            },
            async fill(value: string) {
              actions.push({ action: "fill", selector, value });
            },
            async press(value: string) {
              actions.push({ action: "press", selector, value });
            },
            async selectOption(value: string) {
              actions.push({ action: "select", selector, value });
            },
          };
        },
        async evaluate() {
          return {
            text: "Search Submit Sort",
            elements: [
              { tag: "button", text: "Submit", selectors: ['button:has-text("Submit")'] },
              { tag: "input", type: "search", label: "Search", selectors: ['input[name="q"]'] },
              { tag: "select", label: "Sort", selectors: ['select[name="sort"]'] },
            ],
          };
        },
      };
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
  return { browserType, actions };
}

function toolNamed(name: string, tools: ReturnType<typeof createBrowserTools>) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeTool(tool: ReturnType<typeof toolNamed>, params: Record<string, unknown>) {
  return tool.execute("test-call", params, undefined, undefined, { cwd: process.cwd() } as never);
}

async function inspectThenInteract(tools: ReturnType<typeof createBrowserTools>, params: Record<string, unknown>) {
  await executeTool(toolNamed("browser_inspect", tools), {});
  return executeTool(toolNamed("browser_interact", tools), params);
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

test("interact clicks, fills, types, presses, and selects by inspected element ID", async () => {
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/form" });
  let result = await inspectThenInteract(tools, { action: "click", elementId: "e1" });
  assert.equal(details(result).status, "interacted");

  await inspectThenInteract(tools, { action: "fill", elementId: "e2", value: "hello" });
  await inspectThenInteract(tools, { action: "type", elementId: "e2", value: " world" });
  await inspectThenInteract(tools, { action: "press", elementId: "e2", value: "Enter" });
  result = await inspectThenInteract(tools, { action: "select", elementId: "e3", value: "newest" });

  assert.equal(details(result).selector, 'select[name="sort"]');
  assert.deepEqual(fake.actions, [
    { action: "click", selector: 'button:has-text("Submit")' },
    { action: "fill", selector: 'input[name="q"]', value: "hello" },
    { action: "type", selector: 'input[name="q"]', value: " world" },
    { action: "press", selector: 'input[name="q"]', value: "Enter" },
    { action: "select", selector: 'select[name="sort"]', value: "newest" },
  ]);
});

test("interact can use raw selectors without an inspection", async () => {
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/form" });
  const result = await executeTool(toolNamed("browser_interact", tools), {
    action: "fill",
    selector: '[data-testid="search"]',
    value: "raw",
  });

  assert.equal(details(result).status, "interacted");
  assert.deepEqual(fake.actions, [{ action: "fill", selector: '[data-testid="search"]', value: "raw" }]);
});

test("interact rejects stale element IDs after an action until the agent inspects again", async () => {
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/form" });
  await inspectThenInteract(tools, { action: "fill", elementId: "e2", value: "hello" });

  const stale = await executeTool(toolNamed("browser_interact", tools), { action: "type", elementId: "e2", value: " world" });
  assert.equal(details(stale).status, "interaction_unavailable");
  assert.match(stale.content[0]?.type === "text" ? stale.content[0].text : "", /inspect again/i);

  const fresh = await inspectThenInteract(tools, { action: "type", elementId: "e2", value: " world" });
  assert.equal(details(fresh).status, "interacted");
});

test("interact rejects ambiguous element ID and selector requests", async () => {
  const fake = makeFakeBrowser();
  const manager = new BrowserManager(fake.browserType as never);
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/form" });
  await executeTool(toolNamed("browser_inspect", tools), {});
  const result = await executeTool(toolNamed("browser_interact", tools), {
    action: "click",
    elementId: "e1",
    selector: "button",
  });

  assert.equal(details(result).status, "interaction_unavailable");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /either an elementId or a raw selector/i);
});
