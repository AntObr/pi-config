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

test("browser_close is implemented", async () => {
  assert.equal(browserTools.length, expectedToolNames.length);

  const close = browserTools.find((tool) => tool.name === "browser_close") as AnyToolDefinition | undefined;
  assert.ok(close);

  const result = await close.execute("test-call", {}, undefined, undefined, { cwd: process.cwd() } as never);
  assert.equal(result.details.status, "closed");
  assert.equal(result.details.session, "default");
  assert.equal(result.details.existed, false);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /default was not open/);
});
