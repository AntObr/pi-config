# Pi web browser extension

A Pi extension package for browser tools. `browser_navigate` and `browser_inspect` are backed by Playwright Chromium. Tools from later tickets are registered and return safe placeholder results until they land.

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

`browser_navigate` launches Chromium, opens the requested URL in a named session, and returns the final URL and page title. Sessions default to `default`, run headless unless configured otherwise, and use the configured navigation timeout unless the tool call supplies `timeoutMs`.

`browser_inspect` returns the current URL, title, visible page text, and interactable links, buttons, inputs, selects, and textareas for the active session. Each element gets an ID for the latest inspection plus suggested selectors when the page exposes useful attributes or text. Inspect again after navigation or page changes before reusing element IDs.

The remaining tools still return a "not implemented yet" result.
