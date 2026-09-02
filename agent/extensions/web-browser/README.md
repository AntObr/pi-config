# Pi web browser extension

This Pi package adds Chromium browser tools backed by Playwright. It supports local app testing, public web browsing, named sessions, compact page inspection, raw HTML capture, screenshots, common interactions, host policy, and cleanup on session shutdown.

## Setup

```bash
npm install
npx playwright install chromium
```

Pi does not install Chromium automatically. If Chromium is missing, the browser tools return an error with the install command above.

Use the package with:

```bash
pi -e /path/to/web-browser
```

## Tools

- `browser_navigate`: open an HTTP or HTTPS URL.
- `browser_search`: navigate to the configured search URL with a query.
- `browser_inspect`: return URL, title, visible text, and interactable elements.
- `browser_interact`: click, fill, type, press, or select by element ID or raw selector.
- `browser_html`: return page or selector HTML. Large output is saved to an artifact file.
- `browser_screenshot`: save a PNG screenshot.
- `browser_close`: close a named browser session.

Sessions are named. If no session is given, the tools use `default`. Element IDs returned by `browser_inspect` are valid only until the next navigation or DOM-changing interaction.

## Config

Config file name: `web-browser.json`.

Precedence is project config, then user config, then package config, then built-in defaults.

- Project: `.pi/web-browser.json`
- User: `~/.pi/agent/web-browser.json`
- Package: `web-browser.json` in this package directory

Supported keys:

```json
{
  "searchUrl": "https://www.google.com/search?q={query}",
  "defaultHeadless": true,
  "navigationTimeoutMs": 30000,
  "allowedHosts": [],
  "blockedHosts": [],
  "artifactDir": ".pi/web-browser-artifacts",
  "htmlPreviewMaxChars": 20000,
  "inspectionTextMaxChars": 12000
}
```

Empty `allowedHosts` means any host is allowed unless blocked. A non-empty `allowedHosts` list restricts navigation to matching hosts. Host patterns support exact hosts, `*`, and wildcard subdomains like `*.example.com`.

Add generated artifacts to `.gitignore`:

```gitignore
.pi/web-browser-artifacts/
```
