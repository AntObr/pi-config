import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildSearchUrl } from "../src/search.js";
import { truncateForTool } from "../src/truncate.js";

test("buildSearchUrl encodes the query into the configured template", () => {
  const url = buildSearchUrl("playwright headless docs", DEFAULT_CONFIG);

  assert.equal(url, "https://www.google.com/search?q=playwright%20headless%20docs");
});

test("truncateForTool reports original size and truncates by bytes", () => {
  const text = "a".repeat(20);
  const result = truncateForTool(text, 10, 100);

  assert.equal(result.content, "aaaaaaaaaa");
  assert.equal(result.truncated, true);
  assert.equal(result.originalBytes, 20);
});

test("truncateForTool truncates by lines", () => {
  const result = truncateForTool("one\ntwo\nthree", 100, 2);

  assert.equal(result.content, "one\ntwo");
  assert.equal(result.truncated, true);
  assert.equal(result.originalLines, 3);
});
