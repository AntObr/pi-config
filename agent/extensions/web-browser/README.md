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

## Registered tools

- `browser_navigate`
- `browser_search`
- `browser_inspect`
- `browser_raw_html`
- `browser_screenshot`
- `browser_interact`
- `browser_close`

For now each tool returns a "not implemented yet" result instead of launching Chromium.
