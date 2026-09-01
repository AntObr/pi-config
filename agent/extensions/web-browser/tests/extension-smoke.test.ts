import assert from "node:assert/strict";
import test from "node:test";

import webBrowserExtension, { browserTools, registerBrowserTools } from "../src/index.ts";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

type AnyToolDefinition = ToolDefinition<any, any, any>;

const expectedToolNames = [
  "browser_navigate",
  "browser_search",
  "browser_inspect",
  "browser_raw_html",
  "browser_screenshot",
  "browser_interact",
  "browser_close",
];

function captureTools(): AnyToolDefinition[] {
  const registered: AnyToolDefinition[] = [];
  registerBrowserTools({
    registerTool(tool) {
      registered.push(tool);
    },
  });
  return registered;
}

test("extension registers the expected browser tools", () => {
  assert.deepEqual(
    captureTools().map((tool) => tool.name),
    expectedToolNames,
  );
});

test("default export loads without using other Pi APIs", () => {
  const registered: AnyToolDefinition[] = [];
  const pi = new Proxy(
    {
      registerTool(tool: AnyToolDefinition) {
        registered.push(tool);
      },
    },
    {
      get(target, property, receiver) {
        if (property === "registerTool") return Reflect.get(target, property, receiver);
        throw new Error(`Unexpected Pi API read: ${String(property)}`);
      },
    },
  ) as Pick<ExtensionAPI, "registerTool"> as ExtensionAPI;

  webBrowserExtension(pi);

  assert.deepEqual(
    registered.map((tool) => tool.name),
    expectedToolNames,
  );
});

test("non-navigation tools return clear not implemented results", async () => {
  assert.equal(browserTools.length, expectedToolNames.length);

  const paramsByTool: Record<string, Record<string, unknown>> = {
    browser_search: { query: "example" },
    browser_inspect: {},
    browser_raw_html: {},
    browser_screenshot: {},
    browser_interact: { action: "click", selector: "button" },
    browser_close: {},
  };

  for (const tool of browserTools.filter((tool) => tool.name !== "browser_navigate") as AnyToolDefinition[]) {
    const result = await tool.execute("test-call", paramsByTool[tool.name] ?? {}, undefined, undefined, { cwd: process.cwd() } as never);
    assert.equal(result.details.status, "not_implemented");
    assert.equal(result.details.tool, tool.name);
    assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /not implemented yet/i);
  }
});
