# Pi web browser extension

A Pi extension package for browser tools. This first ticket only registers the tool names and returns safe placeholder results. Playwright-backed behavior comes in later tickets.

## Setup

Install the package as a Pi package from this directory:

```bash
pi install ./path/to/web-browser
```

The v1 browser engine will use Chromium through Playwright. Install the browser binary before using the real browser tools:

```bash
npx playwright install chromium
```

Generated screenshots and HTML captures will be written under `.pi/web-browser-artifacts` by default. Add that directory to `.gitignore` before the artifact-producing tools land:

```gitignore
.pi/web-browser-artifacts/
```

## Configuration

The extension reads `web-browser.json` from three places, in this order:

1. Package config in the extension package directory.
2. User config in `~/.pi/agent` or `PI_CODING_AGENT_DIR`.
3. Project config in `.pi` under the current project.

Later files override earlier files. With no config, the defaults are headless Chromium, a 30 second navigation timeout, Google search, permissive host navigation, and `.pi/web-browser-artifacts` for generated files.

```json
{
  "headless": true,
  "navigationTimeoutMs": 30000,
  "searchUrl": "https://www.google.com/search?q={query}",
  "allowedHosts": ["localhost", "*.example.com"],
  "blockedHosts": ["internal.example.com"],
  "artifactDir": ".pi/web-browser-artifacts"
}
```

An empty `allowedHosts` list allows any host unless `blockedHosts` matches. A non-empty `allowedHosts` list restricts navigation to matching hosts. `blockedHosts` always wins.

## Registered tools

- `browser_navigate`
- `browser_search`
- `browser_inspect`
- `browser_raw_html`
- `browser_screenshot`
- `browser_interact`
- `browser_close`

For now each tool returns a "not implemented yet" result instead of launching Chromium.
