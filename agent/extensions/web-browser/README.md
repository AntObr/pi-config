# Pi web browser extension

A Pi extension that gives agents browser tools backed by Playwright Chromium.

## Install

From this directory:

```bash
npm install
npx playwright install chromium
```

Then load it as a pi package or extension, for example:

```bash
pi -e /Users/anthony.obrien/.pi/agent/extensions/web-browser
```

If Chromium is missing, browser tools fail with the same install command.

## Tools

- `browser_navigate`: open a URL in a named browser session.
- `browser_search`: open the configured search URL with a query. Defaults to Google.
- `browser_inspect`: return URL, title, visible text, and interactable elements.
- `browser_interact`: click, fill, type, press, or select using an `elementId` from the latest inspection or a raw Playwright selector.
- `browser_html`: return raw HTML for the page or a selector. Large HTML is truncated and saved to an artifact file.
- `browser_screenshot`: save a PNG screenshot and return the path.
- `browser_close`: close one named browser session or all sessions.

Browser sessions are named. The default session is `default`. Each Pi process has its own browser manager, so subagents get independent browser state.

Element IDs from `browser_inspect` are short lived. Inspect again after navigation or any interaction that changes the DOM.

## Headless and headed mode

Browsers start headless by default. An agent can request headed mode when it starts a session:

```json
{
  "url": "http://localhost:3000",
  "session": "demo",
  "headless": false
}
```

That choice sticks until the session is closed.

## Config

Config precedence:

1. Project config: `<cwd>/.pi/web-browser.json`
2. User config: `~/.pi/agent/web-browser.json`
3. Package config: `config.json` in this extension directory
4. Built-in defaults

Example:

```json
{
  "searchUrl": "https://www.google.com/search?q={query}",
  "defaultHeadless": true,
  "navigationTimeoutMs": 30000,
  "allowedHosts": [],
  "blockedHosts": [],
  "artifactsDir": ".pi/web-browser-artifacts"
}
```

Host policy is permissive by default. If `allowedHosts` is empty, every host is allowed except entries in `blockedHosts`. If `allowedHosts` has entries, navigation is limited to those hosts. Host patterns support exact names and wildcard subdomains such as `*.example.com`.

## Artifacts and gitignore

Screenshots and saved HTML default to:

```text
.pi/web-browser-artifacts
```

Add this to the project `.gitignore`:

```gitignore
.pi/web-browser-artifacts/
```
