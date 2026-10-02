import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { maybeTruncateToArtifact } from "../src/artifacts.js";
import { formatInspection } from "../src/inspect.js";

test("large HTML is previewed and saved", async () => {
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "web-browser-artifacts-"));
  const content = `<main>${"x".repeat(100)}</main>`;

  const result = await maybeTruncateToArtifact({ content, maxChars: 20, artifactDir, sessionName: "default", kind: "html" });

  assert.equal(result.truncated, true);
  assert.ok(result.artifactPath);
  assert.match(result.text, /HTML truncated/);
  assert.equal(await readFile(result.artifactPath!, "utf8"), content);
});

test("inspection output states element ID scope and selector", () => {
  const report = formatInspection({
    url: "http://localhost:3000/",
    title: "Test app",
    text: "Hello world",
    inspectionVersion: 2,
    elements: [{ id: "e1", tag: "button", text: "Save", selector: "#save" }],
  });

  assert.match(report, /URL: http:\/\/localhost:3000\//);
  assert.match(report, /Title: Test app/);
  assert.match(report, /\[e1\] button/);
  assert.match(report, /selector="#save"/);
  assert.match(report, /valid only for this inspection/);
});
