import type { WebBrowserConfig } from "./types.js";

function normalizeHostPattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

export function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  const normalized = normalizeHostPattern(pattern);
  if (!normalized) return false;
  if (normalized === "*") return true;
  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === normalized;
}

export function assertNavigationAllowed(rawUrl: string, config: Pick<WebBrowserConfig, "allowedHosts" | "blockedHosts">): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Navigation denied for unsupported protocol: ${url.protocol}`);
  }
  const host = url.hostname;
  if (config.blockedHosts.some((pattern) => hostMatches(host, pattern))) {
    throw new Error(`Navigation denied by blockedHosts for host: ${host}`);
  }
  if (config.allowedHosts.length > 0 && !config.allowedHosts.some((pattern) => hostMatches(host, pattern))) {
    throw new Error(`Navigation denied by allowedHosts for host: ${host}`);
  }
}
