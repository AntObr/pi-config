# Web browser source layout

Imports flow in one direction:

```text
index.ts -> extension -> application -> browser -> support
```

Layer responsibilities:

- `index.ts` wires the extension and re-exports public helpers.
- `extension/` adapts Pi tools and shutdown hooks to browser use cases.
- `application/` owns browser session lifecycle and use-case orchestration.
- `browser/` contains Playwright-facing page scripts, browser seam types, and inspection report formatting.
- `support/` contains config, host policy, errors, artifact names, generic tool result formatting, and shared result types.

Do not import from a higher layer. Keep browser tool definitions together until shared setup and error handling no longer dominate the file.
