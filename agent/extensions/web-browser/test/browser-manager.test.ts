import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLaunchError } from "../src/browser-manager.js";

test("missing Chromium launch error includes install command", () => {
  const error = normalizeLaunchError(new Error("Executable doesn't exist at /cache/chromium"));
  assert.match(error.message, /Chromium is not installed/);
  assert.match(error.message, /npx playwright install chromium/);
});
