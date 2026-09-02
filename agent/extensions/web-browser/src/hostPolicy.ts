import type { BrowserConfig } from "./config.js";

export function assertNavigationAllowed(rawUrl: string, config: BrowserConfig) {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase();

  if (matchesAny(hostname, host, config.blockedHosts)) {
    throw new Error(`Navigation blocked by browser config blockedHosts: ${host}`);
  }

  if (config.allowedHosts.length > 0 && !matchesAny(hostname, host, config.allowedHosts)) {
    throw new Error(`Navigation blocked by browser config allowedHosts: ${host}`);
  }
}

export function matchesHost(host: string, pattern: string) {
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern === "*") return true;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix) && normalizedHost.length > suffix.length;
  }

  return normalizedHost === normalizedPattern;
}

function matchesAny(hostname: string, host: string, patterns: string[]) {
  return patterns.some((pattern) => matchesHost(hostname, pattern) || matchesHost(host, pattern));
}
