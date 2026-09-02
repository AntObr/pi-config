import assert from "node:assert/strict";
import test from "node:test";

import { BrowserManager, createBrowserTools } from "../src/index.ts";

type FakeInspectElement = {
  tag: string;
  type?: string;
  text?: string;
  label?: string;
  href?: string;
  selectors: string[];
};

function makeFakeBrowser(options: { url: string; title: string; text: string; elements: FakeInspectElement[] }) {
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
                  return currentUrl || options.url;
                },
                async title() {
                  return options.title;
                },
                async evaluate() {
                  return {
                    text: options.text,
                    elements: options.elements,
                  };
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

function toolNamed(name: string, tools = createBrowserTools()) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be registered`);
  return tool;
}

async function executeTool(tool: ReturnType<typeof toolNamed>, params: Record<string, unknown>, cwd = process.cwd()) {
  return tool.execute("test-call", params, undefined, undefined, { cwd } as never);
}

function details(result: { details: unknown }): Record<string, unknown> {
  assert.ok(result.details && typeof result.details === "object");
  return result.details as Record<string, unknown>;
}

test("inspect returns compact URL, title, visible text, and interactable elements for the active session", async () => {
  const manager = new BrowserManager(
    makeFakeBrowser({
      url: "https://example.test/page",
      title: "Example page",
      text: "Example page\nWelcome\nSearch Submit Hidden implementation detail",
      elements: [
        { tag: "a", text: "Docs", href: "https://example.test/docs", selectors: ['a[href="https://example.test/docs"]', 'text="Docs"'] },
        { tag: "button", text: "Submit", selectors: ['button:has-text("Submit")'] },
        { tag: "input", type: "search", label: "Search", selectors: ['input[name="q"]', 'input[placeholder="Search"]'] },
        { tag: "select", label: "Sort", selectors: ['select[name="sort"]'] },
        { tag: "textarea", label: "Comment", selectors: ['textarea[name="comment"]'] },
      ],
    }) as never,
  );
  const tools = createBrowserTools({ manager });

  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/page" });

  const result = await executeTool(toolNamed("browser_inspect", tools), {});

  const resultDetails = details(result);
  assert.equal(resultDetails.status, "inspected");
  assert.equal(resultDetails.session, "default");
  assert.equal(resultDetails.url, "https://example.test/page");
  assert.equal(resultDetails.title, "Example page");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /URL: https:\/\/example\.test\/page/);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Title: Example page/);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Visible text:\nExample page\nWelcome/);

  const elements = resultDetails.elements as Array<Record<string, unknown>>;
  assert.equal(elements.length, 5);
  assert.deepEqual(
    elements.map((element) => element.id),
    ["e1", "e2", "e3", "e4", "e5"],
  );
  assert.deepEqual(elements[0], {
    id: "e1",
    tag: "a",
    text: "Docs",
    href: "https://example.test/docs",
    selectors: ['a[href="https://example.test/docs"]', 'text="Docs"'],
  });
});

test("inspect creates a fresh element ID scope each time", async () => {
  const manager = new BrowserManager(
    makeFakeBrowser({
      url: "https://example.test/first",
      title: "First",
      text: "First",
      elements: [{ tag: "button", text: "Save", selectors: ['button:has-text("Save")'] }],
    }) as never,
  );
  const tools = createBrowserTools({ manager });
  await executeTool(toolNamed("browser_navigate", tools), { url: "https://example.test/first" });

  const first = details(await executeTool(toolNamed("browser_inspect", tools), {}));
  const second = details(await executeTool(toolNamed("browser_inspect", tools), {}));

  assert.notEqual(first.inspectionId, second.inspectionId);
  assert.equal(first.elementIdScope, "latest inspection only; inspect again after navigation or page changes");
  assert.equal(second.elementIdScope, "latest inspection only; inspect again after navigation or page changes");
  assert.deepEqual((first.elements as Array<Record<string, unknown>>).map((element) => element.id), ["e1"]);
  assert.deepEqual((second.elements as Array<Record<string, unknown>>).map((element) => element.id), ["e1"]);
});
