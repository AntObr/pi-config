import test from "node:test";
import assert from "node:assert/strict";
import { assertNavigationAllowed, matchesHost } from "../src/hostPolicy.js";
import { DEFAULT_CONFIG } from "../src/config.js";

test("host matching supports exact hosts and wildcard subdomains", () => {
  assert.equal(matchesHost("example.com", "example.com"), true);
  assert.equal(matchesHost("docs.example.com", "*.example.com"), true);
  assert.equal(matchesHost("example.com", "*.example.com"), false);
});

test("empty allow list permits hosts unless blocked", () => {
  assert.doesNotThrow(() => assertNavigationAllowed("https://example.com/docs", DEFAULT_CONFIG));

  assert.throws(
    () => assertNavigationAllowed("https://blocked.test", { ...DEFAULT_CONFIG, blockedHosts: ["blocked.test"] }),
    /blockedHosts/,
  );
});

test("non-empty allow list restricts navigation", () => {
  const config = { ...DEFAULT_CONFIG, allowedHosts: ["localhost", "*.example.com"] };

  assert.doesNotThrow(() => assertNavigationAllowed("http://localhost:3000", config));
  assert.doesNotThrow(() => assertNavigationAllowed("https://docs.example.com", config));
  assert.throws(() => assertNavigationAllowed("https://other.test", config), /allowedHosts/);
});

test("host policy can match an explicit port", () => {
  const config = { ...DEFAULT_CONFIG, allowedHosts: ["localhost:5173"] };

  assert.doesNotThrow(() => assertNavigationAllowed("http://localhost:5173", config));
  assert.throws(() => assertNavigationAllowed("http://localhost:3000", config), /allowedHosts/);
});
