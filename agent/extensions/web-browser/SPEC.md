# Web browser extension spec

## Problem statement

Pi agents currently cannot browse or operate web pages through a browser. That limits two common workflows.

First, agents cannot test locally running web apps the way a user would. They can inspect files and run shell commands, but they cannot open `localhost`, click controls, fill forms, or capture screenshots.

Second, agents cannot navigate public documentation and search results through a real browser. They can use shell tools, but that is a poor fit for pages that depend on client-side rendering, navigation, forms, or browser behavior.

Subagents have the same gap. Each subagent should be able to browse independently without sharing browser state with the parent agent or with sibling subagents.

## Solution

Build a Pi extension in this directory that gives agents browser tools backed by Playwright.

The extension will use Chromium in v1. It will expose a small set of tools for navigation, search, inspection, raw HTML capture, screenshots, interaction, and cleanup. Browser state will persist across tool calls inside named browser sessions, with a default session named `default`. Each Pi process, including each subagent process, will have its own browser manager and therefore independent browser state.

The default mode will be headless. The agent can request headed mode when starting a named browser session, so a user can ask to watch the browser when that is useful.

The extension will support local app testing and broader web browsing from the first version. Search will work by navigating to a configurable search URL, defaulting to Google search.

The extension will not auto-install Playwright browsers. If Chromium is missing, tools will return a clear error telling the user to run the install command.

## User stories

1. As a Pi user, I want an agent to open a local web app in a browser, so that it can test the app like a user.
2. As a Pi user, I want an agent to navigate to `localhost` URLs, so that it can inspect apps I am developing.
3. As a Pi user, I want an agent to browse public websites, so that it can read documentation and search results.
4. As a Pi user, I want browser state to persist across tool calls, so that an agent can navigate multi-step flows.
5. As a Pi user, I want named browser sessions, so that an agent can keep separate browser tasks isolated.
6. As a Pi user, I want subagents to browse independently, so that delegated research or testing does not interfere with the parent agent.
7. As a Pi user, I want the browser to run headless by default, so that browsing works in normal terminal and automation workflows.
8. As a Pi user, I want the agent to request headed mode, so that I can watch or debug browser behavior when I ask for it.
9. As an agent, I want to navigate to a URL, so that I can load pages for testing or research.
10. As an agent, I want to search the web through a browser, so that I can discover relevant pages without a separate search API.
11. As a Pi user, I want the default search engine to be configurable, so that I can choose Google or another search provider.
12. As an agent, I want a compact page inspection result, so that I can understand the current page without wasting context on raw HTML.
13. As an agent, I want the page inspection result to include the URL and title, so that I can confirm where I am.
14. As an agent, I want the page inspection result to include visible text, so that I can read the page content.
15. As an agent, I want the page inspection result to include links, buttons, inputs, selects, and textareas, so that I can decide how to interact with the page.
16. As an agent, I want interactable elements to have element IDs, so that I can click or type into them without inventing selectors.
17. As an agent, I want interactable elements to include suggested selectors, so that I can use Playwright-style selection when precision matters.
18. As an agent, I want to use raw selectors when needed, so that I can test application-specific markup and behavior.
19. As an agent, I want element IDs to be clearly scoped to the latest inspection, so that I know to inspect again after navigation or DOM changes.
20. As an agent, I want to click elements, so that I can follow links and press buttons.
21. As an agent, I want to type into inputs and textareas, so that I can fill forms.
22. As an agent, I want to press keys, so that I can submit forms and trigger keyboard behavior.
23. As an agent, I want to select options, so that I can interact with dropdown controls.
24. As an agent, I want to retrieve raw HTML for the current page, so that I can inspect markup when compact inspection is not enough.
25. As an agent, I want to retrieve raw HTML for a selector, so that I can inspect a specific region of a large page.
26. As an agent, I want large HTML output to be truncated in the tool result, so that it does not flood context.
27. As an agent, I want full HTML to be saved to a file when large, so that I can read it with normal file tools if needed.
28. As an agent, I want to capture screenshots, so that I can verify visual state and save debugging evidence.
29. As a Pi user, I want screenshots saved as files, so that artifacts stay out of the conversation context.
30. As a Pi user, I want artifacts stored in a project-local directory by default, so that local testing evidence is easy to find.
31. As a Pi user, I want README guidance to add the artifact directory to `.gitignore`, so that generated screenshots and HTML files do not get committed accidentally.
32. As an agent, I want navigation calls to time out, so that a hung page does not stall the agent indefinitely.
33. As an agent, I want to override navigation timeout per call, so that I can handle slow pages when needed.
34. As a Pi user, I want host allow and block lists, so that I can control where browser tools may navigate.
35. As a Pi user, I want the default host policy to be permissive, so that the extension works without setup.
36. As a Pi user, I want a non-empty allow list to restrict browsing, so that a project can lock the browser to known hosts.
37. As a Pi user, I want blocked hosts to deny navigation, so that sensitive or unwanted destinations can be excluded.
38. As a Pi user, I want project config to override user config, so that repo-specific behavior wins when I work in that repo.
39. As a Pi user, I want user config to override package defaults, so that my personal defaults apply everywhere.
40. As a Pi user, I want package defaults, so that the extension works even with no config files.
41. As a Pi user, I want missing Playwright browser errors to explain the fix, so that setup failures are easy to recover from.
42. As a Pi user, I want browsers closed on Pi session shutdown, so that browser processes do not leak.
43. As an agent, I want to close a named browser session, so that I can clean up when a browsing task is done.
44. As an extension maintainer, I want v1 limited to Chromium, so that the first version avoids browser-specific branching.
45. As an extension maintainer, I want the tool API to leave room for other browsers later, so that Firefox or WebKit can be added without redesigning the extension.

## Implementation decisions

- The extension will be a Pi package-style extension located in this directory.
- Runtime dependencies will be declared in package metadata. Playwright will be a runtime dependency.
- The v1 browser engine will be Chromium only.
- The extension will register multiple tools instead of a single large browser tool.
- The tool set will include navigation, search, inspection, raw HTML capture, screenshot capture, interaction, and session close.
- A hybrid interaction model will be used. Agents can act on element IDs returned by inspection, or provide selectors directly.
- The interaction tool will support common Playwright-like actions such as click, type, fill, press, and select.
- Browser sessions will be named. If a tool call does not specify a session, it will use `default`.
- The first tool call that needs a named session will create it.
- Headless mode will be chosen when a named session starts. The choice sticks until that session closes.
- The default headless value will come from config, defaulting to true.
- The agent can request headed mode by passing `headless: false` when starting a session through navigation.
- Search will not call a search provider API in v1. It will navigate the browser to a search URL.
- The default search URL will be `https://www.google.com/search?q={query}`.
- The search URL will be configurable.
- Config precedence will be project config, then user config, then package config, then built-in defaults.
- Project config will live under the project Pi config directory as a web-browser config file.
- User config will live under the user Pi agent config directory as a web-browser config file.
- Package config will live in the extension package directory.
- Config will include search URL, default headless value, navigation timeout, allowed hosts, blocked hosts, and artifact directory.
- Host policy will be permissive by default. Empty allowed hosts means any host is allowed unless blocked. A non-empty allowed hosts list restricts navigation to matching hosts.
- Navigation will check host policy before loading a URL.
- Navigation will default to a 30 second timeout. Tool calls can override it.
- Inspection will return a compact report by default. The report will include URL, title, visible text, and interactable elements.
- Interactable elements will include element IDs and suggested selectors.
- Element IDs are valid only until the next navigation or DOM-changing interaction. Agents should inspect again after page changes.
- Raw HTML retrieval will be a separate capability.
- Raw HTML retrieval will accept an optional selector. If provided, only that element's HTML will be returned or saved.
- Raw HTML results will be truncated in the tool response when large. Full content will be saved to an artifact file when needed.
- Screenshots will be saved as PNG files and returned as paths.
- Artifacts will default to a project-local `.pi/web-browser-artifacts` directory.
- The README will tell users to add the artifacts directory to `.gitignore`.
- Browser processes and contexts will close during Pi session shutdown.
- A tool will also allow explicit closing of a named browser session.
- Missing browser installation will not trigger automatic install in v1. The tool result will tell the user to run `npx playwright install chromium`.

## Testing decisions

- Tests should focus on observable tool behavior, not Playwright internals.
- The preferred test seam is the registered tool layer. Tests should call tool execution with representative parameters and assert returned content, details, file artifacts, and error messages.
- Browser manager internals should be tested only where behavior cannot be covered through tool calls without making tests brittle.
- Config loading should be tested as an external behavior of the extension helper that resolves final config from project, user, package, and defaults.
- Host policy should be tested through navigation guard behavior: allow all by default, block listed hosts, restrict to allow list when present.
- Output truncation should be tested with generated large HTML content, asserting that the tool returns a preview and writes the full artifact.
- Screenshot behavior should be tested by asserting that a PNG file is created and its path is returned.
- Missing browser behavior should be tested by isolating the browser launch path and asserting that the error includes the Chromium install command.
- Local app testing should use a tiny local HTTP server in tests rather than external websites.
- Broader web search should not depend on live Google in automated tests. The search URL builder can be tested separately, and browser navigation can be tested against a local fake search page.
- Headless/headed behavior should be tested at the configuration and session creation seam. Tests should not require a visible browser window.
- Session cleanup should be tested by creating sessions and verifying close behavior through the browser manager seam.

## Out of scope

- Firefox and WebKit support.
- Direct search provider APIs.
- Automatic Playwright browser installation.
- Authentication helpers for websites.
- Cookie or storage persistence across Pi restarts.
- Visual diffing or screenshot assertions.
- Full browser devtools protocol exposure.
- Network request interception.
- Download management.
- Multi-page or multi-tab orchestration beyond named browser sessions.
- Security sandboxing. Host allow and block lists are navigation policy, not a sandbox.
- Returning screenshot images directly in tool results.

## Further notes

Playwright is powerful enough that the tool design should stay close to its concepts without exposing the whole API. The first version should keep the agent's loop simple: navigate, inspect, act, inspect again.

The raw HTML escape hatch matters. Compact inspection is better for normal browsing, but debugging frontend apps often requires real markup.

The extension should be strict about cleanup. Browser leaks are the kind of small annoyance that makes a useful tool feel sloppy after a few sessions.
