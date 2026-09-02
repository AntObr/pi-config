# Pi web browser extension

Pi browser tools backed by Playwright Chromium. The package registers tools for navigation, search, page inspection, raw HTML capture, screenshots, interaction, and session cleanup.

## Setup

Install the package as a Pi package from this directory:

```bash
pi install ./path/to/web-browser
```

The extension does not install a browser binary for you. If navigation or search cannot launch Chromium, the tool returns `status: "browser_install_required"`. Install Chromium before first use:

```bash
npx playwright install chromium
```

Raw HTML captures and screenshots go under `.pi/web-browser-artifacts` by default. Keep that directory out of git:

```gitignore
.pi/web-browser-artifacts/
```

## Configuration

The extension reads `web-browser.json` from three places. Later files override earlier files.

1. Package config in the extension package directory.
2. User config in `~/.pi/agent`, or `PI_CODING_AGENT_DIR` when set.
3. Project config in `.pi` under the current project.

With no config, the extension uses headless Chromium, a 30 second navigation timeout, Google search, no host allow list, no host block list, and `.pi/web-browser-artifacts` for generated files.

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

Config keys:

- `headless`: default browser mode for new sessions. A `browser_navigate` call can override this with its `headless` parameter when it creates a session.
- `navigationTimeoutMs`: default timeout, in milliseconds, for navigation and search. Tool calls can override this with `timeoutMs`.
- `searchUrl`: URL template for `browser_search`. It must include `{query}`. The tool URL-encodes the query and replaces that token.
- `allowedHosts`: host patterns that navigation may visit. Use exact hosts such as `example.com` or wildcard subdomains such as `*.example.com`.
- `blockedHosts`: host patterns that navigation must not visit. This list wins over `allowedHosts`.
- `artifactDir`: directory for generated screenshots and full raw HTML files. Relative paths resolve from the project cwd.

Host rules apply to `browser_navigate` and to the URL built by `browser_search`. An empty `allowedHosts` list allows any host unless `blockedHosts` matches. A non-empty `allowedHosts` list allows only matching hosts. `blockedHosts` always wins.

## Tools

All tools return a Pi `AgentToolResult` with text in `content` and a structured object in `details`. Error results use the same shape, with a `status` such as `config_error`, `denied`, `browser_install_required`, `session_mode_conflict`, `inspection_unavailable`, `interaction_unavailable`, `raw_html_unavailable`, or `screenshot_unavailable` plus a `reason`.

### `browser_navigate`

Opens a URL in a named browser session.

Parameters:

- `url` string, required. URL to open.
- `session` string, optional. Defaults to `default`.
- `headless` boolean, optional. Chooses headed or headless mode when creating a new session. Existing sessions keep their original mode.
- `timeoutMs` number, optional. Navigation timeout in milliseconds.

Success details:

```ts
{
  status: "loaded";
  session: string;
  url: string;
  title: string;
  timeoutMs: number;
}
```

### `browser_search`

Builds a search URL from the configured `searchUrl`, then opens it in a browser session.

Parameters:

- `query` string, required. Search query.
- `session` string, optional. Defaults to `default`.
- `timeoutMs` number, optional. Navigation timeout in milliseconds.

Success details match `browser_navigate`.

### `browser_inspect`

Returns a compact view of the current page.

Parameters:

- `session` string, optional. Defaults to `default`.

Success details:

```ts
{
  status: "inspected";
  session: string;
  inspectionId: number;
  elementIdScope: string;
  url: string;
  title: string;
  text: string;
  elements: Array<{
    id: string;
    tag: string;
    type?: string;
    text?: string;
    label?: string;
    href?: string;
    selectors: string[];
  }>;
}
```

The text result includes visible page text and interactable links, buttons, inputs, selects, and textareas. Element IDs are valid only for the latest inspection in that session. Inspect again after navigation or page changes before using an element ID.

### `browser_interact`

Clicks, types, fills, presses a key, or selects an option on the current page.

Parameters:

- `session` string, optional. Defaults to `default`.
- `action` string, required. One of `click`, `type`, `fill`, `press`, or `select`.
- `elementId` string, optional. Element ID from the latest inspection.
- `selector` string, optional. Raw selector to target.
- `value` string, optional. Required for `type`, `fill`, `press`, and `select`.

Use either `elementId` or `selector` for element actions. `press` can target the page keyboard when no target is supplied.

Success details:

```ts
{
  status: "interacted";
  session: string;
  action: "click" | "type" | "fill" | "press" | "select";
  selector?: string;
  elementId?: string;
  value?: string;
}
```

### `browser_raw_html`

Returns raw HTML for the current page or for one selector.

Parameters:

- `session` string, optional. Defaults to `default`.
- `selector` string, optional. CSS selector to capture. With no selector, the tool captures the full document HTML.

Success details:

```ts
{
  status: "captured";
  session: string;
  url: string;
  title: string;
  selector?: string;
  bytes: number;
  truncated: boolean;
  artifactPath?: string;
  artifactFile?: string;
}
```

HTML up to 50,000 bytes is returned directly in the text result. Larger captures are truncated in the text result and written as an `.html` file under `artifactDir`; the details then include `artifactPath` and `artifactFile`.

### `browser_screenshot`

Saves a PNG screenshot for the current page.

Parameters:

- `session` string, optional. Defaults to `default`.
- `fullPage` boolean, optional. Defaults to `false`. Set it to capture the full page instead of the viewport.

Success details:

```ts
{
  status: "captured";
  session: string;
  url: string;
  title: string;
  artifactPath: string;
  artifactFile: string;
  fullPage: boolean;
}
```

The tool returns the file path and metadata only. It does not include PNG bytes in the result.

### `browser_close`

Closes a named browser session. Pi also closes browser sessions when the Pi session shuts down.

Parameters:

- `session` string, optional. Defaults to `default`.

Success details:

```ts
{
  status: "closed";
  session: string;
  existed: boolean;
}
```

`existed` is `false` when the named session was not open.

## v1 limits

- Chromium is the only browser engine.
- The package does not install Chromium automatically. Run `npx playwright install chromium` yourself.
- Search uses a configurable URL template, not a search provider API.
- Browser state does not persist across Pi restarts.
- Screenshot results include paths and metadata, not image bytes.
