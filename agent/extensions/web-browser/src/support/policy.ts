import type { BrowserConfig } from "./config.ts";
import { NavigationPolicyError } from "./errors.ts";

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

function hostMatches(pattern: string, host: string): boolean {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedHost = normalizeHost(host);
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === normalizedPattern;
}

export function assertUrlAllowed(url: string, config: Pick<BrowserConfig, "allowedHosts" | "blockedHosts">): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new NavigationPolicyError(`Navigation denied: ${url} is not a valid URL.`);
  }

  const host = normalizeHost(parsed.hostname);
  const blockedBy = config.blockedHosts.find((pattern) => hostMatches(pattern, host));
  if (blockedBy) {
    throw new NavigationPolicyError(`Navigation denied: ${host} matches blockedHosts entry ${blockedBy}.`);
  }

  if (config.allowedHosts.length > 0 && !config.allowedHosts.some((pattern) => hostMatches(pattern, host))) {
    throw new NavigationPolicyError(
      `Navigation denied: ${host} is not in allowedHosts (${config.allowedHosts.join(", ")}).`,
    );
  }
}

export function buildSearchUrl(query: string, config: Pick<BrowserConfig, "searchUrl">): string {
  const encodedQuery = new URLSearchParams({ q: query }).toString().replace(/^q=/, "");
  return config.searchUrl.replace("{query}", encodedQuery);
}
