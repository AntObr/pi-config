import type { BrowserConfig } from "./config.js";

export function buildSearchUrl(query: string, config: BrowserConfig) {
  return config.searchUrl.replaceAll("{query}", encodeURIComponent(query));
}
